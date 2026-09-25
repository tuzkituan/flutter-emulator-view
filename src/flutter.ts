import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** Dart-Code's debug type, shared by Dart and Flutter launches. */
const DART_DEBUG_TYPE = 'dart';

export type FlutterAction = 'hotReload' | 'hotRestart' | 'stop' | 'devTools';

/** Tracks whether a Dart/Flutter debug session is running, for the toolbar's enabled state. */
export class FlutterSessions implements vscode.Disposable {
  private readonly sessions = new Set<vscode.DebugSession>();
  private readonly emitter = new vscode.EventEmitter<boolean>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.debug.onDidStartDebugSession((s) => {
        if (s.type !== DART_DEBUG_TYPE) return;
        this.sessions.add(s);
        this.emitter.fire(true);
      }),
      vscode.debug.onDidTerminateDebugSession((s) => {
        if (!this.sessions.delete(s)) return;
        this.emitter.fire(this.running);
      }),
    ];
    const active = vscode.debug.activeDebugSession;
    if (active?.type === DART_DEBUG_TYPE) this.sessions.add(active);
  }

  get running(): boolean {
    return this.sessions.size > 0;
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

export async function runFlutterAction(action: FlutterAction): Promise<void> {
  const requireDartCode = async (command: string) => {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(command)) {
      throw new Error('The Dart and Flutter extensions (Dart-Code) are needed for Flutter controls.');
    }
    await vscode.commands.executeCommand(command);
  };
  switch (action) {
    case 'hotReload':
      return requireDartCode('flutter.hotReload');
    case 'hotRestart':
      return requireDartCode('flutter.hotRestart');
    case 'devTools':
      return requireDartCode('flutter.openDevTools');
    case 'stop':
      await vscode.commands.executeCommand('workbench.action.debug.stop');
      return;
  }
}

/**
 * Launches the app on [serial]. Reuses the first Dart configuration from launch.json when there
 * is one (so flavors, targets and args still apply), with the device pinned to the mirrored one.
 */
export async function runFlutterApp(serial: string): Promise<void> {
  const folder = flutterWorkspaceFolder();
  if (!folder) throw new Error('No Flutter project (a folder with pubspec.yaml) is open.');
  const configurations = vscode.workspace.getConfiguration('launch', folder).get<vscode.DebugConfiguration[]>('configurations') ?? [];
  const base = configurations.find((c) => c.type === DART_DEBUG_TYPE && c.request === 'launch');
  const configuration: vscode.DebugConfiguration = {
    ...(base ?? { type: DART_DEBUG_TYPE, request: 'launch', name: 'Flutter' }),
    deviceId: serial,
  };
  const started = await vscode.debug.startDebugging(folder, configuration);
  if (!started) throw new Error('VS Code did not start the Flutter debug session.');
}

function flutterWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.find((f) => fs.existsSync(path.join(f.uri.fsPath, 'pubspec.yaml'))) ?? folders[0];
}
