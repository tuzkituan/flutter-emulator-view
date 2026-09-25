import * as vscode from 'vscode';
import { Device, DeviceTracker, deviceLabel } from './adb';
import { Recording, captureScreenshot, saveScreenshot } from './capture';
import { killEmulator, launchAvd, listAvds, waitForBoot } from './emulator';
import { FlutterSessions, runFlutterAction, runFlutterApp } from './flutter';
import { DeviceSummary, FramePoint, HostMessage, NavKey, ToolbarAction, ViewStatus, WebviewMessage } from './messages';
import {
  KeyAction,
  MotionAction,
  expandNotificationPanel,
  injectKeycode,
  injectScroll,
  injectText,
  injectTouch,
  resetVideo,
  rotateDevice,
} from './scrcpy/control';
import { MissingScrcpyError, ScrcpySession } from './scrcpy/server';
import { resolveEmulatorPath } from './sdk';

const SELECTED_KEY = 'flutterEmulatorView.selectedSerial';

const NAV_KEYCODES: Partial<Record<NavKey, number>> = {
  back: 4,
  home: 3,
  recents: 187, // KEYCODE_APP_SWITCH
  power: 26,
  volumeDown: 25,
  volumeUp: 24,
};

/** More packets than this waiting on the webview means it cannot keep up. */
const MAX_IN_FLIGHT = 24;

