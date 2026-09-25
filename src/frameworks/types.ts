import type * as vscode from 'vscode';
import type { FrameworkId } from '../projectDetect';

export type FrameworkAction = 'reload' | 'restart' | 'stop' | 'devTools' | 'devMenu';

/** The run loop of one kind of project, behind the Device view's framework buttons. */
export interface FrameworkAdapter extends vscode.Disposable {
  readonly id: FrameworkId;
  /** Enables the buttons that need a running app (a debug session, or Metro). */
  readonly running: boolean;
  readonly onDidChangeRunning: vscode.Event<boolean>;
  run(serial: string): Promise<void>;
  action(action: FrameworkAction, serial: string | undefined): Promise<void>;
  /** Called whenever the mirror attaches to a device. */
  onDeviceAttached?(serial: string): Promise<void>;
}
