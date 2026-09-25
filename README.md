# Flutter Emulator View

Shows an Android emulator or a USB/Wi-Fi phone in VS Code's right-hand (secondary) side bar, with:

- **Live screen**: H.264 over [scrcpy](https://github.com/Genymobile/scrcpy), decoded with WebCodecs, at up to 60 fps.
- **Touch and keyboard**: click or drag = finger, wheel = scroll, right-click = back, middle-click = home. Typing goes
  to the device, including IME text and Ctrl shortcuts.
- **Flutter controls**: run on the mirrored device, hot reload, hot restart, stop, DevTools. These drive the Dart-Code
  debug session, so they work the same as F5.
- **Device buttons**: back, home, recents, notifications, volume, rotate, power.
- **Emulators**: when nothing is connected, the view lists your AVDs with *Launch* and *Cold boot* buttons. The
  toolbar's emulator button can start, mirror or stop any of them at any time. An emulator launched here runs with
  no window of its own (the side bar is its screen) and shuts down when the VS Code window closes. Emulators you
  started elsewhere, such as Android Studio or `flutter emulators --launch`, are mirrored but never stopped.

  Two side effects: *Developer: Reload Window* also stops an emulator launched here (the next launch resumes from
  the quick-boot snapshot in a few seconds), and with several VS Code windows open, an emulator belongs to the
  window that launched it.
- **Capture**: save a screenshot, copy it to the clipboard, and record the screen to MP4.

## Requirements

- **VS Code 1.106 or newer**, the first release that lets extensions add views to the secondary side bar.
- **scrcpy** installed (`sudo apt install scrcpy`, `brew install scrcpy`, or the Windows zip). Only its
  `scrcpy-server` file is used. The version is read from `scrcpy --version`.
- **Android SDK** with platform-tools and, for emulators, the emulator package. It is found from the
  `flutterEmulatorView.sdkPath` setting, then `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then the Android Studio default location.
- **Dart and Flutter extensions** (Dart-Code), for the Flutter buttons.

## Install

The extension is not on the Marketplace, so you build a `.vsix` package and install that file. You need Node.js 20 or
newer.

```bash
git clone https://github.com/tuzkituan/flutter-emulator-view.git
cd flutter-emulator-view
npm install
npm run package
code --install-extension flutter-emulator-view-0.1.0.vsix
```

If the `code` command is not on your PATH, install the file from inside VS Code instead: open the Extensions view
(`Ctrl+Shift+X`), open the `…` menu at the top, choose **Install from VSIX…**, and pick the file.

Then reload VS Code. **Device** opens in the secondary side bar on the right (toggle it with `Ctrl+Alt+B`, or
`Cmd+Alt+B` on macOS). With an emulator or phone connected it starts mirroring; otherwise it lists your AVDs so you
can launch one. You can drag it to the left side bar or the panel like any view; if an earlier install left it on the
left, run **View: Reset View Locations** to bring it back.

To update, pull, run `npm run package` again and reinstall the new `.vsix`. To remove the extension, run
`code --uninstall-extension tuzkituan.flutter-emulator-view`, or uninstall it from the Extensions view.

If the view reports that it can't find scrcpy or the Android SDK, set `flutterEmulatorView.scrcpyServerPath` or
`flutterEmulatorView.sdkPath` in Settings.

## Development

```bash
npm install
npm run build        # dist/extension.js + dist/webview.js
npm run typecheck
npm test             # protocol parsers and serializers
npm run package      # flutter-emulator-view-<version>.vsix
```

To try changes without installing, press **F5** in this folder. That opens an Extension Development Host with the
extension loaded; **Device** is in the secondary side bar on the right.

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
