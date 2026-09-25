import { ChildProcess, execFile, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { DeviceEntry, TrackDevicesParser, parseEmuAvdName } from './adbProtocol';
import { resolveAdbPath } from './sdk';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export function adbExec(args: string[], options: { timeoutMs?: number; encoding?: 'utf8' } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveAdbPath(),
      args,
      { timeout: options.timeoutMs ?? 15000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`adb ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** Binary stdout, for `exec-out screencap -p`. */
export function adbExecBuffer(args: string[], timeoutMs = 15000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      resolveAdbPath(),
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`adb ${args.join(' ')} failed: ${stderr.toString().trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function adbSpawn(args: string[]): ChildProcess {
  return spawn(resolveAdbPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface Device extends DeviceEntry {
  /** The AVD name, for an emulator. */
  avd?: string;
}

/**
 * Follows `adb track-devices`, which pushes a full list on every change, and restarts it with
 * backoff if the adb server goes away (Flutter or Android Studio restarting it, for instance).
 */
export class DeviceTracker implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Device[]>();
  readonly onDidChange = this.emitter.event;
  private process: ChildProcess | undefined;
  private disposed = false;
  private retryMs = 500;
  private retryTimer: NodeJS.Timeout | undefined;
  private avdNames = new Map<string, string>();
  devices: Device[] = [];

  constructor(private readonly log: vscode.OutputChannel) {
    this.start();
  }

  private start(): void {
    if (this.disposed) return;
    const parser = new TrackDevicesParser();
    const child = adbSpawn(['track-devices']);
    this.process = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.retryMs = 500;
      for (const list of parser.push(chunk)) void this.update(list);
    });
    child.stderr?.on('data', (chunk: Buffer) => this.log.appendLine(`[adb track-devices] ${chunk.toString().trim()}`));
    child.on('error', (error) => this.log.appendLine(`[adb track-devices] ${error.message}`));
    child.on('exit', () => {
      if (this.disposed) return;
      void this.update([]);
      this.retryTimer = setTimeout(() => this.start(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10000);
    });
  }

  private async update(list: DeviceEntry[]): Promise<void> {
    const devices: Device[] = [];
    for (const entry of list) {
      let avd = this.avdNames.get(entry.serial);
      if (!avd && entry.serial.startsWith('emulator-') && entry.state === 'device') {
        avd = await queryAvdName(entry.serial);
        if (avd) this.avdNames.set(entry.serial, avd);
      }
      devices.push({ ...entry, avd });
    }
    for (const serial of [...this.avdNames.keys()]) {
      if (!list.some((d) => d.serial === serial)) this.avdNames.delete(serial);
    }
    this.devices = devices;
    this.emitter.fire(devices);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.process?.kill();
    this.emitter.dispose();
  }
}

async function queryAvdName(serial: string): Promise<string | undefined> {
  try {
    const { stdout } = await adbExec(['-s', serial, 'emu', 'avd', 'name'], { timeoutMs: 5000 });
    return parseEmuAvdName(stdout);
  } catch {
    // Older emulators without the console command: the serial is still usable as a label.
    return undefined;
  }
}

export function deviceLabel(device: Device): string {
  return device.avd ? `${device.avd.replace(/_/g, ' ')} (${device.serial})` : device.serial;
}
