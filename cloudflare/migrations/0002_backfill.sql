CREATE TABLE IF NOT EXISTS backfill_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'PILOT',
  attempt_limit INTEGER NOT NULL DEFAULT 3,
  attempts INTEGER NOT NULL DEFAULT 0,
  calendar_rows INTEGER,
  calendar_raw_key TEXT,
  calendar_sha256 TEXT,
  calendar_loaded_at TEXT,
  last_error TEXT,
  lock_until TEXT,
  updated_at TEXT
);
INSERT OR IGNORE INTO backfill_control (id,start_date,end_date,enabled,state,attempt_limit,updated_at)
  VALUES(1,'2020-01-01','2026-11-20',1,'PILOT',3,datetime('now'));

CREATE TABLE IF NOT EXISTS backfill_days (
  trade_date TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_run_id TEXT,
  last_error TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS backfill_days_status_idx ON backfill_days(status,trade_date);
