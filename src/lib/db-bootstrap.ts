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
  addCol('sessions', 'prompt_count', 'INTEGER');
  addCol('sessions', 'peak_context_tokens', 'INTEGER');
  addCol('sessions', 'last_context_tokens', 'INTEGER');
  addCol('sessions', 'last_turn_at', 'INTEGER');
  // Phase 1 — session outcome tagging. `outcome` is the canonical label
  // (shipped | bugfix | failed | discarded | refactor | explore | NULL),
  // `outcome_source` distinguishes auto-classified rows from user-set rows
  // so the classifier can re-run safely without clobbering human input.
  // Phase 3 ROI metrics (Ship Rate, Output-per-$) read this column; untagged
  // sessions are excluded from rate denominators.
  addCol('sessions', 'outcome', 'TEXT');
  addCol('sessions', 'outcome_source', 'TEXT');
  addCol('sessions', 'outcome_set_at', 'INTEGER');
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

    -- 按「消息实际发生日」归集的 token/prompt（仅 Claude，每 turn 的 timestamp 决定归到哪天）。
    -- 解决跨天长会话把全部 token 算到 started_at 那天、导致"今天 token"恒为 0 的问题。
    CREATE TABLE IF NOT EXISTS session_daily (
      session_id TEXT NOT NULL,
      day_ms INTEGER NOT NULL,          -- 本地该天 0 点的 unix ms
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, day_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_captured ON usage_snapshots(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_source_account_captured ON usage_snapshots(source, account_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_commits_repo_at ON session_commits(repo, committed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_daily_day ON session_daily(day_ms);
  `);
}
