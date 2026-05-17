import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'continuity.sqlite');

function bootstrap(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      exit_code INTEGER,
      cwd TEXT,
      cli_args TEXT,
      summary TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium'
    );

    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      window_5h_used_pct REAL,
      window_weekly_used_pct REAL,
      reset_at_5h INTEGER,
      reset_at_weekly INTEGER,
      raw_output TEXT,
      confidence TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_captured ON usage_snapshots(captured_at DESC);
  `);
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  bootstrap(_db);
  return _db;
}
