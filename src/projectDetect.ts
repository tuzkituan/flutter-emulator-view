// Pure project detection, kept free of vscode and fs so it can be unit tested.

export type FrameworkId = 'flutter' | 'reactNative';

export interface DetectedFramework {
  id: FrameworkId;
  /** React Native only: the project runs through the Expo CLI. */
  expo: boolean;
}

/** A pubspec that depends on the Flutter SDK; a plain Dart package does not count. */
export function isFlutterPubspec(pubspec: string): boolean {
  return /^\s+sdk:\s*flutter\s*$/m.test(pubspec);
}

/** Returns undefined for anything that is not a React Native app manifest (or not JSON). */
export function parseReactNativePackage(packageJson: string): { expo: boolean } | undefined {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return undefined; // a broken package.json is not a project we can drive
  }
  const deps = { ...manifest.devDependencies, ...manifest.dependencies };
  if (!('react-native' in deps)) return undefined;
  return { expo: 'expo' in deps };
}

/** Flutter wins when a folder is both (a Flutter app with a JS tooling package.json, say). */
export function parseFramework(files: { pubspec?: string; packageJson?: string }): DetectedFramework | undefined {
  if (files.pubspec !== undefined && isFlutterPubspec(files.pubspec)) return { id: 'flutter', expo: false };
  const rn = files.packageJson !== undefined ? parseReactNativePackage(files.packageJson) : undefined;
  return rn ? { id: 'reactNative', expo: rn.expo } : undefined;
}
