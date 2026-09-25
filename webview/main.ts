import type { DeviceSummary, FramePoint, HostMessage, NavKey, ToolbarAction, ViewStatus, WebviewMessage } from '../src/messages';
import { H264Decoder } from './decoder';
import { keyIntent } from './keys';

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const send = (message: WebviewMessage) => vscode.postMessage(message);

// ---- DOM ---------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// Codicons has no power or volume glyphs; these are drawn to match its 16px stroke weight.
const SVG: Record<string, string> = {
  power: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8 1.8v5.4"/><path d="M4.6 3.8a5.2 5.2 0 1 0 6.8 0"/></svg>',
  volumeDown: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M10 7.4h4.5v1.2H10z"/></svg>',
  volumeUp: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path d="M11.65 5.25h1.2v2.15H15v1.2h-2.15v2.15h-1.2V8.6H9.5V7.4h2.15z"/></svg>',
};

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', { className: 'icon', title, type: 'button' });
  button.setAttribute('aria-label', title);
  if (SVG[icon]) button.innerHTML = SVG[icon];
  else button.append(el('span', { className: `codicon codicon-${icon}` }));
  button.addEventListener('click', onClick);
  return button;
}

const action = (a: ToolbarAction) => () => send({ type: 'action', action: a });
const nav = (key: NavKey) => () => send({ type: 'nav', key });

const deviceSelect = el('select', { title: 'Device to mirror' });
deviceSelect.addEventListener('change', () => send({ type: 'selectDevice', serial: deviceSelect.value }));

const runButton = iconButton('debug-start', 'Run Flutter app on this device', action('run'));
const flutterButtons = [
  iconButton('flame', 'Hot reload', action('hotReload')),
  iconButton('debug-restart', 'Hot restart', action('hotRestart')),
  iconButton('debug-stop', 'Stop', action('stop')),
  iconButton('dashboard', 'Open DevTools', action('devTools')),
];
const recordButton = iconButton('record', 'Start screen recording', action('record'));

const toolbar = el(
  'div',
  { className: 'toolbar' },
  el('div', { className: 'group' }, runButton, ...flutterButtons),
  el('div', { className: 'spacer' }),
  el(
    'div',
    { className: 'group' },
    iconButton('device-camera', 'Save screenshot', action('screenshot')),
    iconButton('copy', 'Copy screenshot to clipboard', action('copyScreenshot')),
    recordButton,
    iconButton('vm', 'Launch or stop an emulator', action('manageEmulators')),
  ),
);

const canvas = el('canvas', { tabIndex: 0, className: 'screen' });
canvas.setAttribute('aria-label', 'Device screen. Click to focus, then type to send keys.');
const overlay = el('div', { className: 'overlay' });
const stage = el('div', { className: 'stage' }, canvas, overlay);

const navBar = el(
  'div',
  { className: 'navbar' },
  iconButton('arrow-left', 'Back (right-click on the screen)', nav('back')),
  iconButton('circle-large', 'Home (middle-click on the screen)', nav('home')),
  iconButton('layers', 'Recent apps', nav('recents')),
  el('div', { className: 'spacer' }),
  iconButton('bell', 'Notifications', nav('notifications')),
  iconButton('volumeDown', 'Volume down', nav('volumeDown')),
  iconButton('volumeUp', 'Volume up', nav('volumeUp')),
  iconButton('sync', 'Rotate', nav('rotate')),
  iconButton('power', 'Power', nav('power')),
);

document.getElementById('app')!.append(el('div', { className: 'header' }, deviceSelect), toolbar, stage, navBar);

// ---- decoding and layout -----------------------------------------------------------------

let streaming = false;
const decoder = new H264Decoder(canvas, {
  onSize: () => layout(),
  onFatal: (message) => send({ type: 'decoderError', message }),
  onNeedKeyFrame: () => send({ type: 'requestKeyFrame' }),
});

/** Fits the canvas inside the stage at the video's aspect ratio. */
function layout(): void {
  const { width, height } = canvas;
  const box = stage.getBoundingClientRect();
  if (!width || !height || !box.width || !box.height) return;
  const scale = Math.min(box.width / width, box.height / height);
  canvas.style.width = `${Math.floor(width * scale)}px`;
  canvas.style.height = `${Math.floor(height * scale)}px`;
}
new ResizeObserver(layout).observe(stage);

// ---- input -------------------------------------------------------------------------------

function framePoint(event: MouseEvent): FramePoint {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return {
    x: Math.min(canvas.width - 1, Math.max(0, x)),
    y: Math.min(canvas.height - 1, Math.max(0, y)),
    width: canvas.width,
    height: canvas.height,
  };
}

let activePointer: number | undefined;

canvas.addEventListener('pointerdown', (event) => {
  canvas.focus();
  if (!streaming) return;
  event.preventDefault();
  if (event.button === 2) return send({ type: 'nav', key: 'back' });
  if (event.button === 1) return send({ type: 'nav', key: 'home' });
  if (event.button !== 0 || activePointer !== undefined) return;
  activePointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  send({ type: 'touch', action: 'down', point: framePoint(event) });
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointer) return;
  // Coalesced events keep a fast swipe's full path instead of the last point per frame.
  const events = event.getCoalescedEvents?.() ?? [event];
  for (const e of events.length > 0 ? events : [event]) send({ type: 'touch', action: 'move', point: framePoint(e) });
});

