import { describe, expect, it } from 'vitest';
import {
  TrackDevicesParser,
  isEmulatorCommandFor,
  parseDeviceLines,
  parseEmuAvdName,
  parseForwardPort,
  parseScrcpyVersion,
} from '../src/adbProtocol';
import { avcCodecString } from '../src/h264';
import { KeyLike, keyIntent } from '../webview/keys';

const message = (body: string) => body.length.toString(16).padStart(4, '0') + body;

describe('adb output', () => {
  it('parses track-devices messages across chunk boundaries', () => {
    const parser = new TrackDevicesParser();
    const stream = message('emulator-5554\tdevice\n') + message('') + message('emulator-5554\toffline\nR5CT\tunauthorized\n');
    const lists = [...parser.push(stream.slice(0, 10)), ...parser.push(stream.slice(10))];
    expect(lists).toEqual([
      [{ serial: 'emulator-5554', state: 'device' }],
      [],
      [
        { serial: 'emulator-5554', state: 'offline' },
        { serial: 'R5CT', state: 'unauthorized' },
      ],
    ]);
  });

  it('skips a non-protocol line and resynchronises', () => {
    const parser = new TrackDevicesParser();
    expect(parser.push('* daemon started successfully\n' + message('abc\tdevice\n'))).toEqual([[{ serial: 'abc', state: 'device' }]]);
  });

  it('parses `adb devices` output, including multi-word states', () => {
    expect(parseDeviceLines('List of devices attached\nemulator-5554\tdevice\nX1\tno permissions (user not in plugdev)\n\n')).toEqual([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'X1', state: 'no permissions (user not in plugdev)' },
    ]);
  });

  it('reads the forwarded port, the scrcpy version and the AVD name', () => {
    expect(parseForwardPort('41237\n')).toBe(41237);
    expect(() => parseForwardPort('error: closed')).toThrow();
    expect(parseScrcpyVersion('scrcpy 3.3.4 <https://github.com/Genymobile/scrcpy>\n\nDependencies (compiled / linked):\n')).toBe('3.3.4');
    expect(parseEmuAvdName('Pixel_7\r\nOK\r\n')).toBe('Pixel_7');
  });
});

describe('isEmulatorCommandFor', () => {
  it('matches the launcher and its qemu child for the same AVD', () => {
    expect(isEmulatorCommandFor('/home/u/Android/Sdk/emulator/emulator -avd Pixel_7 -no-window', 'Pixel_7')).toBe(true);
    expect(isEmulatorCommandFor('/home/u/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless -avd Pixel_7 -no-window', 'Pixel_7')).toBe(true);
    expect(isEmulatorCommandFor('emulator -avd Pixel_7', 'Pixel_7')).toBe(true);
  });

  it('rejects a reused pid or another AVD', () => {
    expect(isEmulatorCommandFor('/usr/bin/node server.js', 'Pixel_7')).toBe(false);
    expect(isEmulatorCommandFor('/usr/bin/vim notes-avd Pixel_7', 'Pixel_7')).toBe(false);
    expect(isEmulatorCommandFor('/opt/sdk/emulator/emulator -avd Pixel_7_Pro', 'Pixel_7')).toBe(false);
    expect(isEmulatorCommandFor('', 'Pixel_7')).toBe(false);
  });
});

describe('avcCodecString', () => {
  it('builds avc1.PPCCLL from the leading SPS', () => {
    expect(avcCodecString(Uint8Array.of(0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xda, 0, 0, 0, 1, 0x68, 0xce))).toBe('avc1.42c01f');
    expect(avcCodecString(Uint8Array.of(0, 0, 1, 0x27, 0x64, 0x00, 0x28))).toBe('avc1.640028');
  });

  it('ignores buffers that do not start with an SPS', () => {
    expect(avcCodecString(Uint8Array.of(0, 0, 0, 1, 0x65, 1, 2, 3))).toBeUndefined();
    expect(avcCodecString(Uint8Array.of(1, 2, 3))).toBeUndefined();
  });
});

describe('keyIntent', () => {
  const key = (k: string, code = '', mods: Partial<KeyLike> = {}) =>
    keyIntent({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('sends printable characters as text, including non-ASCII', () => {
    expect(key('a', 'KeyA')).toEqual({ kind: 'text', text: 'a' });
    expect(key('A', 'KeyA', { shiftKey: true })).toEqual({ kind: 'text', text: 'A' });
    expect(key('ư')).toEqual({ kind: 'text', text: 'ư' });
  });

  it('maps editing keys and shortcuts to keycodes', () => {
    expect(key('Backspace')).toEqual({ kind: 'key', keycode: 67, metaState: 0 });
    expect(key('ArrowLeft', 'ArrowLeft', { shiftKey: true })).toEqual({ kind: 'key', keycode: 21, metaState: 0x41 });
    expect(key('a', 'KeyA', { ctrlKey: true })).toEqual({ kind: 'key', keycode: 29, metaState: 0x3000 });
    expect(key('v', 'KeyV', { metaKey: true })).toEqual({ kind: 'key', keycode: 50, metaState: 0x3000 });
  });

  it('ignores bare modifiers and function keys', () => {
    expect(key('Shift', 'ShiftLeft', { shiftKey: true })).toBeUndefined();
    expect(key('F5', 'F5')).toBeUndefined();
  });
});