export class DeviceViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'flutterEmulatorView.device';

  private view: vscode.WebviewView | undefined;
  private session: ScrcpySession | undefined;
  private attaching: string | undefined;
  private selected: string | undefined;
  private status: ViewStatus = { kind: 'noDevice', avds: [], emulatorAvailable: false };
  private recording: Recording | undefined;
  private bootingAvd: string | undefined;
  private retry = { serial: '', attempts: 0, timer: undefined as NodeJS.Timeout | undefined };
  private inFlight = 0;
  private waitingForKeyFrame = false;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tracker: DeviceTracker,
    private readonly flutter: FlutterSessions,
    private readonly log: vscode.OutputChannel,
  ) {
    this.selected = context.workspaceState.get<string>(SELECTED_KEY);
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.command = 'flutterEmulatorView.selectDevice';
    this.subscriptions.push(
      this.statusBar,
      tracker.onDidChange(() => this.onDevicesChanged()),
      flutter.onDidChange((running) => this.post({ type: 'flutter', running })),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.html(view.webview, dist);
    view.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m), undefined, this.subscriptions);
    view.onDidChangeVisibility(() => this.onVisibilityChanged(), undefined, this.subscriptions);
    view.onDidDispose(() => {
      this.view = undefined;
      this.detach();
    }, undefined, this.subscriptions);
  }

  // ---- device selection and the scrcpy session ------------------------------------------

  private onDevicesChanged(): void {
    this.postDevices();
    if (!this.view) return;
    const device = this.selectedDevice();
    if (!device) {
      if (this.session || this.attaching) this.detach();
      void this.showNoDevice();
      return;
    }
    if (device.state !== 'device') {
      this.detach();
      this.setStatus({ kind: 'unavailable', serial: device.serial, label: deviceLabel(device), state: device.state });
      return;
    }
    if (this.bootingAvd && device.avd === this.bootingAvd) return; // attached once boot completes
    void this.attach(device);
  }

  /** The stored choice when it is connected, else the first usable device. */
  private selectedDevice(): Device | undefined {
    const devices = this.tracker.devices;
    const chosen = devices.find((d) => d.serial === this.selected);
    if (chosen) return chosen;
    const fallback = devices.find((d) => d.state === 'device') ?? devices[0];
    if (fallback) this.select(fallback.serial, false);
    return fallback;
  }

  private select(serial: string, remember: boolean): void {
    this.selected = serial;
    if (remember) void this.context.workspaceState.update(SELECTED_KEY, serial);
  }

  async selectDevice(serial?: string): Promise<void> {
    if (!serial) {
      const devices = this.tracker.devices;
      if (devices.length === 0) {
        const choice = await vscode.window.showInformationMessage('No Android device is connected.', 'Launch Emulator');
        if (choice) await this.manageEmulators();
        return;
      }
      const picked = await vscode.window.showQuickPick(
        devices.map((d) => ({
          label: `$(${d.serial.startsWith('emulator-') ? 'vm' : 'device-mobile'}) ${deviceLabel(d)}`,
          description: d.state === 'device' ? (d.serial === this.selected ? 'mirrored' : '') : d.state,
          serial: d.serial,
        })),
        { placeHolder: 'Device to mirror' },
      );
      if (!picked) return;
      serial = picked.serial;
    }
    if (serial === this.session?.serial) return;
    this.select(serial, true);
    this.detach();
    this.onDevicesChanged();
  }

  private async attach(device: Device): Promise<void> {
    if (this.session?.serial === device.serial || this.attaching === device.serial) return;
    this.detach();
    this.attaching = device.serial;
    const label = deviceLabel(device);
    this.setStatus({ kind: 'connecting', serial: device.serial, label });
    try {
      const session = await ScrcpySession.start(
        device.serial,
        {
          onDeviceName: () => undefined,
          onCodec: () => this.setStatus({ kind: 'streaming', serial: device.serial, label }),
          onPacket: (packet) => this.forwardPacket(packet),
          onClosed: (error) => this.onSessionClosed(session, device, error),
        },
        this.log,
      );
      if (this.attaching !== device.serial) {
        session.close(); // the selection moved on while we were connecting
        return;
      }
      this.session = session;
      this.attaching = undefined;
      this.inFlight = 0;
      this.waitingForKeyFrame = true;
      this.updateStatusBar(label);
    } catch (error) {
      if (this.attaching !== device.serial) return;
      this.attaching = undefined;
      this.onSessionClosed(undefined, device, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private onSessionClosed(session: ScrcpySession | undefined, device: Device, error: Error | undefined): void {
    if (session && this.session !== session) return;
    this.session = undefined;
    this.updateStatusBar(undefined);
    const message = error?.message ?? 'Disconnected';
    if (error instanceof MissingScrcpyError) {
      this.setStatus({ kind: 'error', message, serial: device.serial, setupHint: true });
      return;
    }
    // Retry while the device is still there: early in boot, or after adb restarted.
    const stillThere = this.tracker.devices.some((d) => d.serial === device.serial && d.state === 'device');
    if (this.retry.serial !== device.serial) this.retry = { serial: device.serial, attempts: 0, timer: undefined };
    if (stillThere && this.retry.attempts < 5 && this.view) {
      const delay = 1000 * 2 ** this.retry.attempts++;
      this.setStatus({ kind: 'connecting', serial: device.serial, label: deviceLabel(device) });
      clearTimeout(this.retry.timer);
      this.retry.timer = setTimeout(() => this.onDevicesChanged(), delay);
      return;
    }
    this.setStatus({ kind: 'error', message, serial: device.serial });
  }

  private detach(): void {
    clearTimeout(this.retry.timer);
    this.attaching = undefined;
    const session = this.session;
    this.session = undefined;
    session?.close();
    this.updateStatusBar(undefined);
  }

  reconnect(): void {
    this.retry = { serial: '', attempts: 0, timer: undefined };
    this.detach();
    this.onDevicesChanged();
  }

  private forwardPacket(packet: { key: boolean; hasConfig: boolean; data: Uint8Array }): void {
    if (this.retry.attempts > 0) this.retry.attempts = 0;
    if (!this.view?.visible) return;
    if (this.waitingForKeyFrame) {
      if (!packet.key) return;
      this.waitingForKeyFrame = false;
    }
    if (this.inFlight >= MAX_IN_FLIGHT) {
      // Dropping a delta frame breaks every frame after it, so skip to a fresh key frame.
      this.waitingForKeyFrame = true;
      this.session?.send(resetVideo());
      return;
    }
    this.inFlight++;
    const message: HostMessage = { type: 'packet', key: packet.key, hasConfig: packet.hasConfig, data: packet.data.slice() };
    void this.view.webview.postMessage(message).then(
      () => this.inFlight--,
      () => this.inFlight--,
    );
  }

  private onVisibilityChanged(): void {
    if (!this.view?.visible) return;
    // Packets were dropped while hidden; restart decoding from a key frame.
    this.waitingForKeyFrame = true;
    this.session?.send(resetVideo());
    if (!this.session && !this.attaching) this.onDevicesChanged();
  }

  // ---- webview messages -----------------------------------------------------------------

  private async onMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.postDevices();
          this.post({ type: 'status', status: this.status });
          this.post({ type: 'flutter', running: this.flutter.running });
          this.post({ type: 'recording', active: !!this.recording });
          this.waitingForKeyFrame = true;
          this.session?.send(resetVideo());
          this.onDevicesChanged();
          break;
        case 'selectDevice':
          await this.selectDevice(message.serial);
          break;
        case 'launchAvd':
          await this.launch(message.avd, message.coldBoot);
          break;
        case 'touch': {
          const action = { down: MotionAction.Down, move: MotionAction.Move, up: MotionAction.Up }[message.action];
          this.session?.send(injectTouch(action, toPosition(message.point), message.action === 'up' ? 0 : 1));
          break;
        }
        case 'scroll':
          this.session?.send(injectScroll(toPosition(message.point), message.dx, message.dy));
          break;
        case 'key':
          this.pressKey(message.keycode, message.metaState);
          break;
        case 'text':
          for (const m of injectText(message.text)) this.session?.send(m);
          break;
        case 'nav':
          this.nav(message.key);
          break;
        case 'action':
          await this.runAction(message.action);
          break;
        case 'requestKeyFrame':
          this.waitingForKeyFrame = true;
          this.session?.send(resetVideo());
          break;
        case 'notice':
          if (message.error) void vscode.window.showErrorMessage(message.message);
          else void vscode.window.showInformationMessage(message.message);
          break;
        case 'decoderError':
          this.log.appendLine(`[webview] ${message.message}`);
          this.setStatus({ kind: 'error', message: message.message, serial: this.session?.serial });
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.log.appendLine(`[error] ${text}`);
      void vscode.window.showErrorMessage(text);
    }
  }

  private pressKey(keycode: number, metaState = 0): void {
    this.session?.send(injectKeycode(KeyAction.Down, keycode, 0, metaState));
    this.session?.send(injectKeycode(KeyAction.Up, keycode, 0, metaState));
  }

  private nav(key: NavKey): void {
    if (key === 'rotate') return this.session?.send(rotateDevice());
    if (key === 'notifications') return this.session?.send(expandNotificationPanel());
    const keycode = NAV_KEYCODES[key];
    if (keycode !== undefined) this.pressKey(keycode);
  }

  async runAction(action: ToolbarAction): Promise<void> {
    switch (action) {
      case 'hotReload':
      case 'hotRestart':
      case 'stop':
      case 'devTools':
        return runFlutterAction(action);
      case 'run':
        return runFlutterApp(this.requireSerial());
      case 'screenshot':
        return this.screenshot();
      case 'copyScreenshot':
        return this.copyScreenshot();
      case 'record':
        return this.toggleRecording();
      case 'manageEmulators':
        return this.manageEmulators();
      case 'reconnect':
        return this.reconnect();
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'flutterEmulatorView');
        return;
    }
  }

  private requireSerial(): string {
    const device = this.selectedDevice();
    if (!device || device.state !== 'device') throw new Error('No Android device is connected.');
    return device.serial;
  }

  // ---- capture ----------------------------------------------------------------------------

  async screenshot(): Promise<void> {
    const file = await saveScreenshot(this.requireSerial());
    const choice = await vscode.window.showInformationMessage(`Screenshot saved: ${vscode.workspace.asRelativePath(file)}`, 'Open');
    if (choice) await vscode.commands.executeCommand('vscode.open', file);
  }

  async copyScreenshot(): Promise<void> {
    const png = await captureScreenshot(this.requireSerial());
    // The extension host has no image clipboard; the webview writes it with ClipboardItem.
    this.post({ type: 'clipboardImage', png: new Uint8Array(png) });
  }

  async toggleRecording(): Promise<void> {
    if (this.recording) {
      const recording = this.recording;
      this.recording = undefined;
      this.post({ type: 'recording', active: false });
      const file = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Saving screen recording…' },
        () => recording.stop(),
      );
      const choice = await vscode.window.showInformationMessage(`Recording saved: ${vscode.workspace.asRelativePath(file)}`, 'Reveal');
      if (choice) await vscode.commands.executeCommand('revealFileInOS', file);
      return;
    }
    const serial = this.requireSerial();
    const recording = new Recording(serial, () => {
      // screenrecord stopped on its own (3-minute cap, or the device went away).
      if (this.recording !== recording) return;
      void this.toggleRecording();
    });
    this.recording = recording;
    this.post({ type: 'recording', active: true });
  }

  // ---- emulators --------------------------------------------------------------------------

  async manageEmulators(): Promise<void> {
    if (!resolveEmulatorPath()) {
      const choice = await vscode.window.showErrorMessage(
        'The Android emulator was not found. Set flutterEmulatorView.sdkPath to your Android SDK folder.',
        'Open Settings',
      );
      if (choice) await this.runAction('openSettings');
      return;
    }
    const avds = await listAvds();
    if (avds.length === 0) {
      void vscode.window.showInformationMessage('No emulators (AVDs) exist yet. Create one in Android Studio → Device Manager.');
      return;
    }
    type Item = vscode.QuickPickItem & { run?: () => Promise<void> };
    const items: Item[] = [];
    for (const avd of avds) {
      const running = this.tracker.devices.find((d) => d.avd === avd);
      items.push({ label: avd.replace(/_/g, ' '), kind: vscode.QuickPickItemKind.Separator });
      if (running) {
        items.push(
          { label: '$(eye) Mirror', description: running.serial, run: () => this.selectDevice(running.serial) },
          { label: '$(debug-stop) Stop', description: running.serial, run: () => killEmulator(running.serial) },
        );
      } else {
        items.push(
          { label: '$(play) Launch', description: avd, run: () => this.launch(avd, false) },
          { label: '$(debug-restart) Cold boot', description: avd, run: () => this.launch(avd, true) },
        );
      }
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Emulators' });
    await picked?.run?.();
  }

  async launch(avd: string, coldBoot: boolean): Promise<void> {
    const running = this.tracker.devices.find((d) => d.avd === avd);
    if (running) return this.selectDevice(running.serial);
    launchAvd(avd, { coldBoot });
    this.bootingAvd = avd;
    this.detach();
    this.setStatus({ kind: 'booting', avd });
    try {
      const serial = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Booting ${avd}`, cancellable: true },
        (_progress, token) => waitForBoot(this.tracker, avd, token),
      );
      this.bootingAvd = undefined;
      await this.selectDevice(serial);
      this.onDevicesChanged();
    } catch (error) {
      this.bootingAvd = undefined;
      if (error instanceof vscode.CancellationError) {
        void this.showNoDevice();
        return;
      }
      throw error;
    }
  }

  // ---- plumbing ---------------------------------------------------------------------------

  private async showNoDevice(): Promise<void> {
    if (this.bootingAvd) return;
    const emulatorAvailable = !!resolveEmulatorPath();
    let avds: string[] = [];
    try {
      avds = emulatorAvailable ? await listAvds() : [];
    } catch (error) {
      this.log.appendLine(`[emulator] ${error instanceof Error ? error.message : error}`);
    }
    if (this.tracker.devices.length > 0) return; // a device showed up meanwhile
    this.setStatus({ kind: 'noDevice', avds, emulatorAvailable });
  }

  private setStatus(status: ViewStatus): void {
    this.status = status;
    this.post({ type: 'status', status });
  }

  private postDevices(): void {
    const devices: DeviceSummary[] = this.tracker.devices.map((d) => ({
      serial: d.serial,
      label: deviceLabel(d),
      state: d.state,
      emulator: d.serial.startsWith('emulator-'),
    }));
    this.post({ type: 'devices', devices, selected: this.selected });
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private updateStatusBar(label: string | undefined): void {
    if (!label) {
      this.statusBar.hide();
      return;
    }
    this.statusBar.text = `$(device-mobile) ${label}`;
    this.statusBar.tooltip = 'Mirrored device: click to switch';
    this.statusBar.show();
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, file)).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('codicon.css')}">
<link rel="stylesheet" href="${uri('webview.css')}">
<title>Device</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${uri('webview.js')}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.detach();
    void this.recording?.stop().catch(() => undefined);
    this.subscriptions.forEach((s) => s.dispose());
  }
}

function toPosition(point: FramePoint) {
  return { x: point.x, y: point.y, width: point.width, height: point.height };
}
