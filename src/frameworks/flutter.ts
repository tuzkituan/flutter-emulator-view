import * as vscode from 'vscode';
import type { FrameworkAction, FrameworkAdapter } from './types';

/** Dart-Code's debug type, shared by Dart and Flutter launches. */
const DART_DEBUG_TYPE = 'dart';

/** Drives the Dart-Code debug session: hot reload and restart only exist while one runs. */
export class FlutterAdapter implements FrameworkAdapter {
  readonly id = 'flutter';
  private readonly sessions = new Set<vscode.DebugSession>();
  private readonly emitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeRunning = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly folder: vscode.WorkspaceFolder) {
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

  /**
   * Launches the app on [serial]. Reuses the first Dart configuration from launch.json when there
   * is one (so flavors, targets and args still apply), with the device pinned to the mirrored one.
   */
  async run(serial: string): Promise<void> {
    const configurations =
      vscode.workspace.getConfiguration('launch', this.folder).get<vscode.DebugConfiguration[]>('configurations') ?? [];
    const base = configurations.find((c) => c.type === DART_DEBUG_TYPE && c.request === 'launch');
    const configuration: vscode.DebugConfiguration = {
      ...(base ?? { type: DART_DEBUG_TYPE, request: 'launch', name: 'Flutter' }),
      deviceId: serial,
    };
    const started = await vscode.debug.startDebugging(this.folder, configuration);
    if (!started) throw new Error('VS Code did not start the Flutter debug session.');
  }

  async action(action: FrameworkAction): Promise<void> {
    switch (action) {
      case 'reload':
        return requireDartCode('flutter.hotReload');
      case 'restart':
        return requireDartCode('flutter.hotRestart');
      case 'devTools':
        return requireDartCode('flutter.openDevTools');
      case 'stop':
        await vscode.commands.executeCommand('workbench.action.debug.stop');
        return;
      case 'devMenu':
        return; // Flutter has no in-app dev menu
    }
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.emitter.dispose();
  }
}

async function requireDartCode(command: string): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(command)) {
    throw new Error('The Dart and Flutter extensions (Dart-Code) are needed for Flutter controls.');
  }
  await vscode.commands.executeCommand(command);
}
