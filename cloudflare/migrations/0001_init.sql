CREATE TABLE IF NOT EXISTS market_runs (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  total_rows INTEGER,
  normalized_rows INTEGER,
  raw_key TEXT,
  normalized_key TEXT,
  manifest_key TEXT,
  raw_sha256 TEXT,
  audit_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS market_runs_date_idx ON market_runs(trade_date, started_at DESC);

CREATE TABLE IF NOT EXISTS market_quotes (
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  asset TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  amount REAL,
  turnover REAL,
  PRIMARY KEY (run_id, symbol),
  FOREIGN KEY (run_id) REFERENCES market_runs(id)
);
CREATE INDEX IF NOT EXISTS market_quotes_asset_idx ON market_quotes(run_id, asset, symbol);
CREATE INDEX IF NOT EXISTS market_quotes_symbol_idx ON market_quotes(symbol, trade_date);

CREATE TABLE IF NOT EXISTS source_probes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  endpoint_type TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  latency_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS source_probes_latest_idx ON source_probes(source, checked_at DESC);
