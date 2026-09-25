import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('loupe');
}

/** Setting → ANDROID_HOME → ANDROID_SDK_ROOT → the Android Studio default for this OS. */
export function resolveSdkPath(): string | undefined {
  const candidates = [
    config().get<string>('sdkPath'),
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    defaultSdkPath(),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(expandHome(candidate))) return expandHome(candidate);
  }
  return undefined;
}

function defaultSdkPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Android', 'sdk');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk');
    default:
      return path.join(os.homedir(), 'Android', 'Sdk');
  }
}

/** The SDK's own adb first, so it is the same version Flutter starts. */
export function resolveAdbPath(): string {
  const configured = config().get<string>('adbPath');
  if (configured) return expandHome(configured);
  const sdk = resolveSdkPath();
  if (sdk) {
    const candidate = path.join(sdk, 'platform-tools', exe('adb'));
    if (fs.existsSync(candidate)) return candidate;
  }
  return exe('adb');
}

export function resolveEmulatorPath(): string | undefined {
  const sdk = resolveSdkPath();
  if (!sdk) return undefined;
  const candidate = path.join(sdk, 'emulator', exe('emulator'));
  return fs.existsSync(candidate) ? candidate : undefined;
}

/** Where distro, Homebrew and manual installs put the server file. */
export function resolveScrcpyServerPath(): string | undefined {
  const configured = config().get<string>('scrcpyServerPath');
  if (configured) return fs.existsSync(expandHome(configured)) ? expandHome(configured) : undefined;
  if (process.env.SCRCPY_SERVER_PATH && fs.existsSync(process.env.SCRCPY_SERVER_PATH)) {
    return process.env.SCRCPY_SERVER_PATH;
  }
  const candidates = [
    '/usr/share/scrcpy/scrcpy-server',
    '/usr/local/share/scrcpy/scrcpy-server',
    '/opt/homebrew/share/scrcpy/scrcpy-server',
    '/snap/scrcpy/current/usr/share/scrcpy/scrcpy-server',
  ];
  // A Windows zip, or any install that keeps the server next to the binary.
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'scrcpy-server'));
  }
  return candidates.find((c) => fs.existsSync(c));
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}
