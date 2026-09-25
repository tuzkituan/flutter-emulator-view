// The postMessage protocol between the extension host and the webview. Type-only, so both
// bundles can import it.

export interface DeviceSummary {
  serial: string;
  label: string;
  state: string;
  emulator: boolean;
}

export type ViewStatus =
  | { kind: 'noDevice'; avds: string[]; emulatorAvailable: boolean }
  | { kind: 'connecting'; serial: string; label: string }
  | { kind: 'booting'; avd: string }
  | { kind: 'streaming'; serial: string; label: string }
  | { kind: 'unavailable'; serial: string; label: string; state: string }
  | { kind: 'error'; message: string; serial?: string; setupHint?: boolean };

export type HostMessage =
  | { type: 'status'; status: ViewStatus }
  | { type: 'devices'; devices: DeviceSummary[]; selected: string | undefined }
  | { type: 'flutter'; running: boolean }
  | { type: 'recording'; active: boolean }
  | { type: 'packet'; key: boolean; hasConfig: boolean; data: Uint8Array }
  | { type: 'clipboardImage'; png: Uint8Array };

export type NavKey = 'back' | 'home' | 'recents' | 'power' | 'volumeDown' | 'volumeUp' | 'rotate' | 'notifications';

export type ToolbarAction =
  | 'hotReload'
  | 'hotRestart'
  | 'stop'
  | 'devTools'
  | 'run'
  | 'screenshot'
  | 'copyScreenshot'
  | 'record'
  | 'manageEmulators'
  | 'reconnect'
  | 'openSettings';

export interface FramePoint {
  x: number;
  y: number;
  /** The decoded frame size the point was measured against. */
  width: number;
  height: number;
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectDevice'; serial: string }
  | { type: 'launchAvd'; avd: string; coldBoot: boolean }
  | { type: 'touch'; action: 'down' | 'move' | 'up'; point: FramePoint }
  | { type: 'scroll'; point: FramePoint; dx: number; dy: number }
  | { type: 'key'; keycode: number; metaState: number }
  | { type: 'text'; text: string }
  | { type: 'nav'; key: NavKey }
  | { type: 'action'; action: ToolbarAction }
  | { type: 'decoderError'; message: string }
  /** The decoder lost sync (a decode error): ask the encoder for a fresh key frame. */
  | { type: 'requestKeyFrame' }
  | { type: 'notice'; message: string; error: boolean };
