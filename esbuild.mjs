import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// A stale dev build would otherwise leave its source maps in the packaged .vsix.
if (production) await rm('dist', { recursive: true, force: true });

const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  }),
  esbuild.context({
    ...shared,
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
  }),
]);

await mkdir('dist', { recursive: true });
await Promise.all([
  copyFile('node_modules/@vscode/codicons/dist/codicon.css', 'dist/codicon.css'),
  copyFile('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/codicon.ttf'),
  copyFile('webview/webview.css', 'dist/webview.css'),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
