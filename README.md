# Flutter Emulator View

Shows an Android emulator or a USB/Wi-Fi phone inside a VS Code side bar, with:

- **Live screen**: H.264 over [scrcpy](https://github.com/Genymobile/scrcpy), decoded with WebCodecs, at up to 60 fps.
- **Touch and keyboard**: click or drag = finger, wheel = scroll, right-click = back, middle-click = home. Typing goes
  to the device, including IME text and Ctrl shortcuts.
- **Flutter controls**: run on the mirrored device, hot reload, hot restart, stop, DevTools. These drive the Dart-Code
  debug session, so they work the same as F5.
- **Device buttons**: back, home, recents, notifications, volume, rotate, power.
- **Emulators**: when nothing is connected, the view lists your AVDs with *Launch* and *Cold boot* buttons. The
  toolbar's emulator button can start, mirror or stop any of them at any time.
- **Capture**: save a screenshot, copy it to the clipboard, and record the screen to MP4.

## Requirements

- **scrcpy** installed (`sudo apt install scrcpy`, `brew install scrcpy`, or the Windows zip). Only its
  `scrcpy-server` file is used. The version is read from `scrcpy --version`.
- **Android SDK** with platform-tools and, for emulators, the emulator package. It is found from the
  `flutterEmulatorView.sdkPath` setting, then `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the Android Studio default location.
- **Dart and Flutter extensions** (Dart-Code), for the Flutter buttons.

## Development

```bash
npm install
npm run build        # dist/extension.js + dist/webview.js
npm run typecheck
npm test             # protocol parsers and serializers
npm run package      # flutter-emulator-view-<version>.vsix
```

To try it, press **F5** in this folder to open an Extension Development Host, then open the **Device** icon in the
activity bar. Install the packaged build with `code --install-extension flutter-emulator-view-0.1.0.vsix`.

## How it works

```
webview (canvas + toolbar)  ◄── postMessage ──►  extension host  ◄── adb forward ──►  scrcpy-server
  WebCodecs VideoDecoder                            ScrcpySession                        on the device
  pointer / key → messages                          control serializers
```

- `src/scrcpy/stream.ts` parses the video socket: device name, codec header, then 12-byte frame headers. SPS/PPS
  config packets are merged into the next key frame.
- `src/scrcpy/control.ts` serializes touch, scroll, key, text, rotate and reset-video messages (scrcpy 3.x layout).
- Touches are sent as a *finger*, not a mouse, because Flutter scrollables ignore mouse drags by default.
- If the webview falls behind, or was hidden, the host asks the encoder for a fresh key frame (`RESET_VIDEO`). It does
  not feed the decoder a broken chain of frames.
- adb comes from the SDK's platform-tools, so it is the same version Flutter uses and the two don't keep restarting
  each other's adb server.
