/**
 * Path safety utilities for sprite-gen MCP server.
 *
 * Provides:
 *   - Path normalization and traversal prevention
 *   - Output boundary enforcement
 *   - Safe resolve against allowed roots
 */

import path from 'path';
import { existsSync, statSync, mkdirSync, realpathSync } from 'fs';
import { LIMITS } from './limits.js';
import { err, ErrorCode } from './result.js';

/**
 * Resolve and normalize a user-supplied path.
 * Returns the absolute, resolved path.
 */
export function safePath(userPath) {
  if (typeof userPath !== 'string' || !userPath.trim()) return null;
  return path.resolve(userPath);
}

/**
 * Check if a resolved path is within an allowed root directory.
 * @param {string} resolvedPath — must already be path.resolve()'d
 * @param {string} root — the allowed root directory (also resolved)
 * @returns {boolean}
 */
export function isWithinRoot(resolvedPath, root) {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(resolvedPath);
  // Use path.relative to check containment — handles .. on Windows
  const rel = path.relative(absRoot, absTarget);
  // path.relative returns '' for same dir, or '../foo' for escapes, or 'foo' for inside
  // On Windows, cross-drive relative returns an absolute path (e.g. 'C:\\...') — reject that too
  return !rel.startsWith('..') && rel !== '' && !path.isAbsolute(rel);
}

/**
 * Check if path traversal is present (contains .. segments that escape root).
 * @param {string} userPath
 * @returns {boolean} true if the path attempts traversal
 */
export function hasTraversal(userPath) {
  if (typeof userPath !== 'string') return false;
  const normalized = path.normalize(userPath);
  // After normalization, if it still has '..' at start or after root, it's traversal
  return /\.\./.test(normalized) && normalized !== userPath.replace(/\.\./g, '');
}

/**
 * Validate an output path is safe for writing.
 * Returns err() on failure, null on success.
 *
 * @param {string} outputPath — user-supplied output path
 * @param {string|string[]} inputPaths — input file paths to protect from overwrite
 * @param {object} [options]
 * @param {string} [options.allowRoot] — override the output root directory
 * @param {boolean} [options.allowOverwrite] — allow overwriting existing files
 * @param {boolean} [options.allowOverwriteInput] — allow overwriting input files
 */
export function validateOutputPath(outputPath, inputPaths = [], options = {}) {
  if (!outputPath || typeof outputPath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'Output path is required', { stage: 'validation' });
  }

  const resolved = path.resolve(outputPath);
  const root = options.allowRoot ? path.resolve(options.allowRoot) : LIMITS.output.projectRoot;

  // Check path traversal — ensure resolved path stays under project root
  if (!isWithinRoot(resolved, root)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Output path must be within project directory: ${path.relative(root, resolved)}`, { stage: 'validation' });
  }

  // Prevent overwrite of input files unless explicitly allowed
  const allowOverwriteInput = options.allowOverwriteInput ?? LIMITS.output.allowOverwriteInput;
  if (!allowOverwriteInput) {
    const absInputs = (Array.isArray(inputPaths) ? inputPaths : [inputPaths]).map(p => path.resolve(p));
    if (absInputs.includes(resolved)) {
      return err(ErrorCode.INVALID_ARGUMENT, 'Cannot overwrite input file with output', { stage: 'validation' });
    }
  }

  // Prevent overwrite of existing files unless explicitly allowed
  const allowOverwrite = options.allowOverwrite ?? LIMITS.output.allowOverwrite;
  if (!allowOverwrite && existsSync(resolved)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Output file already exists: ${resolved}. Use a different name or enable overwrite.`, { stage: 'validation' });
  }

  return null; // valid
}

/**
 * Validate that a file path exists and is a regular file (not a directory, symlink to weird place, etc.)
 * Returns the resolved path on success, err() on failure.
 */
