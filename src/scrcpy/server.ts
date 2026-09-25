import { ChildProcess, execFile } from 'node:child_process';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { adbExec, adbSpawn } from '../adb';
import { parseForwardPort, parseScrcpyVersion } from '../adbProtocol';
import { config, resolveScrcpyServerPath } from '../sdk';
import { CODEC_ID_H264, ConfigMerger, DecodablePacket, VideoStreamParser } from './stream';

const DEVICE_SERVER_PATH = '/data/local/tmp/loupe-server.jar';

export interface SessionListener {
  onDeviceName(name: string): void;
  onCodec(width: number, height: number): void;
  onPacket(packet: DecodablePacket): void;
  onClosed(error: Error | undefined): void;
}

/**
 * One running scrcpy-server on one device, with its video and control sockets over an adb
 * forward. Call [close] to stop the server and drop the forward.
 */
export class ScrcpySession {
  private server: ChildProcess | undefined;
  private video: net.Socket | undefined;
  private control: net.Socket | undefined;
  private port: number | undefined;
  private closed = false;

  private constructor(
    readonly serial: string,
    private readonly listener: SessionListener,
    private readonly log: vscode.OutputChannel,
  ) {}

  static async start(serial: string, listener: SessionListener, log: vscode.OutputChannel): Promise<ScrcpySession> {
    const session = new ScrcpySession(serial, listener, log);
    try {
      await session.connect();
    } catch (error) {
      session.close();
      throw error;
    }
    return session;
  }

  private async connect(): Promise<void> {
    const serverFile = resolveScrcpyServerPath();
    if (!serverFile) {
      throw new MissingScrcpyError(
        'scrcpy-server was not found. Install scrcpy (for example `sudo apt install scrcpy` or `brew install scrcpy`), or set loupe.scrcpyServerPath.',
      );
    }
    const version = await resolveScrcpyVersion();
    const scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');

    await adbExec(['-s', this.serial, 'push', serverFile, DEVICE_SERVER_PATH], { timeoutMs: 30000 });
    const { stdout } = await adbExec(['-s', this.serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`]);
    this.port = parseForwardPort(stdout);

    const cfg = config();
    const args = [
      '-s', this.serial, 'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', version,
      `scid=${scid}`,
      'log_level=info',
      'tunnel_forward=true',
      'audio=false',
      'control=true',
      'video_codec=h264',
      // Baseline profile keeps every H.264 decoder path happy.
      'video_codec_options=profile:int=1',
      `max_size=${cfg.get<number>('maxSize', 1280)}`,
      `max_fps=${cfg.get<number>('maxFps', 60)}`,
      `video_bit_rate=${cfg.get<number>('bitRate', 8000000)}`,
      'clipboard_autosync=false',
      'power_off_on_close=false',
    ];
    this.log.appendLine(`[scrcpy ${this.serial}] starting server ${version} on port ${this.port}`);
    const server = adbSpawn(args);
    this.server = server;
    server.stdout?.on('data', (chunk: Buffer) => this.log.append(`[scrcpy ${this.serial}] ${chunk}`));
    server.stderr?.on('data', (chunk: Buffer) => this.log.append(`[scrcpy ${this.serial}] ${chunk}`));
    server.on('exit', (code) => this.fail(new Error(`scrcpy-server exited (code ${code})`)));

    // With a forward tunnel adb accepts the connection even before the server listens, then
    // closes it. The server's dummy byte on the first socket is the proof it is really there.
    this.video = await connectWithDummyByte(this.port, () => this.closed || server.exitCode !== null);
    this.control = await connectSocket(this.port);

    const parser = new VideoStreamParser();
    const merger = new ConfigMerger();
    this.video.on('data', (chunk: Buffer) => {
      let events;
      try {
        events = parser.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      for (const event of events) {
        switch (event.kind) {
          case 'deviceName':
            this.listener.onDeviceName(event.name);
            break;
          case 'codec':
            if (event.codecId !== CODEC_ID_H264) {
              this.fail(new Error(`Unexpected codec 0x${event.codecId.toString(16)}`));
              return;
            }
            this.listener.onCodec(event.width, event.height);
            break;
          case 'packet': {
            const packet = merger.accept(event);
            if (packet) this.listener.onPacket(packet);
            break;
          }
        }
      }
    });
    this.video.resume();
    // Device → client messages (clipboard, uhid output, acks) are not used; reading keeps
    // the socket from backing up.
    this.control.on('data', () => undefined);
    for (const socket of [this.video, this.control]) {
      socket.on('close', () => this.fail(new Error('Connection to the device closed')));
      socket.on('error', (error) => this.fail(error));
    }
  }

  send(message: Uint8Array): void {
    if (this.closed || !this.control || this.control.destroyed) return;
    this.control.write(message);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.log.appendLine(`[scrcpy ${this.serial}] ${error.message}`);
    this.close();
    this.listener.onClosed(error);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.video?.destroy();
    this.control?.destroy();
    this.server?.kill();
    if (this.port !== undefined) {
      adbExec(['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => {
        // The device may already be gone, which removes the forward with it.
      });
    }
  }
}

export class MissingScrcpyError extends Error {}

let cachedVersion: string | undefined;

async function resolveScrcpyVersion(): Promise<string> {
  const configured = config().get<string>('scrcpyVersion');
  if (configured) return configured;
  if (cachedVersion) return cachedVersion;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('scrcpy', ['--version'], { timeout: 10000 }, (error, out) => {
      if (error) reject(error);
      else resolve(out);
    });
  }).catch(() => '');
  const version = parseScrcpyVersion(stdout);
  if (!version) {
    throw new MissingScrcpyError(
      'Could not read the scrcpy version from `scrcpy --version`. Set loupe.scrcpyVersion to the exact version of your scrcpy-server file.',
    );
  }
  cachedVersion = version;
  return version;
}

function connectSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.setNoDelay(true);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function connectWithDummyByte(port: number, aborted: () => boolean): Promise<net.Socket> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (aborted()) throw new Error('scrcpy-server stopped before it accepted a connection');
    try {
      const socket = await connectSocket(port);
      const ok = await readDummyByte(socket);
      if (ok) return socket;
      socket.destroy();
    } catch {
      // Nothing listening yet; retry below.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out connecting to scrcpy-server');
}

/** Resolves true once the one-byte handshake arrives; any extra bytes are put back. */
function readDummyByte(socket: net.Socket): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      socket.removeListener('error', onClose);
    };
    const onData = (chunk: Buffer) => {
      cleanup();
      socket.pause();
      if (chunk.length > 1) socket.unshift(chunk.subarray(1));
      // Left paused: the caller resumes once its own 'data' listener is attached.
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', onClose);
  });
}
