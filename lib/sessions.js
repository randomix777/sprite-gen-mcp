/**
 * Session management for sprite generation — enables iterative editing.
 *
 * Stores sprite generations in config/sessions.json so users can reference
 * a previous output and ask the AI to refine it.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ok, err, ErrorCode } from './result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, '..', 'config', 'sessions.json');

/** Load sessions store */
export function loadSessions() {
  try {
    if (existsSync(SESSIONS_FILE)) {
      return JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (_) {}
  return { sessions: [], nextId: 1 };
}

/** Persist sessions store */
export function saveSessions(sessions) {
  const dir = path.dirname(SESSIONS_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

/** Register a new generation session */
export function createSession(args) {
  const sessions = loadSessions();
  const id = String(sessions.nextId++);
  const entry = {
    id,
    created_at: new Date().toISOString(),
    provider: args.provider,
    prompt: args.prompt,
    output_path: args.output_path,
    history: [],
  };
  sessions.sessions.unshift(entry);
  saveSessions(sessions);
  return ok({ id, output_path: entry.output_path });
}

/** Append an edit result to a session's history */
export function appendEdit(sessionId, editArgs) {
  const sessions = loadSessions();
  const session = sessions.sessions.find((s) => s.id === sessionId);
  if (!session) return err(ErrorCode.FILE_NOT_FOUND, `Session not found: ${sessionId}`, { stage: 'validation' });

  session.history.push({
    step: session.history.length + 1,
    instruction: editArgs.instruction,
    output_path: editArgs.output_path,
    edited_at: new Date().toISOString(),
  });

  // Keep only the latest output as current
  session.output_path = editArgs.output_path;
  saveSessions(sessions);
  return ok(session);
}

/** Get a session by ID */
export function getSession(sessionId) {
  const sessions = loadSessions();
  const session = sessions.sessions.find((s) => s.id === sessionId);
  if (!session) return err(ErrorCode.FILE_NOT_FOUND, `Session not found: ${sessionId}`, { stage: 'validation' });
  return ok(session);
}

/** List all sessions (summary only, no base64 data) */
export function listSessions() {
  const sessions = loadSessions();
  return ok(sessions.sessions.map((s) => ({
    id: s.id,
    created_at: s.created_at,
    provider: s.provider,
    prompt: s.prompt,
    output_path: s.output_path,
    edit_count: s.history?.length ?? 0,
    latest_output: s.output_path,
  })));
}

/** Get the current image path for editing (latest output or original) */
export function getReferenceImagePath(sessionId) {
  const result = getSession(sessionId);
  if (!result.success) return null;
  return result.data.output_path;
}
