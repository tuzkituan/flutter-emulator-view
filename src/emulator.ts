import { execFile, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { DeviceTracker, adbExec } from './adb';
import { resolveEmulatorPath } from './sdk';

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

/**
 * Starts the AVD as a detached process, so it outlives the extension host (closing VS Code
 * does not kill the emulator, as with Android Studio).
 */
export function launchAvd(avd: string, options: { coldBoot?: boolean } = {}): void {
  const emulator = resolveEmulatorPath();
  if (!emulator) throw new Error('The Android emulator was not found. Set flutterEmulatorView.sdkPath to your Android SDK.');
  const args = ['-avd', avd];
  if (options.coldBoot) args.push('-no-snapshot-load');
  const child = spawn(emulator, args, { detached: true, stdio: 'ignore' });
  child.unref();
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
