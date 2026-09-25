import { describe, expect, it } from 'vitest';
import { CODEC_ID_H264, ConfigMerger, StreamEvent, VideoStreamParser } from '../src/scrcpy/stream';

function deviceName(name: string): Uint8Array {
  const out = new Uint8Array(64);
  out.set(new TextEncoder().encode(name));
  return out;
}

function codecMeta(width: number, height: number): Uint8Array {
  const out = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setUint32(0, CODEC_ID_H264);
  view.setUint32(4, width);
  view.setUint32(8, height);
  return out;
}

function frame(pts: bigint, flags: { config?: boolean; key?: boolean }, payload: number[]): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  let raw = pts;
  if (flags.config) raw |= 1n << 63n;
  if (flags.key) raw |= 1n << 62n;
  view.setBigUint64(0, raw);
  view.setUint32(8, payload.length);
  out.set(payload, 12);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const stream = concat(
  deviceName('sdk_gphone64_x86_64'),
  codecMeta(576, 1280),
  frame(0n, { config: true }, [0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f]),
  frame(1000n, { key: true }, [0, 0, 0, 1, 0x65, 1, 2, 3]),
  frame(17666n, {}, [0, 0, 0, 1, 0x41, 9]),
);

describe('VideoStreamParser', () => {
  it('parses the name, the codec header and flagged packets from one buffer', () => {
    const events = new VideoStreamParser().push(stream);
    expect(events.map((e) => e.kind)).toEqual(['deviceName', 'codec', 'packet', 'packet', 'packet']);
    expect(events[0]).toEqual({ kind: 'deviceName', name: 'sdk_gphone64_x86_64' });
    expect(events[1]).toEqual({ kind: 'codec', codecId: CODEC_ID_H264, width: 576, height: 1280 });
    const packets = events.filter((e): e is Extract<StreamEvent, { kind: 'packet' }> => e.kind === 'packet');
    expect(packets.map((p) => [p.pts, p.config, p.key])).toEqual([
      [0n, true, false],
      [1000n, false, true],
      [17666n, false, false],
    ]);
    expect([...packets[2].data]).toEqual([0, 0, 0, 1, 0x41, 9]);
  });

  it('gives the same events however the bytes are split', () => {
    const whole = new VideoStreamParser().push(stream);
    for (const size of [1, 3, 7, 13, 64]) {
      const parser = new VideoStreamParser();
      const events: StreamEvent[] = [];
      for (let i = 0; i < stream.length; i += size) events.push(...parser.push(stream.slice(i, i + size)));
      expect(events).toEqual(whole);
    }
  });

  it('waits for the rest of a packet instead of emitting a partial one', () => {
    const parser = new VideoStreamParser();
    const cut = stream.length - 3;
    expect(parser.push(stream.slice(0, cut)).filter((e) => e.kind === 'packet')).toHaveLength(2);
    expect(parser.push(stream.slice(cut)).map((e) => e.kind)).toEqual(['packet']);
  });
});

describe('ConfigMerger', () => {
  it('prepends the config packet to the next frame only', () => {
    const merger = new ConfigMerger();
    const sps = Uint8Array.of(0, 0, 0, 1, 0x67, 0x42);
    expect(merger.accept({ config: true, key: false, data: sps })).toBeUndefined();
    const key = merger.accept({ config: false, key: true, data: Uint8Array.of(0, 0, 0, 1, 0x65) })!;
    expect(key.hasConfig).toBe(true);
    expect(key.key).toBe(true);
    expect([...key.data]).toEqual([0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x65]);
    const next = merger.accept({ config: false, key: false, data: Uint8Array.of(7) })!;
    expect(next).toEqual({ key: false, hasConfig: false, data: Uint8Array.of(7) });
  });

  it('keeps its own copy of the config, which may sit in a reused socket buffer', () => {
    const merger = new ConfigMerger();
    const buffer = Uint8Array.of(0, 0, 1, 0x67);
    merger.accept({ config: true, key: false, data: buffer });
    buffer.fill(0xff);
    expect([...merger.accept({ config: false, key: true, data: Uint8Array.of(1) })!.data]).toEqual([0, 0, 1, 0x67, 1]);
  });

  it('merges a rotation config into the key frame that follows it', () => {
    const merger = new ConfigMerger();
    merger.accept({ config: true, key: false, data: Uint8Array.of(1) });
    merger.accept({ config: false, key: true, data: Uint8Array.of(2) });
    merger.accept({ config: false, key: false, data: Uint8Array.of(3) });
    merger.accept({ config: true, key: false, data: Uint8Array.of(4) });
    const rotated = merger.accept({ config: false, key: true, data: Uint8Array.of(5) })!;
    expect(rotated.hasConfig).toBe(true);
    expect([...rotated.data]).toEqual([4, 5]);
  });
});
