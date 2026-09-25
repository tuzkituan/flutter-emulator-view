// Serializers for scrcpy 3.x control messages (client → device). All integers are big-endian.

export enum ControlType {
  InjectKeycode = 0,
  InjectText = 1,
  InjectTouchEvent = 2,
  InjectScrollEvent = 3,
  BackOrScreenOn = 4,
  ExpandNotificationPanel = 5,
  ExpandSettingsPanel = 6,
  CollapsePanels = 7,
  RotateDevice = 11,
  ResetVideo = 17,
}

export enum KeyAction {
  Down = 0,
  Up = 1,
}

export enum MotionAction {
  Down = 0,
  Up = 1,
  Move = 2,
}

/**
 * A finger, not the mouse (-1): Flutter scrollables ignore mouse drags by default, so a mouse
 * pointer could tap but never scroll.
 */
export const POINTER_ID_GENERIC_FINGER = -2n;

/** The server drops any event whose frame size differs from the video it is currently sending. */
export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** scrcpy truncates injected text at 300 bytes. */
export const INJECT_TEXT_MAX_LENGTH = 300;

export function injectKeycode(action: KeyAction, keycode: number, repeat = 0, metaState = 0): Uint8Array {
  const out = new Uint8Array(14);
  const view = new DataView(out.buffer);
  view.setUint8(0, ControlType.InjectKeycode);
  view.setUint8(1, action);
  view.setUint32(2, keycode);
  view.setUint32(6, repeat);
  view.setUint32(10, metaState);
  return out;
}

/** Returns one message per 300-byte slice, never splitting a UTF-8 sequence. */
export function injectText(text: string): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let slice = '';
  let sliceBytes = 0;
  const encoder = new TextEncoder();
  for (const char of text) {
    const n = encoder.encode(char).length;
    if (sliceBytes + n > INJECT_TEXT_MAX_LENGTH) {
      messages.push(textMessage(encoder.encode(slice)));
      slice = '';
      sliceBytes = 0;
    }
    slice += char;
    sliceBytes += n;
  }
  if (slice.length > 0) messages.push(textMessage(encoder.encode(slice)));
  return messages;
}

function textMessage(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, ControlType.InjectText);
  view.setUint32(1, bytes.length);
  out.set(bytes, 5);
  return out;
}

export function injectTouch(
  action: MotionAction,
  position: Position,
  pressure: number,
  pointerId: bigint = POINTER_ID_GENERIC_FINGER,
): Uint8Array {
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setUint8(0, ControlType.InjectTouchEvent);
  view.setUint8(1, action);
  view.setBigInt64(2, pointerId);
  writePosition(view, 10, position);
  view.setUint16(22, toU16FixedPoint(pressure));
  view.setUint32(24, 0); // action button: none for a finger
  view.setUint32(28, 0); // buttons
  return out;
}

/** [hscroll] and [vscroll] are in scroll "clicks", clamped to ±16 like the scrcpy client. */
export function injectScroll(position: Position, hscroll: number, vscroll: number): Uint8Array {
  const out = new Uint8Array(21);
  const view = new DataView(out.buffer);
  view.setUint8(0, ControlType.InjectScrollEvent);
  writePosition(view, 1, position);
  view.setInt16(13, toI16FixedPoint(clamp(hscroll / 16, -1, 1)));
  view.setInt16(15, toI16FixedPoint(clamp(vscroll / 16, -1, 1)));
  view.setUint32(17, 0);
  return out;
}

export function backOrScreenOn(action: KeyAction): Uint8Array {
  return Uint8Array.of(ControlType.BackOrScreenOn, action);
}

export function rotateDevice(): Uint8Array {
  return Uint8Array.of(ControlType.RotateDevice);
}

/** Asks the encoder for a fresh key frame (and config), so decoding can restart cleanly. */
export function resetVideo(): Uint8Array {
  return Uint8Array.of(ControlType.ResetVideo);
}

export function expandNotificationPanel(): Uint8Array {
  return Uint8Array.of(ControlType.ExpandNotificationPanel);
}

function writePosition(view: DataView, offset: number, p: Position): void {
  view.setInt32(offset, Math.round(p.x));
  view.setInt32(offset + 4, Math.round(p.y));
  view.setUint16(offset + 8, p.width);
  view.setUint16(offset + 10, p.height);
}

/** [0, 1] → u16, where 1.0 maps to 0xffff. */
export function toU16FixedPoint(value: number): number {
  const v = clamp(value, 0, 1);
  return v >= 1 ? 0xffff : Math.floor(v * 0x10000);
}

/** [-1, 1] → i16, where 1.0 maps to 0x7fff. */
export function toI16FixedPoint(value: number): number {
  const v = clamp(value, -1, 1);
  if (v >= 1) return 0x7fff;
  return Math.max(-0x8000, Math.trunc(v * 0x8000));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
