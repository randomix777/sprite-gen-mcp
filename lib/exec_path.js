/**
 * Executable path resolution for sprite-gen.
 *
 * Finds ffmpeg, ffprobe, gifsicle in order:
 *   1. Environment variable (SPRITE_GEN_FFMPEG_PATH etc.)
 *   2. Project-local tools/ directory
 *   3. System PATH (via commandExistsAsync)
 *
 * No system PATH modification.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(PROJECT_ROOT, 'tools');

const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const EXE = PLATFORM === 'win32' ? '.exe' : '';

/**
 * Resolve the path to an executable.
 *
 * @param {string} name — executable name (e.g. 'ffmpeg')
 * @param {string} envVar — environment variable name (e.g. 'SPRITE_GEN_FFMPEG_PATH')
 * @param {string[]} localSubdirs — subdirectories to check under tools/
 * @returns {string|null} resolved path, or null if not found
 */
export function resolveExecPath(name, envVar, localSubdirs = []) {
  // 1. Environment variable
  const envPath = process.env[envVar];
  if (envPath) {
    const exePath = envPath.endsWith(EXE) ? envPath : path.join(envPath, name + EXE);
    if (existsSync(exePath)) return exePath;
  }

  // 2. Project-local tools/
  const candidates = localSubdirs.map(sub => path.join(TOOLS_DIR, sub, name + EXE));
  candidates.push(path.join(TOOLS_DIR, name + EXE));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Resolve ffmpeg path.
 */
export function resolveFfmpegPath() {
  return resolveExecPath('ffmpeg', 'SPRITE_GEN_FFMPEG_PATH', ['ffmpeg/bin']);
}

/**
 * Resolve ffprobe path.
 */
export function resolveFfprobePath() {
  return resolveExecPath('ffprobe', 'SPRITE_GEN_FFPROBE_PATH', ['ffmpeg/bin']);
}

/**
 * Resolve gifsicle path.
 */
export function resolveGifsiclePath() {
  return resolveExecPath('gifsicle', 'SPRITE_GEN_GIFSICLE_PATH', ['gifsicle/bin']);
}
