<h1 align="center">Flutter Emulator View</h1>

<p align="center">
  Your Android emulator or phone, live in the VS Code side bar, next to the code you're hot reloading.
</p>

<p align="center">
  <a href="https://github.com/tuzkituan/flutter-emulator-view/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/tuzkituan/flutter-emulator-view?label=release"></a>
  <img alt="VS Code 1.106+" src="https://img.shields.io/badge/VS%20Code-1.106%2B-007ACC">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/tuzkituan/flutter-emulator-view"></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="The Device view in VS Code's right-hand side bar, mirroring a Pixel 7 emulator" width="900">
</p>

---

Flutter Emulator View streams an Android device's screen into VS Code's secondary side bar, over
[scrcpy](https://github.com/Genymobile/scrcpy). You can click and type on it like a real phone, drive hot reload
from the same toolbar, and launch emulators without ever opening a separate emulator window.

## Features

- **Live mirror.** H.264 at up to 60 fps, decoded in the view with WebCodecs. Low latency, frames never queue up.
- **Real input.** Clicks and drags are finger touches, the wheel scrolls, and the keyboard types into the device,
  including IME input and Ctrl shortcuts.
- **Flutter controls.** Run on the mirrored device, hot reload, hot restart, stop and open DevTools. These drive
  the Dart-Code debug session, so your `launch.json` flavors and arguments still apply.
- **Device buttons.** Back, home, recents, notifications, volume, rotate and power.
- **Emulators managed for you.** Launch or cold boot any AVD from the view. It runs headless, with the side bar as
  its screen, and shuts down when the VS Code window closes.
- **Capture.** Save a screenshot, copy one to the clipboard, or record the screen to MP4.
- **Works with phones too.** Anything `adb devices` lists, over USB or Wi-Fi.
- **Stays out of the way.** It opens by itself for Flutter projects and gives the keyboard back to your editor.

## Requirements

| | |
| --- | --- |
| **VS Code** | 1.106 or newer (the first release that allows views in the secondary side bar) |
| **scrcpy** | Any 3.x install: `sudo apt install scrcpy`, `brew install scrcpy`, or the [Windows release](https://github.com/Genymobile/scrcpy/releases). Only its `scrcpy-server` file is used. |
| **Android SDK** | platform-tools, plus the emulator package for AVDs. Android Studio installs both. |
| **Dart & Flutter extensions** | Needed for the Flutter buttons only. |

## Installation

### From a release (recommended)

1. Download the `.vsix` from the [latest release](https://github.com/tuzkituan/flutter-emulator-view/releases/latest).
2. Install it:

   ```bash
   code --install-extension flutter-emulator-view-0.1.0.vsix
   ```

   Or, in VS Code, open **Extensions** (`Ctrl+Shift+X`), then `…` → **Install from VSIX…** and pick the file.
3. Reload VS Code.

### From source

Requires Node.js 20 or newer.

```bash
git clone https://github.com/tuzkituan/flutter-emulator-view.git
cd flutter-emulator-view
npm install
npm run package
code --install-extension flutter-emulator-view-*.vsix
```

To uninstall, run `code --uninstall-extension tuzkituan.flutter-emulator-view`, or remove it from the Extensions view.

## Usage

Open a Flutter project and **Device** appears in the right-hand side bar. With a device connected it starts
mirroring straight away. With nothing connected it lists your AVDs, with **Launch** and **Cold boot** buttons.

You can also open the view yourself:
- `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS)
- the side-bar toggle at the top right of the window
- **Device: Focus on Device View** in the Command Palette

The view can be dragged to the left side bar or the panel like any other view. If it ends up somewhere unexpected,
**View: Reset View Locations** puts it back.

### On the screen

| Input | Does |
| --- | --- |
| Click, drag | Tap, swipe (as a finger, so Flutter scrollables respond) |
| Mouse wheel | Scroll |
| Right-click | Back |
| Middle-click | Home |
| Typing | Text into the focused field. Enter, Backspace, arrows, Tab and Ctrl shortcuts are sent as keys. |

### Toolbar

| Row | Buttons |
| --- | --- |
| Top | Run app on this device · Hot reload · Hot restart · Stop · DevTools, then Screenshot · Copy screenshot · Record · Emulators |
| Bottom | Back · Home · Recents, then Notifications · Volume down · Volume up · Rotate · Power |

The Flutter buttons turn on while a Dart/Flutter debug session is running. Before that, **Run** starts one on the
mirrored device.

### Emulators

An emulator launched from the view belongs to that VS Code window. It has no window of its own, and it shuts down
cleanly when the VS Code window closes, saving its quick-boot snapshot so the next launch takes seconds. Emulators
started anywhere else (Android Studio, a terminal, `flutter emulators --launch`) are mirrored but never stopped.

Two consequences:
- **Developer: Reload Window** also stops an emulator launched from that window.
- With several VS Code windows open, an emulator belongs to the window that launched it.

### Commands

All commands are under **Flutter Emulator View** in the Command Palette:
- Select Device
- Start or Stop an Emulator
- Reconnect Mirror
- Save Screenshot
- Copy Screenshot to Clipboard
- Start or Stop Screen Recording
- Run Flutter App on Mirrored Device

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `flutterEmulatorView.openOnFlutterProject` | `true` | Open the Device view when a Flutter project opens. |
| `flutterEmulatorView.sdkPath` | *auto* | Android SDK folder. Falls back to `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the Android Studio default location. |
| `flutterEmulatorView.adbPath` | *auto* | adb executable. Defaults to the SDK's own copy, so it matches the adb Flutter uses. |
| `flutterEmulatorView.scrcpyServerPath` | *auto* | The `scrcpy-server` file, when scrcpy is installed somewhere unusual. |
| `flutterEmulatorView.scrcpyVersion` | *auto* | Exact version of that file. Read from `scrcpy --version` when empty. |
| `flutterEmulatorView.maxSize` | `1280` | Longest side of the video in pixels; `0` for full resolution. |
| `flutterEmulatorView.maxFps` | `60` | Frame-rate cap. |
| `flutterEmulatorView.bitRate` | `8000000` | Video bit rate, in bits per second. |
| `flutterEmulatorView.captureFolder` | `.screenshots` | Where screenshots and recordings go, relative to the workspace. |

## Troubleshooting

- **"scrcpy-server was not found".** Install scrcpy, or point `flutterEmulatorView.scrcpyServerPath` at the file.
- **Stuck on "Connecting…".** Run **Reconnect Mirror**. The *Flutter Emulator View* output channel logs every adb
  and scrcpy step.
- **A phone shows as "unauthorized".** Unlock it and accept the USB debugging prompt.
- **No emulators listed.** Create one in Android Studio → Device Manager, or set `flutterEmulatorView.sdkPath`.
- **adb keeps restarting.** Two different adb versions are fighting each other. Leave `adbPath` empty, so the
  SDK's copy is used, the same one Flutter uses.

## How it works

```
webview (canvas + toolbar)  ◄── postMessage ──►  extension host  ◄── adb forward ──►  scrcpy-server
  WebCodecs VideoDecoder                           ScrcpySession                        on the device
  pointer / key → messages                         control serializers
```

- **Video.** `src/scrcpy/stream.ts` parses the scrcpy video socket (device name, codec header, then 12-byte frame
  headers) and merges SPS/PPS config packets into the next key frame.
- **Input.** `src/scrcpy/control.ts` serializes touch, scroll, key, text, rotate and reset-video messages in the
  scrcpy 3.x wire format.
- **Falling behind.** If the view can't keep up, or was hidden, the host asks the encoder for a fresh key frame. It
  never feeds the decoder a broken chain of frames.
- **Emulators.** `src/emulator.ts` launches AVDs headless and records the ones it owns, so they can be shut down
  with the window, or re-adopted after a crash.

## Development

```bash
npm install
npm run build        # dist/extension.js + dist/webview.js
npm run watch        # rebuild on change
npm run typecheck
npm test             # protocol parsers and serializers (vitest)
npm run package      # produces the .vsix
```

Press **F5** to open an Extension Development Host with the extension loaded.

## License

[MIT](LICENSE) © Tuan Nguyen
