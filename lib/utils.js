/**
 * Shared utilities — avoids circular dependencies between index.js and sub-modules.
 */
import { writeFileSync, execFileSync } from 'fs';
import path from 'path';

/**
 * Save generated image data (base64) to disk and return the absolute path.
 */
export function saveGeneratedImage(data, mimeType, outputPath) {
  const abs = path.resolve(outputPath);
  const buffer = Buffer.from(data, 'base64');
  writeFileSync(abs, buffer);
  return abs;
}

/**
 * Run the Python sprite processing script and return parsed JSON result.
 * @param {object} args — passed to process_sprites.py as base64-encoded JSON
 */
export function runPythonScript(args) {
  const scriptPath = path.join(__dirname, 'process_sprites.py');
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64');
  try {
    const output = execFileSync('python', [scriptPath, encoded], {
      encoding: 'utf8',
      timeout: 60000,
    });
    return JSON.parse(output.trim());
  } catch (err) {
    return { success: false, error: err.stderr?.trim() || err.message };
  }
}
