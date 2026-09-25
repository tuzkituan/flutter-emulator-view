// Metro dev server protocol bits (React Native CLI and Expo share them).

/** `GET /status` answers with this body while Metro is serving. */
export function isMetroStatus(body: string): boolean {
  return body.trim() === 'packager-status:running';
}

export type MetroBroadcast = 'reload' | 'devMenu';

/**
 * A message-socket broadcast, as the CLI's `r` and `d` keys send it. With no `id` the server
 * forwards it to every connected app instead of expecting a reply.
 */
export function metroBroadcast(method: MetroBroadcast): string {
  return JSON.stringify({ version: 2, method });
}

export function metroUrls(port: number) {
  return {
    status: `http://localhost:${port}/status`,
    openDebugger: `http://localhost:${port}/open-debugger`,
    messageSocket: `ws://localhost:${port}/message`,
  };
}
