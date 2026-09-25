import { describe, expect, it } from 'vitest';
import {
  KeyAction,
  MotionAction,
  backOrScreenOn,
  injectKeycode,
  injectScroll,
  injectText,
  injectTouch,
  resetVideo,
  rotateDevice,
  toI16FixedPoint,
  toU16FixedPoint,
} from '../src/scrcpy/control';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const position = { x: 100, y: 200, width: 1080, height: 2400 };

describe('control messages', () => {
  it('serializes a keycode', () => {
    // type 0, action up, KEYCODE_BACK (4), repeat 0, meta ctrl
    expect(hex(injectKeycode(KeyAction.Up, 4, 0, 0x3000))).toBe('00' + '01' + '00000004' + '00000000' + '00003000');
  });

  it('serializes a finger touch, 32 bytes', () => {
    const bytes = injectTouch(MotionAction.Down, position, 1);
    expect(bytes.length).toBe(32);
    expect(hex(bytes)).toBe(
      '02' + // inject touch
        '00' + // ACTION_DOWN
        'fffffffffffffffe' + // pointer id -2 (generic finger)
        '00000064' + '000000c8' + // x 100, y 200
        '0438' + '0960' + // 1080 x 2400
        'ffff' + // pressure 1.0
        '00000000' + // action button
        '00000000', // buttons
    );
  });

  it('writes zero pressure on touch up and rounds fractional positions', () => {
    const bytes = injectTouch(MotionAction.Up, { ...position, x: 10.6, y: 0.4 }, 0);
    expect(hex(bytes.subarray(10, 18))).toBe('0000000b' + '00000000');
    expect(hex(bytes.subarray(22, 24))).toBe('0000');
  });

  it('serializes a scroll, 21 bytes, clamped to ±16 notches', () => {
    const bytes = injectScroll(position, 0, 1);
    expect(bytes.length).toBe(21);
    expect(hex(bytes.subarray(0, 1))).toBe('03');
    expect(hex(bytes.subarray(13, 17))).toBe('0000' + '0800'); // 1/16 of full scale
    expect(hex(injectScroll(position, -100, 100).subarray(13, 17))).toBe('8000' + '7fff');
  });

  it('serializes the single-byte messages', () => {
    expect(hex(backOrScreenOn(KeyAction.Down))).toBe('0400');
    expect(hex(rotateDevice())).toBe('0b');
    expect(hex(resetVideo())).toBe('11');
  });

  it('splits long text at 300 bytes without breaking a UTF-8 character', () => {
    const text = 'ế'.repeat(160); // 3 bytes each: 480 bytes
    const messages = injectText(text);
    expect(messages).toHaveLength(2);
    const lengths = messages.map((m) => new DataView(m.buffer).getUint32(1));
    expect(lengths).toEqual([300, 180]);
    const decoded = messages.map((m) => new TextDecoder().decode(m.subarray(5))).join('');
    expect(decoded).toBe(text);
  });

  it('converts fixed-point values like the scrcpy client', () => {
    expect(toU16FixedPoint(0)).toBe(0);
    expect(toU16FixedPoint(0.5)).toBe(0x8000);
    expect(toU16FixedPoint(1)).toBe(0xffff);
    expect(toI16FixedPoint(-1)).toBe(-0x8000);
    expect(toI16FixedPoint(0.5)).toBe(0x4000);
    expect(toI16FixedPoint(1)).toBe(0x7fff);
  });
});
