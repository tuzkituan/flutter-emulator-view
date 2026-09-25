// Parser for the scrcpy video socket (protocol of scrcpy 3.x, forward tunnel, no audio).
//
// After the one-byte connection check (read by the caller), the socket carries:
//   64 bytes   device name, NUL padded                (send_device_meta)
//   12 bytes   codec id (u32 BE), width, height       (send_codec_meta)
//   then per packet:
//   12 bytes   u64 BE pts with flags, u32 BE size     (send_frame_meta)
//   size bytes packet payload (Annex B for H.264)

export const DEVICE_NAME_LENGTH = 64;
export const CODEC_META_LENGTH = 12;
export const FRAME_HEADER_LENGTH = 12;

const FLAG_CONFIG = 1n << 63n;
const FLAG_KEY_FRAME = 1n << 62n;
const PTS_MASK = FLAG_KEY_FRAME - 1n;

/** 'h264' as a big-endian u32. */
export const CODEC_ID_H264 = 0x68323634;

export type StreamEvent =
  | { kind: 'deviceName'; name: string }
  | { kind: 'codec'; codecId: number; width: number; height: number }
  | { kind: 'packet'; pts: bigint; config: boolean; key: boolean; data: Uint8Array };

type State = 'name' | 'codec' | 'header' | 'payload';

export class VideoStreamParser {
  private state: State = 'name';
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private header = { pts: 0n, config: false, key: false, size: 0 };

  /** Feeds bytes as they arrive and returns every event they complete. */
  push(chunk: Uint8Array): StreamEvent[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    const events: StreamEvent[] = [];
    for (;;) {
      const need = this.needed();
      if (this.buffered < need) return events;
      const bytes = this.take(need);
      const event = this.consume(bytes);
      if (event) events.push(event);
    }
  }

  private needed(): number {
    switch (this.state) {
      case 'name':
        return DEVICE_NAME_LENGTH;
      case 'codec':
        return CODEC_META_LENGTH;
      case 'header':
        return FRAME_HEADER_LENGTH;
      case 'payload':
        return this.header.size;
    }
  }

  private consume(bytes: Uint8Array): StreamEvent | undefined {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    switch (this.state) {
      case 'name': {
        const end = bytes.indexOf(0);
        const name = new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
        this.state = 'codec';
        return { kind: 'deviceName', name };
      }
      case 'codec': {
        this.state = 'header';
        return {
          kind: 'codec',
          codecId: view.getUint32(0),
          width: view.getUint32(4),
          height: view.getUint32(8),
        };
      }
      case 'header': {
        const raw = view.getBigUint64(0);
        this.header = {
          pts: raw & PTS_MASK,
          config: (raw & FLAG_CONFIG) !== 0n,
          key: (raw & FLAG_KEY_FRAME) !== 0n,
          size: view.getUint32(8),
        };
        this.state = 'payload';
        return undefined;
      }
      case 'payload': {
        this.state = 'header';
        const { pts, config, key } = this.header;
        return { kind: 'packet', pts, config, key, data: bytes };
      }
    }
  }

  /** Removes exactly [count] bytes from the front of the buffer, copying only when they span chunks. */
  private take(count: number): Uint8Array {
    const first = this.chunks[0];
    if (count === 0) return new Uint8Array(0);
    if (first.length >= count) {
      const out = first.subarray(0, count);
      if (first.length === count) this.chunks.shift();
      else this.chunks[0] = first.subarray(count);
      this.buffered -= count;
      return out;
    }
    const out = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const head = this.chunks[0];
      const n = Math.min(head.length, count - offset);
      out.set(head.subarray(0, n), offset);
      offset += n;
      if (n === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(n);
    }
    this.buffered -= count;
    return out;
  }
}

export interface DecodablePacket {
  key: boolean;
  /** True when SPS/PPS were prepended, so the decoder must be (re)configured from this packet. */
  hasConfig: boolean;
  data: Uint8Array;
}

/**
 * The encoder emits SPS/PPS as a separate config packet. Decoders want them in front of the
 * next key frame, which is what the scrcpy client does too.
 */
export class ConfigMerger {
  private pendingConfig: Uint8Array | undefined;

  accept(packet: { config: boolean; key: boolean; data: Uint8Array }): DecodablePacket | undefined {
    if (packet.config) {
      this.pendingConfig = packet.data.slice();
      return undefined;
    }
    const config = this.pendingConfig;
    if (!config) return { key: packet.key, hasConfig: false, data: packet.data };
    this.pendingConfig = undefined;
    const data = new Uint8Array(config.length + packet.data.length);
    data.set(config, 0);
    data.set(packet.data, config.length);
    return { key: packet.key, hasConfig: true, data };
  }
}