export function validateInputFile(filePath, { checkExtension, allowedExtensions } = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'File path is required', { stage: 'validation' });
  }

  const resolved = path.resolve(filePath);

  // Check extension if required
  if (checkExtension && allowedExtensions) {
    const ext = path.extname(resolved).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return err(ErrorCode.UNSUPPORTED_FORMAT, `Unsupported file format: ${ext}. Allowed: ${allowedExtensions.join(', ')}`, { stage: 'validation' });
    }
  }

  // Check existence
  if (!existsSync(resolved)) {
    return err(ErrorCode.FILE_NOT_FOUND, `File not found: ${filePath}`, { stage: 'validation' });
  }

  // Check it's a regular file (not a directory, pipe, etc.)
  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) {
      return err(ErrorCode.FILE_NOT_FOUND, `Path is not a regular file: ${filePath}`, { stage: 'validation' });
    }
    // Check file size
    if (stat.size > LIMITS.image.maxFileSizeBytes) {
      return err(ErrorCode.INVALID_ARGUMENT, `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB (max: ${LIMITS.image.maxFileSizeBytes / 1024 / 1024} MB)`, { stage: 'validation' });
    }
  } catch (e) {
    return err(ErrorCode.FILE_NOT_FOUND, `Cannot access file: ${filePath}`, { stage: 'validation' });
  }

  return resolved;
}

/**
 * Get a safe, normalized output directory, ensuring it exists.
 * Returns the resolved path on success, err() on failure.
 */
export function ensureOutputDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'Output directory is required', { stage: 'validation' });
  }

  const resolved = path.resolve(dirPath);
  const root = LIMITS.output.projectRoot;

  if (!isWithinRoot(resolved, root)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Output directory must be within project: ${path.relative(root, resolved)}`, { stage: 'validation' });
  }

  return resolved;
}

/**
 * Validate output path, create parent directory, return resolved path.
 * All-in-one for service functions that write a single output file.
 *
 * @param {string} outputPath — user-supplied output path
 * @param {object} [options]
 * @param {string|string[]} [options.inputPaths] — input files to protect from overwrite
 * @param {string} [options.allowRoot] — override the output root directory
 * @param {boolean} [options.allowOverwrite] — allow overwriting existing files
 * @param {boolean} [options.mkdir] — create parent directory (default true)
 * @returns {{ resolved: string } | { error: object }} resolved path or error result
 */
export function safeOutputPath(outputPath, options = {}) {
  const { inputPaths, ...validateOpts } = options;
  const validationErr = validateOutputPath(outputPath, inputPaths || [], validateOpts);
  if (validationErr) return { error: validationErr };

  const resolved = path.resolve(outputPath);
  if (options.mkdir !== false) {
    try { mkdirSync(path.dirname(resolved), { recursive: true }); } catch (_) {}
  }
  return { resolved };
}

// ─── Godot project path safety ──────────────────────────────────────────────

/**
 * Validate a Godot project root: must exist, be a directory, contain project.godot,
 * and resolve to a real path (following symlinks/junctions).
 * Returns resolved real path on success, err() on failure.
 *
 * @param {string} projectPath
 * @returns {string|object} — resolved real path or err() result
 */
export function validateGodotProject(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'project_path is required', { stage: 'validation' });
  }

  const resolved = path.resolve(projectPath);

  // Must exist and be a directory
  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      return err(ErrorCode.INVALID_ARGUMENT, `project_path is not a directory: ${projectPath}`, { stage: 'validation' });
    }
  } catch (e) {
    return err(ErrorCode.FILE_NOT_FOUND, `project_path not found: ${projectPath}`, { stage: 'validation' });
  }

  // Resolve symlinks/junctions to real path
  let realRoot;
  try {
    realRoot = realpathSync(resolved);
  } catch (e) {
    return err(ErrorCode.INVALID_ARGUMENT, `Cannot resolve project_path (broken symlink?): ${projectPath}`, { stage: 'validation' });
  }

  // Must contain project.godot
  const godotFile = path.join(realRoot, 'project.godot');
  if (!existsSync(godotFile)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Not a Godot project (no project.godot found in ${realRoot})`, { stage: 'validation' });
  }

  return realRoot;
}

/**
 * Resolve a path relative to a Godot project root and verify it stays inside.
 * Handles: relative paths, absolute paths, UNC paths, symlink escapes.
 *
 * @param {string} projectRoot — real resolved Godot project root
 * @param {string} relativePath — user-supplied path (must be relative)
 * @param {object} [options]
 * @param {boolean} [options.allowAbsolute] — also accept absolute paths (resolved against root)
 * @returns {string|object} — resolved path or err() result
 */
