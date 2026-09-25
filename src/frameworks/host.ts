import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FrameworkId, parseFramework } from '../projectDetect';
import { config } from '../sdk';
import { FlutterAdapter } from './flutter';
import { ReactNativeAdapter } from './reactNative';
import type { FrameworkAdapter } from './types';

export interface FrameworkState {
  id: FrameworkId | undefined;
  running: boolean;
}

/**
 * Picks the adapter for the open workspace (Flutter or React Native, detected or forced by
 * `loupe.framework`) and swaps it when folders or that setting change.
 */
export class FrameworkHost implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<FrameworkState>();
  readonly onDidChange = this.emitter.event;
  adapter: FrameworkAdapter | undefined;
  private adapterSubscription: vscode.Disposable | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly log: vscode.OutputChannel) {
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('loupe.framework')) this.refresh();
      }),
    ];
    this.refresh();
  }

  get state(): FrameworkState {
    return { id: this.adapter?.id, running: this.adapter?.running ?? false };
  }

  private refresh(): void {
    const detected = detect();
    const current = this.adapter;
    if (current && detected && current.id === detected.id) return;
    this.adapterSubscription?.dispose();
    current?.dispose();
    this.adapter = detected?.create(this.log);
    this.adapterSubscription = this.adapter?.onDidChangeRunning(() => this.emitter.fire(this.state));
    this.emitter.fire(this.state);
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.adapterSubscription?.dispose();
    this.adapter?.dispose();
    this.emitter.dispose();
  }
}

interface Detection {
  id: FrameworkId;
  create(log: vscode.OutputChannel): FrameworkAdapter;
}

function detect(): Detection | undefined {
  const forced = config().get<string>('framework', 'auto');
  const folders = vscode.workspace.workspaceFolders ?? [];
  const found = folders.map((folder) => ({ folder, framework: parseFramework(readProjectFiles(folder)) }));
  const pick = (id: FrameworkId) => found.find((f) => f.framework?.id === id);

  let choice: { folder: vscode.WorkspaceFolder; id: FrameworkId; expo: boolean } | undefined;
  if (forced === 'flutter' || forced === 'reactNative') {
    const match = pick(forced);
    const folder = match?.folder ?? folders[0];
    if (folder) choice = { folder, id: forced, expo: match?.framework?.expo ?? false };
  } else {
    const match = pick('flutter') ?? pick('reactNative');
    if (match?.framework) choice = { folder: match.folder, id: match.framework.id, expo: match.framework.expo };
  }
  if (!choice) return undefined;
  const { folder, id, expo } = choice;
  return {
    id,
    create: (log) => (id === 'flutter' ? new FlutterAdapter(folder) : new ReactNativeAdapter(folder, expo, log)),
  };
}

function readProjectFiles(folder: vscode.WorkspaceFolder): { pubspec?: string; packageJson?: string } {
  const read = (name: string) => {
    try {
      return fs.readFileSync(path.join(folder.uri.fsPath, name), 'utf8');
    } catch {
      return undefined; // the file is not there
    }
  };
  return { pubspec: read('pubspec.yaml'), packageJson: read('package.json') };
}

/** For the startup auto-open: is there any project Loupe has controls for? */
export function hasSupportedProject(): boolean {
  return detect() !== undefined;
}
