/**
 * Godot 4 executable resolution — single source of truth.
 *
 * Priority order:
 *  1. Explicit parameter godot_executable (runtime override)
 *  2. Persistent config `settings.godot.executablePath`
 *  3. Environment variable GODOT4_BIN
 *  4. PATH lookups for godot4, godot
 *  5. Windows common install locations (bounded scan, no full-disk recursion)
 *  6. Unconfigured state if nothing found
 *
 * All callers MUST use resolveGodot() instead of rolling their own lookup.
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { loadConfig } from './config.js';

/** Max depth for bounded directory scanning. */
const SCAN_DEPTH = 2;

/** Bounded set of Windows locations to check (no full-disk recursion). */
const WINDOWS_SCAN_LOCATIONS = [
  // LocalAppData variants
  () => {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return [
      path.join(base, 'Godot', 'app_temp', 'godot.exe'),
      path.join(base, 'Godot', 'godot_windows_console.exe'),
      path.join(base, 'Godot', 'godot.windows.opt.64.exe'),
      path.join(base, 'Godot', 'godot.windows.editor.64.exe'),
    ];
  },
  // ProgramFiles variants
  () => {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const results = [];
    for (const base of [pf, pf86]) {
      results.push(
        path.join(base, 'Godot', 'Godot_v4.7.2-stable_win64.exe'),
        path.join(base, 'Godot', 'Godot_v4.7.1-stable_win64.exe'),
        path.join(base, 'Godot', 'Godot_v4.7-stable_win64.exe'),
        path.join(base, 'Godot', 'Godot_v4.6-stable_win64.exe'),
        path.join(base, 'Godot', 'godot.exe'),
        path.join(base, 'Godot', 'godot_windows_console.exe'),
      );
    }
    return results;
  },
  // D:\Godot*.exe — common user install
  () => {
    const results = [];
    if (existsSync('D:\\')) {
      try {
        const entries = require('fs').readdirSync('D:\\', { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && /^godot.*\.exe$/i.test(e.name)) {
            results.push(path.join('D:\\', e.name));
          }
        }
      } catch (_) {}
    }
    return results;
  },
  // Project-nearby Godot binaries (parent dirs up to SCAN_DEPTH)
  () => {
    const results = [];
    const cwd = process.cwd();
    for (let i = 0; i <= SCAN_DEPTH; i++) {
      const ancestor = cwd.split(path.sep).slice(0, Math.max(1, cwd.split(path.sep).length - i)).join(path.sep) || path.sep;
      for (const name of ['Godot_v4.7.2-stable_win64_console.exe', 'godot.exe', 'godot_windows_console.exe']) {
        results.push(path.join(ancestor, name));
      }
    }
    return results;
  },
];

/**
 * Verify a candidate path is a valid Godot 4 binary by checking --version.
 * Returns true if the binary runs and reports a version containing "4.".
 */
function getGodotVersion(binaryPath) {
  if (typeof binaryPath !== 'string' || !binaryPath.trim() || !existsSync(binaryPath)) return null;
  try {
    const out = execSync(`"${binaryPath}" --version`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    const version = out.trim().split(/\r?\n/)[0];
    return /\b4\./.test(version) ? version : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve a Godot 4 executable using the priority chain.
 *
 * @param {object} [options]
 * @param {string} [options.godot_executable] — runtime override (highest priority)
 * @returns {{ executable: string|null, version: string|null, available: boolean, note: string }}
 */
export function resolveGodot(options = {}) {
  // Priority 1: explicit parameter
  if (Object.prototype.hasOwnProperty.call(options, 'godot_executable')) {
    const p = options.godot_executable;
    const version = getGodotVersion(p);
    if (version) {
      return { executable: p, version, available: true, note: 'explicit parameter' };
    }
    return { executable: null, version: null, available: false, note: `explicit parameter not valid: ${p}` };
  }

  // Priority 2: persistent config
  try {
    const config = loadConfig();
    const cfgPath = config.godot?.executablePath;
    const version = getGodotVersion(cfgPath);
    if (version) {
      return { executable: cfgPath, version, available: true, note: 'persistent config' };
    }
  } catch (_) {}

  // Priority 3: environment variable
  const envVersion = getGodotVersion(process.env.GODOT4_BIN);
  if (envVersion) {
    return { executable: process.env.GODOT4_BIN, version: envVersion, available: true, note: 'env GODOT4_BIN' };
  }

  // Priority 4: PATH lookups
  for (const name of ['godot4', 'godot', 'Godot', 'Godot4', 'godot_windows_console.exe']) {
    try {
      const out = execSync(`where "${name}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 });
      const lines = out.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const version = getGodotVersion(line);
        if (version) {
          return { executable: line, version, available: true, note: 'PATH' };
        }
      }
    } catch (_) {}
  }

  // Priority 5: Windows common locations (bounded scan)
  for (const locator of WINDOWS_SCAN_LOCATIONS) {
    try {
      const candidates = locator();
      for (const c of candidates) {
        const version = getGodotVersion(c);
        if (version) {
          return { executable: c, version, available: true, note: 'windows scan' };
        }
      }
    } catch (_) {}
  }

  // Priority 6: unconfigured
  return { executable: null, version: null, available: false, note: 'unconfigured — no Godot 4 binary found' };
}

/**
 * Run a Godot 4 headless import/load check on a scene.
 *
 * @param {object} args
 * @param {string} args.projectPath — Godot project root
 * @param {string} args.sceneRelPath — scene path relative to project root
 * @param {string} [args.godot_executable] — optional runtime override
 * @returns {Promise<{available, version, command, exit_code, stdout, stderr, loaded, note}>}
 */
export async function runGodotHeadless(args) {
  const { projectPath, sceneRelPath, godot_executable } = args;
  const resolution = resolveGodot(godot_executable ? { godot_executable } : {});
  if (!resolution.available) {
    return { available: false, version: null, command: null, exit_code: null, stdout: '', stderr: '', loaded: false, note: resolution.note };
  }

  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const argsGodot = ['--headless', '--path', projectPath, '--check-only', sceneRelPath];
    const TIMEOUT_MS = 25000;
    let settled = false;
    const proc = spawn(resolution.executable, argsGodot, { cwd: projectPath, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve({ available: true, version: resolution.version, command: `${resolution.executable} ${argsGodot.join(' ')}`,
        exit_code: null, stdout, stderr, loaded: false, note: 'timed out — engine did not confirm load (treated as not verified)' });
    }, TIMEOUT_MS);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', e => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ available: true, version: resolution.version, command: `${resolution.executable} ${argsGodot.join(' ')}`, exit_code: null, stdout, stderr: e.message, loaded: false, note: 'spawn error' });
    });
    proc.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const errSig = /parse error|invalid property|script error|error loading|could not|tscn/i.test(stderr + stdout);
      const loaded = code === 0 && !errSig;
      resolve({
        available: true,
        version: resolution.version,
        command: `${resolution.executable} ${argsGodot.join(' ')}`,
        exit_code: code,
        stdout: stdout.slice(0, 4000),
        stderr: stderr.slice(0, 4000),
        loaded,
        note: loaded ? 'scene loaded successfully' : `scene load failed (code=${code})`,
      });
    });
  });
}

/**
 * Get Godot status summary for the Web UI.
 */
export function getGodotStatus(extraOverride) {
  const resolution = resolveGodot(extraOverride);
  return {
    available: resolution.available,
    executable: resolution.executable,
    version: resolution.version,
    note: resolution.note,
  };
}