export function resolveGodotPath(projectRoot, relativePath, options = {}) {
  if (!relativePath || typeof relativePath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'Path is required', { stage: 'validation' });
  }

  // Reject UNC paths
  if (relativePath.startsWith('\\\\') || relativePath.startsWith('//')) {
    return err(ErrorCode.INVALID_ARGUMENT, `UNC/network paths are not allowed: ${relativePath}`, { stage: 'validation' });
  }

  // Reject Windows absolute paths
  if (/^[A-Za-z]:[\\\/]/.test(relativePath)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Absolute paths outside project are not allowed: ${relativePath}`, { stage: 'validation' });
  }

  // Reject paths with traversal
  if (relativePath.includes('..')) {
    return err(ErrorCode.INVALID_ARGUMENT, `Path traversal (..) is not allowed: ${relativePath}`, { stage: 'validation' });
  }

  // Reject res:// paths that try to escape
  if (relativePath.startsWith('res://')) {
    const inner = relativePath.slice(6);
    if (inner.startsWith('../') || inner.includes('/../') || inner === '..') {
      return err(ErrorCode.INVALID_ARGUMENT, `res:// traversal is not allowed: ${relativePath}`, { stage: 'validation' });
    }
  }

  // Resolve the full path
  const resolved = path.isAbsolute(relativePath) && !options.allowAbsolute
    ? path.resolve(projectRoot, path.basename(relativePath)) // force basename for absolute
    : path.resolve(projectRoot, relativePath);

  // Verify the resolved path is within project root (using realpathSync for symlink check)
  let realResolved;
  try {
    realResolved = realpathSync(path.dirname(resolved));
    realResolved = path.join(realResolved, path.basename(resolved));
  } catch (e) {
    // Parent doesn't exist yet — use the resolved path for containment check
    realResolved = resolved;
  }

  const rel = path.relative(projectRoot, realResolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Path escapes project root: ${relativePath} → ${rel}`, { stage: 'validation' });
  }

  return realResolved;
}

/**
 * Validate that a write path is within a Godot project and optionally check overwrite.
 * All writeFileSync in Godot integration must call this first.
 *
 * @param {string} projectRoot — real resolved Godot project root
 * @param {string} writePath — the full resolved path to write to
 * @param {object} [options]
 * @param {boolean} [options.allowOverwrite] — allow overwriting existing files
 * @param {string[]} [options.forbiddenNames] — filenames that must not be overwritten
 * @returns {null|object} — null on success, err() on failure
 */
export function validateGodotWritePath(projectRoot, writePath, options = {}) {
  const resolved = path.resolve(writePath);
  const realRoot = path.resolve(projectRoot);

  // Containment check
  const rel = path.relative(realRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Write path escapes project root: ${path.relative(realRoot, resolved)}`, { stage: 'validation' });
  }

  // Forbidden filenames (project.godot, .git, .godot, etc.)
  const forbidden = options.forbiddenNames || ['project.godot'];
  const basename = path.basename(resolved);
  if (forbidden.includes(basename)) {
    return err(ErrorCode.INVALID_ARGUMENT, `Cannot overwrite protected file: ${basename}`, { stage: 'validation' });
  }

  // Prevent writing into .git or .godot directories
  const parts = rel.split(/[\/\\]/);
  for (const part of parts) {
    if (part === '.git' || part === '.godot') {
      return err(ErrorCode.INVALID_ARGUMENT, `Cannot write into ${part} directory`, { stage: 'validation' });
    }
  }

  // Overwrite check
  const allowOverwrite = options.allowOverwrite ?? false;
  if (!allowOverwrite && existsSync(resolved)) {
    return err(ErrorCode.INVALID_ARGUMENT, `File already exists: ${rel}. Use overwrite=true to update.`, { stage: 'validation' });
  }

  return null; // valid
}

/**
 * Validate a video input file with size and basic checks.
 * Returns err() on failure, resolved path on success.
 *
 * @param {string} filePath
 * @returns {string|object} resolved path or err() result
 */
export function validateVideoInput(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return err(ErrorCode.INVALID_ARGUMENT, 'video_path is required', { stage: 'validation' });
  }
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    return err(ErrorCode.FILE_NOT_FOUND, `Video not found: ${filePath}`, { stage: 'validation' });
  }
  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) {
      return err(ErrorCode.FILE_NOT_FOUND, `Path is not a regular file: ${filePath}`, { stage: 'validation' });
    }
    if (stat.size > LIMITS.video.maxFileSizeBytes) {
      return err(ErrorCode.INVALID_ARGUMENT, `Video too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB (max: ${LIMITS.video.maxFileSizeBytes / 1024 / 1024} MB)`, { stage: 'validation' });
    }
  } catch (e) {
    return err(ErrorCode.FILE_NOT_FOUND, `Cannot access video: ${filePath}`, { stage: 'validation' });
  }
  return resolved;
}