const endPointer = (event: PointerEvent) => {
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  send({ type: 'touch', action: 'up', point: framePoint(event) });
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener(
  'wheel',
  (event) => {
    if (!streaming) return;
    event.preventDefault();
    // One notch is ~100 px in pixel mode, or 1 in line mode.
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 100 : 1;
    // Android: AXIS_VSCROLL > 0 scrolls up, the opposite of the browser's deltaY.
    send({ type: 'scroll', point: framePoint(event), dx: event.deltaX / unit, dy: -event.deltaY / unit });
  },
  { passive: false },
);

canvas.addEventListener('keydown', (event) => {
  if (!streaming || event.isComposing) return;
  const intent = keyIntent(event);
  if (!intent) return;
  event.preventDefault();
  event.stopPropagation();
  if (intent.kind === 'text') send({ type: 'text', text: intent.text });
  else send({ type: 'key', keycode: intent.keycode, metaState: intent.metaState });
});

// IME composition (Vietnamese, CJK) arrives as finished text rather than keys.
canvas.addEventListener('compositionend', (event) => {
  if (streaming && event.data) send({ type: 'text', text: event.data });
});

// ---- host messages -----------------------------------------------------------------------

function renderDevices(devices: DeviceSummary[], selected: string | undefined): void {
  deviceSelect.replaceChildren(
    ...(devices.length === 0
      ? [el('option', { value: '', textContent: 'No device connected' })]
      : devices.map((d) =>
          el('option', {
            value: d.serial,
            textContent: d.state === 'device' ? d.label : `${d.label} — ${d.state}`,
            selected: d.serial === selected,
          }),
        )),
  );
  deviceSelect.disabled = devices.length === 0;
}

function button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, className: secondary ? 'secondary' : '' });
  b.addEventListener('click', onClick);
  return b;
}

function renderStatus(status: ViewStatus): void {
  const wasStreaming = streaming;
  streaming = status.kind === 'streaming';
  canvas.classList.toggle('hidden', !streaming && status.kind !== 'connecting');
  overlay.replaceChildren();
  overlay.classList.toggle('hidden', streaming);
  if (!streaming && wasStreaming) decoder.reset();
  switch (status.kind) {
    case 'streaming':
      return;
    case 'connecting':
      overlay.append(el('div', { className: 'message' }, el('span', { className: 'codicon codicon-loading codicon-modifier-spin' }), ` Connecting to ${status.label}…`));
      return;
    case 'booting':
      overlay.append(el('div', { className: 'message' }, el('span', { className: 'codicon codicon-loading codicon-modifier-spin' }), ` Booting ${status.avd.replace(/_/g, ' ')}…`));
      return;
    case 'unavailable':
      overlay.append(el('div', { className: 'message' }, `${status.label} is ${status.state}.`));
      if (status.state === 'unauthorized') overlay.append(el('p', { className: 'hint', textContent: 'Unlock the phone and allow USB debugging.' }));
      return;
    case 'error': {
      overlay.append(el('div', { className: 'message error', textContent: status.message }));
      const actions = el('div', { className: 'actions' }, button('Retry', action('reconnect')));
      if (status.setupHint) actions.append(button('Settings', action('openSettings'), true));
      overlay.append(actions);
      return;
    }
    case 'noDevice': {
      overlay.append(el('div', { className: 'message', textContent: 'No Android device is connected.' }));
      if (!status.emulatorAvailable) {
        overlay.append(
          el('p', { className: 'hint', textContent: 'Plug in a phone with USB debugging on, or set the Android SDK path to launch an emulator.' }),
          el('div', { className: 'actions' }, button('Settings', action('openSettings'), true)),
        );
        return;
      }
      if (status.avds.length === 0) {
        overlay.append(el('p', { className: 'hint', textContent: 'No emulators exist yet. Create one in Android Studio → Device Manager.' }));
        return;
      }
      overlay.append(
        el(
          'ul',
          { className: 'avds' },
          ...status.avds.map((avd) =>
            el(
              'li',
              {},
              el('span', { className: 'codicon codicon-vm' }),
              el('span', { className: 'name', textContent: avd.replace(/_/g, ' ') }),
              button('Launch', () => send({ type: 'launchAvd', avd, coldBoot: false })),
              button('Cold boot', () => send({ type: 'launchAvd', avd, coldBoot: true }), true),
            ),
          ),
        ),
      );
      return;
    }
  }
}

function setFlutterRunning(running: boolean): void {
  runButton.classList.toggle('hidden', running);
  for (const b of flutterButtons) b.disabled = !running;
}

function setRecording(active: boolean): void {
  recordButton.classList.toggle('recording', active);
  recordButton.title = active ? 'Stop screen recording' : 'Start screen recording';
}

async function copyImage(png: Uint8Array): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    send({ type: 'notice', message: 'Screenshot copied to the clipboard.', error: false });
  } catch (error) {
    send({ type: 'notice', message: `Could not copy the screenshot: ${error instanceof Error ? error.message : error}`, error: true });
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'packet':
      decoder.push(message);
      break;
    case 'status':
      renderStatus(message.status);
      break;
    case 'devices':
      renderDevices(message.devices, message.selected);
      break;
    case 'flutter':
      setFlutterRunning(message.running);
      break;
    case 'recording':
      setRecording(message.active);
      break;
    case 'clipboardImage':
      void copyImage(message.png);
      break;
  }
});

setFlutterRunning(false);
renderStatus({ kind: 'noDevice', avds: [], emulatorAvailable: true });
send({ type: 'ready' });
