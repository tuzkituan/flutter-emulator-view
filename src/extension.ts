import * as vscode from 'vscode';
import { DeviceTracker } from './adb';
import { DeviceViewProvider } from './deviceView';
import { FlutterSessions } from './flutter';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Flutter Emulator View');
  const tracker = new DeviceTracker(log);
  const flutter = new FlutterSessions();
  const provider = new DeviceViewProvider(context, tracker, flutter, log);

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
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
