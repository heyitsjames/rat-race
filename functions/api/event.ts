/**
 * Cloudflare Pages Function: POST /api/event stores the game's anonymous race stats
 * (src/analytics.ts) in the D1 database bound as DB. Schema: migrations/0001_events.sql.
 * Without the binding it accepts and drops events, so the game never notices.
 */

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
}
interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}
interface Env {
  DB?: D1Database;
}
interface Context {
  request: Request & { cf?: { country?: string } };
  env: Env;
}

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 60;
const MAX_PROPS = 8 * 1024;
const NAME = /^[a-z][a-z_]{0,39}$/;
const SESSION = /^[\w-]{8,64}$/;

const done = (status = 204) => new Response(null, { status });

export const onRequestPost = async ({ request, env }: Context): Promise<Response> => {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return done(403);
  const text = await request.text();
  if (text.length > MAX_BODY) return done(413);
  let body: { session?: unknown; events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return done(400);
  }
  const session = typeof body.session === 'string' && SESSION.test(body.session) ? body.session : null;
  if (!session || !Array.isArray(body.events)) return done(400);
  if (!env.DB) return done();
  const country = request.cf?.country ?? null;
  const insert = env.DB.prepare('INSERT INTO events (session, name, t, props, country, host) VALUES (?, ?, ?, ?, ?, ?)');
  const rows = [];
  for (const e of body.events.slice(0, MAX_EVENTS) as { name?: unknown; t?: unknown; props?: unknown }[]) {
    if (!e || typeof e.name !== 'string' || !NAME.test(e.name)) continue;
    const props = JSON.stringify(e.props && typeof e.props === 'object' ? e.props : {});
    if (props.length > MAX_PROPS) continue;
    const t = typeof e.t === 'number' && Number.isFinite(e.t) ? Math.round(e.t) : null;
    rows.push(insert.bind(session, e.name, t, props, country, url.host));
  }
  if (rows.length) await env.DB.batch(rows);
  return done();
};
