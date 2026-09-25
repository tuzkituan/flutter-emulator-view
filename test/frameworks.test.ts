import { describe, expect, it } from 'vitest';
import { isMetroStatus, metroBroadcast, metroUrls } from '../src/frameworks/metro';
import { parseFramework } from '../src/projectDetect';

const flutterPubspec = `name: app
dependencies:
  flutter:
    sdk: flutter
`;
const dartPubspec = `name: tool
dependencies:
  args: ^2.4.0
`;
const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'app', dependencies: deps, devDependencies: dev });

describe('parseFramework', () => {
  it('detects a Flutter app but not a plain Dart package', () => {
    expect(parseFramework({ pubspec: flutterPubspec })).toEqual({ id: 'flutter', expo: false });
    expect(parseFramework({ pubspec: dartPubspec })).toBeUndefined();
  });

  it('detects React Native CLI and Expo projects', () => {
    expect(parseFramework({ packageJson: pkg({ react: '19.0.0', 'react-native': '0.79.0' }) })).toEqual({ id: 'reactNative', expo: false });
    expect(parseFramework({ packageJson: pkg({ expo: '~53.0.0', 'react-native': '0.79.0' }) })).toEqual({ id: 'reactNative', expo: true });
    expect(parseFramework({ packageJson: pkg({}, { 'react-native': '0.79.0' }) })?.id).toBe('reactNative');
  });

  it('prefers Flutter when a folder has both', () => {
    expect(parseFramework({ pubspec: flutterPubspec, packageJson: pkg({ 'react-native': '0.79.0' }) })?.id).toBe('flutter');
  });

  it('ignores other JS projects and broken manifests', () => {
    expect(parseFramework({ packageJson: pkg({ react: '19.0.0', next: '15.0.0' }) })).toBeUndefined();
    expect(parseFramework({ packageJson: '{ not json' })).toBeUndefined();
    expect(parseFramework({})).toBeUndefined();
  });
});

describe('metro', () => {
  it('recognises the status body', () => {
    expect(isMetroStatus('packager-status:running')).toBe(true);
    expect(isMetroStatus('packager-status:running\n')).toBe(true);
    expect(isMetroStatus('<html>')).toBe(false);
  });

  it('builds the broadcasts the CLI sends for r and d', () => {
    expect(metroBroadcast('reload')).toBe('{"version":2,"method":"reload"}');
    expect(metroBroadcast('devMenu')).toBe('{"version":2,"method":"devMenu"}');
  });

  it('builds endpoint URLs for a custom port', () => {
    expect(metroUrls(19000)).toEqual({
      status: 'http://localhost:19000/status',
      openDebugger: 'http://localhost:19000/open-debugger',
      messageSocket: 'ws://localhost:19000/message',
    });
  });
});
