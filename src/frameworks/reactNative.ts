import * as vscode from 'vscode';
import { adbExec } from '../adb';
import { config } from '../sdk';
import { MetroBroadcast, isMetroStatus, metroBroadcast, metroUrls } from './metro';
import type { FrameworkAction, FrameworkAdapter } from './types';

const POLL_MS = 3000;

/**
 * Drives Metro (bare React Native CLI) or the Expo dev server. "Running" means the dev server
 * answers; reload and the dev menu go through its message socket, like the CLI's r and d keys.
 */
export class ReactNativeAdapter implements FrameworkAdapter {
  readonly id = 'reactNative';
  private readonly emitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeRunning = this.emitter.event;
  private metroUp = false;
  private timer: NodeJS.Timeout | undefined;
  /** The terminal that runs the dev server, when Loupe started it. */
  private serverTerminal: vscode.Terminal | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly folder: vscode.WorkspaceFolder,
    private readonly expo: boolean,
    private readonly log: vscode.OutputChannel,
  ) {
    this.subscriptions = [
      vscode.window.onDidCloseTerminal((t) => {
        if (t === this.serverTerminal) this.serverTerminal = undefined;
      }),
    ];
    void this.poll();
  }

  get running(): boolean {
    return this.metroUp;
  }

  private get port(): number {
    return config().get<number>('metroPort', 8081);
  }

  private async poll(): Promise<void> {
    const up = await this.metroRunning();
    if (up !== this.metroUp) {
      this.metroUp = up;
      this.emitter.fire(up);
    }
    this.timer = setTimeout(() => void this.poll(), POLL_MS);
  }

  private async metroRunning(): Promise<boolean> {
    try {
      const response = await fetch(metroUrls(this.port).status, { signal: AbortSignal.timeout(1500) });
      return isMetroStatus(await response.text());
    } catch {
      return false; // nothing listening on the port
    }
  }

  async run(serial: string): Promise<void> {
    const port = this.port;
    if (this.expo) {
      // Builds, installs and starts the dev server in one terminal.
      this.serverTerminal ??= this.terminal('Loupe: Expo');
      this.serverTerminal.show(true);
      this.serverTerminal.sendText(`npx expo run:android --device ${serial} --port ${port}`);
      return;
    }
    if (!(await this.metroRunning()) && !this.serverTerminal) {
      this.serverTerminal = this.terminal('Loupe: Metro');
      this.serverTerminal.sendText(`npx react-native start --port ${port}`);
    }
    // --no-packager: the CLI would otherwise open Metro in an external terminal window.
    const build = this.terminal('Loupe: Android');
    build.show(true);
    build.sendText(`npx react-native run-android --device ${serial} --no-packager --port ${port}`);
  }

  async action(action: FrameworkAction, serial: string | undefined): Promise<void> {
    switch (action) {
      case 'reload':
      case 'restart':
        return this.broadcast('reload', serial);
      case 'devMenu':
        return this.broadcast('devMenu', serial);
      case 'devTools': {
        const response = await fetch(metroUrls(this.port).openDebugger, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
        if (!response?.ok) {
          throw new Error('Could not open React Native DevTools. It needs Metro running and React Native 0.73 or newer.');
        }
        return;
      }
      case 'stop':
        if (this.serverTerminal) {
          this.serverTerminal.dispose();
          this.serverTerminal = undefined;
          return;
        }
        if (this.metroUp) {
          void vscode.window.showInformationMessage(`Metro on port ${this.port} was started outside Loupe; stop it in its own terminal.`);
        }
        return;
    }
  }

  /** Falls back to key events when the dev server is unreachable: R R reloads, MENU opens the dev menu. */
  private async broadcast(method: MetroBroadcast, serial: string | undefined): Promise<void> {
    try {
      await sendOverSocket(metroUrls(this.port).messageSocket, metroBroadcast(method));
      return;
    } catch (error) {
      this.log.appendLine(`[metro] ${method} over the message socket failed: ${error instanceof Error ? error.message : error}`);
    }
    if (!serial) throw new Error(`Metro is not running on port ${this.port}.`);
    const keys = method === 'reload' ? ['46', '46'] : ['82'];
    await adbExec(['-s', serial, 'shell', 'input', 'keyevent', ...keys]);
  }

  /** A USB phone cannot reach the host's localhost without a reverse forward; emulators get one too. */
  async onDeviceAttached(serial: string): Promise<void> {
    const port = String(this.port);
    await adbExec(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]).catch((error) =>
      this.log.appendLine(`[metro] adb reverse failed: ${error instanceof Error ? error.message : error}`),
    );
  }

  private terminal(name: string): vscode.Terminal {
    return vscode.window.createTerminal({ name, cwd: this.folder.uri });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
    // The dev server terminal is left open: closing a window should not kill a running Metro
    // the user may still be using from another one.
  }
}

function sendOverSocket(url: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('timed out'));
    }, 3000);
    socket.addEventListener('open', () => {
      socket.send(payload);
      clearTimeout(timeout);
      // Give the frame a moment to flush before closing.
      setTimeout(() => socket.close(), 100);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('could not connect'));
    });
  });
}
