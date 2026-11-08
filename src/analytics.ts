/**
 * Optional anonymous race stats: small JSON events posted to /api/event
 * (functions/api/event.ts), which stores them in a Cloudflare D1 database. No cookies, no
 * stored identifiers: the session id is random per page load and lives only in memory.
 * `npm run stats` reads them.
 *
 * Off unless the build sets VITE_RACE_STATS=1, so a plain checkout or fork never sends
 * anything. Also off in dev, on localhost, and with any testing parameter in the URL
 * (?debug, ?seed, ?speed, ?corners, ?inspect), so testing doesn't skew the numbers.
 */

const ENDPOINT = '/api/event';
const FLUSH_MS = 15_000;
const MAX_QUEUE = 50;
const MAX_ERRORS = 5;
const TESTING_PARAMS = ['debug', 'seed', 'speed', 'corners', 'inspect'];

export type Props = Record<string, unknown>;

interface QueuedEvent {
  name: string;
  /** Milliseconds since the page loaded. */
  t: number;
  props: Props;
}

function enabled(): boolean {
  if (import.meta.env.VITE_RACE_STATS !== '1' || import.meta.env.DEV) return false;
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return false;
  const params = new URLSearchParams(location.search);
  return !TESTING_PARAMS.some((p) => params.has(p));
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

class Analytics {
  readonly on = enabled();
  private readonly session = randomId();
  private queue: QueuedEvent[] = [];
  private timer = 0;
  private errors = 0;

  constructor() {
    if (!this.on) return;
    addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush(true);
    });
    addEventListener('error', (e) => this.error(e.message, `${e.filename?.split('/').pop() ?? ''}:${e.lineno}`));
    addEventListener('unhandledrejection', (e) => this.error(String((e.reason as Error)?.message ?? e.reason), 'promise'));
  }

  track(name: string, props: Props = {}): void {
    if (!this.on) return;
    this.queue.push({ name, t: Math.round(performance.now()), props });
    if (this.queue.length >= MAX_QUEUE) this.flush();
    else if (!this.timer) this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Send now; `leaving` uses sendBeacon, which survives the page closing. */
  flush(leaving = false): void {
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.queue.length) return;
    const body = JSON.stringify({ session: this.session, events: this.queue.splice(0) });
    try {
      if (leaving && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
      void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => undefined);
    } catch {
      /* stats are best effort */
    }
  }

  private error(message: string, where: string): void {
    if (this.errors++ >= MAX_ERRORS) return;
    this.track('error', { message: message.slice(0, 200), where: where.slice(0, 80) });
  }
}

export const analytics = new Analytics();
