import { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { adbExec, adbExecBuffer, adbSpawn } from './adb';
import { config } from './sdk';

export async function captureScreenshot(serial: string): Promise<Buffer> {
  const png = await adbExecBuffer(['-s', serial, 'exec-out', 'screencap', '-p']);
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('The device did not return a PNG screenshot');
  }
  return png;
}

export async function saveScreenshot(serial: string): Promise<vscode.Uri> {
  const png = await captureScreenshot(serial);
  const file = vscode.Uri.file(path.join(await captureFolder(), `screenshot-${timestamp()}.png`));
  await vscode.workspace.fs.writeFile(file, png);
  return file;
}

/** Wraps `screenrecord`, which stops on SIGINT and caps itself at 3 minutes. */
export class Recording {
  private readonly remote = `/sdcard/flutter-emulator-view-${timestamp()}.mp4`;
  private readonly process: ChildProcess;
  private readonly exited: Promise<void>;

  constructor(readonly serial: string, onEnded: () => void) {
    this.process = adbSpawn(['-s', serial, 'shell', 'screenrecord', '--bit-rate', '8000000', this.remote]);
    this.exited = new Promise((resolve) => this.process.on('exit', () => resolve()));
    void this.exited.then(onEnded);
  }

  /** Stops the recording, pulls it into the capture folder and deletes the device copy. */
  async stop(): Promise<vscode.Uri> {
    if (this.process.exitCode === null) {
      // Killing the local adb client does not stop the device process, so signal it there.
      await adbExec(['-s', this.serial, 'shell', 'pkill', '-INT', 'screenrecord']).catch(() => undefined);
      await Promise.race([this.exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    // screenrecord finalises the MP4 moov atom just after its process exits.
    await new Promise((r) => setTimeout(r, 500));
    const local = path.join(await captureFolder(), `recording-${timestamp()}.mp4`);
    await adbExec(['-s', this.serial, 'pull', this.remote, local], { timeoutMs: 60000 });
    await adbExec(['-s', this.serial, 'shell', 'rm', '-f', this.remote]).catch(() => undefined);
    return vscode.Uri.file(local);
  }
}

async function captureFolder(): Promise<string> {
  const configured = config().get<string>('captureFolder') || '.screenshots';
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const folder = path.resolve(root ?? os.homedir(), configured);
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}
