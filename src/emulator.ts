import { execFile, execFileSync, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { DeviceTracker, adbExec } from './adb';
import { isEmulatorCommandFor } from './adbProtocol';
import { resolveAdbPath, resolveEmulatorPath } from './sdk';

export async function listAvds(): Promise<string[]> {
  const emulator = resolveEmulatorPath();
  if (!emulator) return [];
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(emulator, ['-list-avds'], { timeout: 15000 }, (error, out) => (error ? reject(error) : resolve(out)));
  });
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    // Newer emulators print INFO/WARNING lines on stdout before the list.
    .filter((l) => l.length > 0 && !/^(INFO|WARNING|ERROR)\b/.test(l));
}

interface OwnedEmulator {
  avd: string;
  pid: number;
}

const OWNED_KEY = 'flutterEmulatorView.ownedEmulators';

/**
 * Emulators launched from the view run headless and belong to this window: closing it shuts
 * them down. Emulators started anywhere else are mirrored but never touched.
 *
 * The owned list is also kept in workspace state, so an emulator orphaned by an extension host
 * crash is picked up again on the next activation instead of running invisibly forever.
 */
export class EmulatorOwner implements vscode.Disposable {
  private readonly owned = new Map<string, OwnedEmulator>();

  constructor(
    private readonly state: vscode.Memento,
    private readonly tracker: DeviceTracker,
    private readonly log: vscode.OutputChannel,
  ) {
    this.adopt();
  }

  launch(avd: string, options: { coldBoot?: boolean } = {}): void {
    const emulator = resolveEmulatorPath();
    if (!emulator) throw new Error('The Android emulator was not found. Set flutterEmulatorView.sdkPath to your Android SDK.');
    const args = ['-avd', avd, '-no-window'];
    if (options.coldBoot) args.push('-no-snapshot-load');
    // Detached so a VS Code crash cannot take the emulator down mid-write; dispose() stops it.
    const child = spawn(emulator, args, { detached: true, stdio: 'ignore' });
    child.unref();
    if (child.pid === undefined) throw new Error(`Could not start the emulator for ${avd}.`);
    const entry = { avd, pid: child.pid };
    this.owned.set(avd, entry);
    child.on('exit', () => {
      if (this.owned.get(avd) === entry) this.forget(avd);
    });
    this.save();
  }

  owns(avd: string): boolean {
    return this.owned.has(avd);
  }

  forget(avd: string): void {
    if (this.owned.delete(avd)) this.save();
  }

  private adopt(): void {
    if (process.platform === 'win32') return;
    for (const entry of this.state.get<OwnedEmulator[]>(OWNED_KEY, [])) {
      try {
        process.kill(entry.pid, 0);
        const command = execFileSync('ps', ['-p', String(entry.pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 });
        if (isEmulatorCommandFor(command, entry.avd)) {
          this.owned.set(entry.avd, entry);
          this.log.appendLine(`[emulator] adopted ${entry.avd} (pid ${entry.pid}) left over from an earlier session`);
        }
      } catch {
        // Gone, or the pid now belongs to something else: drop the entry, kill nothing.
      }
    }
    this.save();
  }

  private save(): void {
    void this.state.update(OWNED_KEY, [...this.owned.values()]);
  }

  /** Shuts every owned emulator down. Runs while the extension host is exiting. */
  dispose(): void {
    for (const { avd, pid } of this.owned.values()) {
      const serial = this.tracker.devices.find((d) => d.avd === avd)?.serial;
      try {
        if (serial) {
          // A console `kill` shuts down cleanly and saves the quick-boot snapshot. The adb
          // client is detached so it finishes after this process has exited.
          spawn(resolveAdbPath(), ['-s', serial, 'emu', 'kill'], { detached: true, stdio: 'ignore' }).unref();
        } else {
          process.kill(pid, 'SIGTERM');
        }
      } catch (error) {
        this.log.appendLine(`[emulator] could not stop ${avd}: ${error instanceof Error ? error.message : error}`);
      }
    }
    this.owned.clear();
    this.save();
  }
}

export async function killEmulator(serial: string): Promise<void> {
  await adbExec(['-s', serial, 'emu', 'kill'], { timeoutMs: 10000 });
}

/** Resolves with the serial once the AVD is listed and Android reports boot completed. */
export async function waitForBoot(
  tracker: DeviceTracker,
  avd: string,
  token: vscode.CancellationToken,
  timeoutMs = 180000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    const device = tracker.devices.find((d) => d.avd === avd && d.state === 'device');
    if (device) {
      try {
        const { stdout } = await adbExec(['-s', device.serial, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 5000 });
        if (stdout.trim() === '1') return device.serial;
      } catch {
        // adbd restarts once during boot; keep polling.
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${avd} did not finish booting within ${Math.round(timeoutMs / 1000)} s`);
}
