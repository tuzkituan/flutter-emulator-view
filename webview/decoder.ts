import { avcCodecString } from '../src/h264';

export interface DecoderCallbacks {
  /** The decoded frame size changed (first frame, or a rotation). */
  onSize(width: number, height: number): void;
  /** Decoding cannot work at all (no H.264 in this VS Code build, for instance). */
  onFatal(message: string): void;
  /** A decode error: decoding restarts at the next key frame. */
  onNeedKeyFrame(): void;
}

/**
 * WebCodecs H.264 → canvas. Frames are drawn on the next animation frame, and a frame that
 * arrives before the previous one was drawn replaces it, so a slow paint never queues latency.
 */
export class H264Decoder {
  private decoder: VideoDecoder | undefined;
  private codec: string | undefined;
  private timestamp = 0;
  private pending: VideoFrame | undefined;
  private rafScheduled = false;
  private readonly context: CanvasRenderingContext2D;
  private fatal = false;
  private configuring: Promise<void> = Promise.resolve();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly callbacks: DecoderCallbacks) {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Canvas 2D is not available');
    this.context = context;
  }

  push(packet: { key: boolean; hasConfig: boolean; data: Uint8Array }): void {
    if (this.fatal) return;
    if (packet.hasConfig) {
      const codec = avcCodecString(packet.data);
      if (codec && codec !== this.codec) {
        this.codec = codec;
        this.configuring = this.configure(codec);
      }
    }
    void this.configuring.then(() => this.decode(packet));
  }

  private async configure(codec: string): Promise<void> {
    if (typeof VideoDecoder === 'undefined') {
      this.failFatal('This VS Code build has no WebCodecs VideoDecoder, so the stream cannot be decoded.');
      return;
    }
    const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
    const support = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!support.supported) {
      this.failFatal(`This VS Code build cannot decode H.264 (${codec}) with WebCodecs.`);
      return;
    }
    this.closeDecoder();
    const decoder = new VideoDecoder({
      output: (frame) => this.present(frame),
      error: (error) => {
        // The decoder is closed after an error; build a new one from the next config packet.
        console.error('VideoDecoder error', error);
        if (this.decoder === decoder) this.decoder = undefined;
        this.codec = undefined;
        this.callbacks.onNeedKeyFrame();
      },
    });
    decoder.configure(config);
    this.decoder = decoder;
  }

  private decode(packet: { key: boolean; data: Uint8Array }): void {
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;
    if (decoder.decodeQueueSize > 30 && !packet.key) return; // far behind: wait for a key frame
    decoder.decode(
      new EncodedVideoChunk({
        type: packet.key ? 'key' : 'delta',
        timestamp: this.timestamp++ * 16666,
        data: packet.data,
      }),
    );
  }

  private present(frame: VideoFrame): void {
    this.pending?.close();
    this.pending = frame;
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      const next = this.pending;
      this.pending = undefined;
      if (!next) return;
      const width = next.displayWidth;
      const height = next.displayHeight;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.callbacks.onSize(width, height);
      }
      this.context.drawImage(next, 0, 0, width, height);
      next.close();
    });
  }

  private failFatal(message: string): void {
    this.fatal = true;
    this.closeDecoder();
    this.callbacks.onFatal(message);
  }

  private closeDecoder(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = undefined;
  }

  /** Forgets the stream, for a device switch: the next session starts with a new config. */
  reset(): void {
    this.closeDecoder();
    this.codec = undefined;
    this.pending?.close();
    this.pending = undefined;
    this.fatal = false;
  }
}
