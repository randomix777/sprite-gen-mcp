/**
 * Unified async process runner for sprite-gen MCP server.
 *
 * Replaces all execFileSync calls with non-blocking child_process.spawn.
 *
 * Features:
 *   - shell: false (no shell injection)
 *   - Parameter arrays only
 *   - Timeout with AbortSignal
 *   - stdout/stderr size limits
 *   - Exit code recording
 *   - Child process force-kill on timeout
 *   - Concurrency limiting via semaphores
 */

import { spawn } from 'child_process';
import { LIMITS } from './limits.js';
import { providerSemaphore, ffmpegSemaphore, pythonSemaphore } from './concurrency.js';
import { resolveFfmpegPath, resolveFfprobePath, resolveGifsiclePath } from './exec_path.js';

/** Max bytes to capture from stdout/stderr before truncating */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Resolve command path for known executables.
 * Returns the resolved path or falls back to the command name (system PATH).
 */
function resolveCommand(command) {
  if (command === 'ffmpeg') return resolveFfmpegPath() ?? command;
  if (command === 'ffprobe') return resolveFfprobePath() ?? command;
  if (command === 'gifsicle') return resolveGifsiclePath() ?? command;
  return command;
}

/**
 * Run a subprocess asynchronously with safety checks.
 *
 * @param {string} command — executable name
 * @param {string[]} args — argument array
 * @param {object} [options]
 * @param {number} [options.timeout] — timeout in ms
 * @param {string[]} [options.allowedCommands] — restrict to these executables
 * @param {boolean} [options.capture] — capture stdout (default true)
 * @param {AbortSignal} [options.signal] — external cancellation
 * @param {import('./concurrency.js').Semaphore} [options.semaphore] — concurrency limiter
 * @param {string} [options.cwd] — working directory
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, timedOut: boolean }>}
 */
export function runAsync(command, args, options = {}) {
  const {
    timeout = LIMITS.timeout.pythonMs,
    allowedCommands,
    capture = true,
    signal,
    semaphore,
    cwd,
  } = options;

  // Validate command
  if (allowedCommands && !allowedCommands.includes(command)) {
    return Promise.reject(new Error(`Command not allowed: ${command}`));
  }

  // Validate args
  if (!Array.isArray(args)) {
    return Promise.reject(new Error('Arguments must be an array'));
  }

  const safeArgs = args.map(a => String(a));
  const resolvedCommand = resolveCommand(command);

  const execute = () => new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, safeArgs, {
      shell: false,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      cwd,
      timeout,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    // AbortSignal support
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM');
        return reject(new Error('Operation cancelled'));
      }
      signal.addEventListener('abort', () => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 3 seconds if SIGTERM doesn't work
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
        }, 3000);
      }, { once: true });
    }

    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
        }
      });
    }

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (killed && code !== 0) {
        reject(new Error('Operation cancelled'));
      } else if (timedOut) {
        reject(new Error(`Process timed out after ${timeout}ms`));
      } else {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
          timedOut: false,
        });
      }
    });

    // Timeout handling
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
      }, 3000);
    }, timeout);

    child.on('close', () => clearTimeout(timer));
  });

  // Apply concurrency limiting if a semaphore is provided
  if (semaphore) {
    return semaphore.acquire().then(release => execute().finally(release));
  }

  return execute();
}

/**
 * Run Python script asynchronously.
 * @param {string} scriptPath
 * @param {object} args
 * @param {object} [options]
 * @returns {Promise<object>} parsed JSON result
 */
export async function runPythonAsync(scriptPath, args, options = {}) {
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64');

  try {
    const result = await runAsync('python', [scriptPath, encoded], {
      timeout: options.timeout ?? LIMITS.timeout.pythonMs,
      semaphore: pythonSemaphore,
      signal: options.signal,
    });

    if (result.exitCode !== 0) {
      const msg = result.stderr || `Python script exited with code ${result.exitCode}`;
      throw new Error(msg.slice(0, 500));
    }

    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(e.message?.slice(0, 500) || 'Python script failed');
  }
}

/**
 * Run ffmpeg asynchronously.
 * @param {string[]} args
 * @param {object} [options]
 * @returns {Promise<{ stdout: string, exitCode: number }>}
 */
export async function runFfmpegAsync(args, options = {}) {
  // Validate no shell metacharacters
  for (const arg of args) {
    if (typeof arg === 'string' && /[;&|`$(){}!<>]/.test(arg)) {
      throw new Error(`Potentially dangerous ffmpeg argument: ${arg.slice(0, 50)}`);
    }
  }

  const result = await runAsync('ffmpeg', args, {
    timeout: options.timeout ?? LIMITS.timeout.ffmpegMs,
    capture: true,
    semaphore: ffmpegSemaphore,
    signal: options.signal,
  });

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`ffmpeg failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`);
  }

  return { stdout: result.stdout, exitCode: result.exitCode };
}

/**
 * Run gifsicle asynchronously.
 * @param {string[]} args
 * @param {object} [options]
 * @returns {Promise<string>} stdout
 */
export async function runGifsicleAsync(args, options = {}) {
  const result = await runAsync('gifsicle', args, {
    timeout: options.timeout ?? LIMITS.timeout.gifsicleMs,
    capture: true,
    signal: options.signal,
  });

  if (result.exitCode !== 0) {
    throw new Error(`gifsicle failed (exit ${result.exitCode})`);
  }

  return result.stdout;
}

/**
 * Check if a command exists on PATH (async).
 * @param {string} command
 * @param {string[]} [args=['--version']]
 * @returns {Promise<boolean>}
 */
export async function commandExistsAsync(command, args = ['--version']) {
  try {
    const result = await runAsync(command, args, {
      timeout: LIMITS.timeout.versionCheckMs,
      capture: false,
    });
    return result.exitCode === 0;
  } catch (_) {
    return false;
  }
}
