import * as vscode from 'vscode';
import { DeviceTracker } from './adb';
import { DeviceViewProvider } from './deviceView';
import { EmulatorOwner } from './emulator';
import { FlutterSessions, isFlutterProject } from './flutter';
import { config } from './sdk';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Flutter Emulator View');
  const tracker = new DeviceTracker(log);
  const flutter = new FlutterSessions();
  const emulators = new EmulatorOwner(context.workspaceState, tracker, log);
  const provider = new DeviceViewProvider(context, tracker, emulators, flutter, log);

  const command = (id: string, run: () => unknown) =>
    vscode.commands.registerCommand(`flutterEmulatorView.${id}`, async () => {
      try {
        await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.appendLine(`[error] ${message}`);
        void vscode.window.showErrorMessage(message);
      }
    });

  context.subscriptions.push(
    log,
    tracker,
    flutter,
    provider,
    // Owned emulators are shut down when the window closes; see EmulatorOwner.
    emulators,
    vscode.window.registerWebviewViewProvider(DeviceViewProvider.viewId, provider, {
      // The decoder and canvas live in the webview; rebuilding them on every hide would drop
      // the stream until the next key frame.
      webviewOptions: { retainContextWhenHidden: true },
    }),
    command('selectDevice', () => provider.selectDevice()),
    command('manageEmulators', () => provider.manageEmulators()),
    command('reconnect', () => provider.reconnect()),
    command('screenshot', () => provider.screenshot()),
    command('copyScreenshot', () => provider.copyScreenshot()),
    command('toggleRecording', () => provider.toggleRecording()),
    command('runFlutter', () => provider.runAction('run')),
  );

  revealForFlutterProject().catch((error) => log.appendLine(`[startup] could not open the Device view: ${error}`));
}

/**
 * Shows the Device view when a Flutter project opens. Focusing is the only reliable way to
 * reveal a view (`.open` toggles it), so focus goes back to the editor afterwards.
 */
async function revealForFlutterProject(): Promise<void> {
  if (!config().get<boolean>('openOnFlutterProject', true)) return;
  if (!(vscode.workspace.workspaceFolders ?? []).some(isFlutterProject)) return;
  const hadEditor = !!vscode.window.activeTextEditor;
  await vscode.commands.executeCommand(`${DeviceViewProvider.viewId}.focus`);
  if (hadEditor) await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
