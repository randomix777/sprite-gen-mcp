/**
 * Safe directory scanning with depth limits, symlink detection, and file count caps.
 *
 * Prevents:
 *   - Infinite loops via symlink cycles
 *   - Memory exhaustion via deep/wide directory trees
 *   - Scanning into .git, node_modules, .import, etc.
 */

import { readdirSync, lstatSync, statSync, existsSync, realpathSync } from 'fs';
import path from 'path';
import { LIMITS } from './limits.js';

/**
 * Safely scan a directory tree with protections.
 *
 * @param {string} rootDir — starting directory
 * @param {object} [options]
 * @param {number} [options.maxDepth] — max recursion depth
 * @param {number} [options.maxFiles] — max files to visit before stopping
 * @param {Set<string>} [options.skipDirs] — directory names to skip
 * @param {string[]} [options.extensions] — if set, only include files with these extensions
 * @param {number} [options.maxSymlinkFollows] — max symlinks to follow
 * @returns {{ files: string[], dirs: string[], errors: string[] }}
 */
export function safeScanDir(rootDir, options = {}) {
  const {
    maxDepth = LIMITS.godotScan.maxDepth,
    maxFiles = LIMITS.godotScan.maxFiles,
    skipDirs = LIMITS.godotScan.skipDirs,
    extensions,
    maxSymlinkFollows = LIMITS.godotScan.maxSymlinkFollows,
  } = options;

  const files = [];
  const dirs = [];
  const errors = [];
  let symlinkFollows = 0;
  let fileCount = 0;

  function walk(dir, relDir, depth) {
    if (depth > maxDepth) return;
    if (fileCount >= maxFiles) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      errors.push(`Cannot read directory: ${path.relative(rootDir, dir)}`);
      return;
    }

    for (const entry of entries) {
      if (fileCount >= maxFiles) break;

      const entryName = entry.name;

      // Skip hidden files/dirs (starts with .)
      if (entryName.startsWith('.')) continue;

      // Skip known large/unwanted directories
      if (entry.isDirectory() && skipDirs.has(entryName)) continue;

      const fullPath = path.join(dir, entryName);
      const relPath = path.join(relDir, entryName);

      // Handle symlinks — verify they don't escape the root
      if (entry.isSymbolicLink()) {
        symlinkFollows++;
        if (symlinkFollows > maxSymlinkFollows) {
          errors.push(`Too many symlinks — aborting at: ${relPath}`);
          return;
        }
        try {
          // Resolve the symlink to its real target
          const realTarget = realpathSync(fullPath);
          const realRoot = realpathSync(rootDir);
          // Verify the symlink target is still within root
          const rel = path.relative(realRoot, realTarget);
          if (rel.startsWith('..') || path.isAbsolute(rel)) {
            errors.push(`Symlink escapes root: ${relPath} → ${rel}`);
            continue; // skip this symlink entirely
          }
          // Follow the symlink to check what it points to
          const realStat = statSync(fullPath);
          if (realStat.isDirectory()) {
            dirs.push(relPath);
            walk(fullPath, relPath, depth + 1);
          } else if (realStat.isFile()) {
            if (!extensions || extensions.includes(path.extname(entryName).toLowerCase())) {
              files.push(relPath);
              fileCount++;
            }
          }
        } catch (e) {
          errors.push(`Broken symlink: ${relPath}`);
        }
        continue;
      }

      if (entry.isDirectory()) {
        dirs.push(relPath);
        walk(fullPath, relPath, depth + 1);
      } else if (entry.isFile()) {
        if (!extensions || extensions.includes(path.extname(entryName).toLowerCase())) {
          files.push(relPath);
          fileCount++;
        }
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir, '.', 0);
  }

  return { files, dirs, errors, truncated: fileCount >= maxFiles };
}
