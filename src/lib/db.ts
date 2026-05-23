import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { dataDir } from './data-dir';
import { bootstrap } from './db-bootstrap';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(path.join(dir, 'continuity.sqlite'));
  _db.pragma('journal_mode = WAL');
  bootstrap(_db);
  return _db;
}
