-- Anonymous race stats sent by the game (src/analytics.ts via functions/api/event.ts).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  session TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Milliseconds since the page loaded, as reported by the browser.
  t INTEGER,
  props TEXT NOT NULL DEFAULT '{}',
  country TEXT,
  host TEXT
);
CREATE INDEX IF NOT EXISTS events_name_time ON events (name, received_at);
CREATE INDEX IF NOT EXISTS events_session ON events (session);
