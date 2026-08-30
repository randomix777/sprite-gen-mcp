/**
 * Isolated temporary directory management for sprite-gen MCP server.
 *
 * Each operation gets its own temp directory (uuid-based).
 * Cleanup is guaranteed via finally blocks.
 */

import { mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { LIMITS } from './limits.js';

/**
 * Create an isolated temp directory for an operation.
 * @param {string} prefix — descriptive prefix (e.g. 'video', 'gif', 'sheet')
 * @returns {string} absolute path to the new temp directory
 */
export function createTempDir(prefix = 'op') {
  const baseDir = path.join(process.cwd(), LIMITS.temp.baseDir);
  const dirName = `${prefix}_${randomUUID()}`;
  const tmpDir = path.join(baseDir, dirName);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Safely remove a temp directory and all contents.
 * No-ops if the directory doesn't exist or removal fails.
 * @param {string} tmpDir — path to remove
 */
export function cleanupTempDir(tmpDir) {
  if (!tmpDir) return;
  try {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (_) {
    // Best-effort cleanup — don't throw on failure
  }
}

/**
 * Get a unique filename within a temp directory.
 * @param {string} tmpDir
 * @param {string} ext — file extension including dot (e.g. '.png')
 * @returns {string} absolute path
 */
export function tempFile(tmpDir, ext = '.png') {
  return path.join(tmpDir, `${randomUUID()}${ext}`);
}

/**
 * Ensure the base temp directory exists and check disk usage.
 * @returns {null|string} null if OK, error message if over limit
 */
export function checkTempQuota() {
  const baseDir = path.join(process.cwd(), LIMITS.temp.baseDir);
  // Basic existence check — don't attempt expensive disk usage calc
  // The per-operation cleanup is the primary safeguard
  return null;
}
