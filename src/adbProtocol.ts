// Pure parsing of adb output, kept apart from adb.ts so it can be tested without a device.

export type DeviceState = 'device' | 'offline' | 'unauthorized' | 'authorizing' | 'no permissions' | string;

export interface DeviceEntry {
  serial: string;
  state: DeviceState;
}

/**
 * `adb track-devices` writes, per change, a 4-hex-digit length followed by that many bytes of
 * `serial\tstate\n` lines. Feed raw stdout chunks; each complete message yields a device list.
 */
export class TrackDevicesParser {
  private buffer = '';

  push(chunk: string): DeviceEntry[][] {
    this.buffer += chunk;
    const lists: DeviceEntry[][] = [];
    for (;;) {
      if (this.buffer.length < 4) return lists;
      const length = parseInt(this.buffer.slice(0, 4), 16);
      if (Number.isNaN(length)) {
        // Out of sync (a warning line, for instance): drop up to the next newline and retry.
        const newline = this.buffer.indexOf('\n');
        this.buffer = newline < 0 ? '' : this.buffer.slice(newline + 1);
        continue;
      }
      if (this.buffer.length < 4 + length) return lists;
      lists.push(parseDeviceLines(this.buffer.slice(4, 4 + length)));
      this.buffer = this.buffer.slice(4 + length);
    }
  }
}

export function parseDeviceLines(text: string): DeviceEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('List of devices') && !line.startsWith('*'))
    .map((line) => {
      const [serial, ...rest] = line.split(/\s+/);
      return { serial, state: rest.join(' ') };
    })
    .filter((d) => d.serial.length > 0 && d.state.length > 0);
}

/** `adb forward tcp:0 …` prints the port adb picked. */
export function parseForwardPort(stdout: string): number {
  const port = parseInt(stdout.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`adb forward did not return a port: ${JSON.stringify(stdout)}`);
  }
  return port;
}

/** `scrcpy --version` → "3.3.4". */
export function parseScrcpyVersion(stdout: string): string | undefined {
  return /^scrcpy\s+(\d+(?:\.\d+)+)/m.exec(stdout)?.[1];
}

/** `adb -s emulator-5554 emu avd name` prints the AVD name, then `OK`. */
export function parseEmuAvdName(stdout: string): string | undefined {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l !== 'OK');
  return line;
}

/**
 * True when a `ps -o command=` line is an emulator (the launcher or its qemu child) running
 * [avd], so a stored pid is only trusted while it still points at that emulator.
 */
export function isEmulatorCommandFor(command: string, avd: string): boolean {
  const args = command.trim().split(/\s+/);
  const program = args[0] ?? '';
  if (!/(^|\/)(emulator|qemu-system-[^/]*)$/.test(program) && !program.includes('/emulator/')) return false;
  const i = args.indexOf('-avd');
  return i >= 0 && args[i + 1] === avd;
}
