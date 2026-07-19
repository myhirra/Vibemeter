import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

// GLM CLI stores its sessions in a directory structure similar to Claude Code
// Default location: ~/.glm/sessions/ or ~/.local/share/glm/sessions/
// Each session has a JSON file with metadata and conversation logs
const GLM_SESSIONS_DIR = path.join(os.homedir(), '.glm', 'sessions');
const GLM_LOCAL_DIR = path.join(os.homedir(), '.local', 'share', 'glm', 'sessions');

interface GLMSession {
  id: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
  project_path?: string;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
}

export function importGLMSessions(): void {
  // Try both possible locations
  const sessionDirs = [GLM_SESSIONS_DIR, GLM_LOCAL_DIR];
  let imported = false;

  for (const sessionDir of sessionDirs) {
    if (!fs.existsSync(sessionDir)) continue;

    try {
      const files = fs.readdirSync(sessionDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const sessionPath = path.join(sessionDir, file);
        const sessionData = parseGLMSessionFile(sessionPath);
        
        if (sessionData) {
          upsertGLMSession(sessionData);
          imported = true;
        }
      }
    } catch {
      // Skip this directory if there's an error
      continue;
    }
  }

  if (!imported) {
    // If no sessions found in standard locations, check for alternative patterns
    importAlternativeGLMSessions();
  }
}

function parseGLMSessionFile(filePath: string): GLMSession | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content) as GLMSession;
    
    // Validate required fields
    if (!data.id || !data.created_at) {
      return null;
    }

    // Extract title from first user message if not provided
    if (!data.title && data.messages && data.messages.length > 0) {
      const firstUserMessage = data.messages.find(m => m.role === 'user');
      if (firstUserMessage && firstUserMessage.content) {
        data.title = firstUserMessage.content.slice(0, 120);
      }
    }

    return data;
  } catch {
    return null;
  }
}

function upsertGLMSession(session: GLMSession): void {
  const db = getDb();
  
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, confidence, prompt_count)
    VALUES (@id, 'glm', @started_at, @ended_at, @cwd, @ai_title, 'medium', @prompt_count)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      cwd = COALESCE(sessions.cwd, excluded.cwd),
      ai_title = COALESCE(sessions.ai_title, excluded.ai_title),
      prompt_count = excluded.prompt_count
  `);

  const startedAt = session.created_at ? session.created_at * 1000 : Date.now();
  const endedAt = session.updated_at ? session.updated_at * 1000 : startedAt;
  const promptCount = session.messages ? session.messages.filter(m => m.role === 'user').length : 0;

  upsert.run({
    id: session.id,
    started_at: startedAt,
    ended_at: endedAt,
    cwd: session.project_path || null,
    ai_title: session.title || null,
    prompt_count: promptCount,
  });
}

function importAlternativeGLMSessions(): void {
  // Check for alternative GLM session storage patterns
  const alternativePaths = [
    path.join(os.homedir(), '.config', 'glm', 'sessions'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'glm', 'sessions'), // Windows
    path.join(os.homedir(), '.cache', 'glm', 'sessions'),
  ];

  for (const altPath of alternativePaths) {
    if (!fs.existsSync(altPath)) continue;

    try {
      const files = fs.readdirSync(altPath);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const sessionPath = path.join(altPath, file);
        const sessionData = parseGLMSessionFile(sessionPath);
        
        if (sessionData) {
          upsertGLMSession(sessionData);
        }
      }
    } catch {
      continue;
    }
  }
}