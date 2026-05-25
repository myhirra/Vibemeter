import type Database from 'better-sqlite3';

export function bootstrap(db: Database.Database): void {
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
      account_id TEXT,
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
  `);

  // Idempotent column additions (SQLite has no ADD COLUMN IF NOT EXISTS)
  const addCol = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  };
  addCol('sessions', 'ai_title', 'TEXT');
  addCol('sessions', 'tags', 'TEXT DEFAULT "[]"');
  addCol('sessions', 'codex_category', 'TEXT');
  addCol('sessions', 'tokens_used', 'INTEGER');
  addCol('sessions', 'input_tokens', 'INTEGER');
  addCol('sessions', 'cache_creation_tokens', 'INTEGER');
  addCol('sessions', 'cache_read_tokens', 'INTEGER');
  addCol('sessions', 'output_tokens', 'INTEGER');
  addCol('sessions', 'peak_context_tokens', 'INTEGER');
  addCol('sessions', 'last_context_tokens', 'INTEGER');
  addCol('sessions', 'last_turn_at', 'INTEGER');
  addCol('usage_snapshots', 'account_id', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      sha TEXT NOT NULL,
      subject TEXT,
      committed_at INTEGER NOT NULL,
      UNIQUE(session_id, sha)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_captured ON usage_snapshots(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_source_account_captured ON usage_snapshots(source, account_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_commits_repo_at ON session_commits(repo, committed_at DESC);
  `);
}
