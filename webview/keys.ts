// Browser KeyboardEvent → Android keycodes and meta state.

const META_SHIFT_ON = 0x1 | 0x40; // META_SHIFT_ON | META_SHIFT_LEFT_ON
const META_ALT_ON = 0x2 | 0x10; // META_ALT_ON | META_ALT_LEFT_ON
const META_CTRL_ON = 0x1000 | 0x2000; // META_CTRL_ON | META_CTRL_LEFT_ON

const SPECIAL: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Tab: 61,
  Escape: 111,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

export type KeyIntent = { kind: 'key'; keycode: number; metaState: number } | { kind: 'text'; text: string };

/** The KeyboardEvent fields used, spelled out so the mapping is testable without the DOM. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function keyIntent(event: KeyLike): KeyIntent | undefined {
  const metaState = (event.shiftKey ? META_SHIFT_ON : 0) | (event.altKey ? META_ALT_ON : 0) | (event.ctrlKey || event.metaKey ? META_CTRL_ON : 0);
  const special = SPECIAL[event.key];
  if (special !== undefined) return { kind: 'key', keycode: special, metaState };
  if (event.ctrlKey || event.metaKey || event.altKey) {
    // Shortcuts (select all, copy, cut, paste, undo) as keycodes, so the app sees the chord.
    const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
    if (letter) return { kind: 'key', keycode: 29 + letter.charCodeAt(0) - 65, metaState };
    const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
    if (digit) return { kind: 'key', keycode: 7 + Number(digit), metaState };
    return undefined;
  }
  // Printable characters go through INJECT_TEXT, which handles any layout and non-ASCII.
  if ([...event.key].length === 1) return { kind: 'text', text: event.key };
  return undefined;
}
