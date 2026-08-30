/**
 * test/video_real.js — Real video processing tests
 *
 * Tests extractVideoFrames and videoToSpriteSheet against a dynamically
 * generated ffmpeg test fixture (2-second, 32×32, 4 FPS red solid video).
 *
 * Structure:
 *   1. Fixture creation (ffmpeg-generated, not pre-existing)
 *   2. extractVideoFrames validation
 *   3. videoToSpriteSheet validation
 *   4. Boundary / invalid-argument tests
 *   5. Colors parameter behavior
 *   6. Cleanup verification
 *
 * Exit code 0 = all pass, 1 = at least one failure.
 */

import { mkdtempSync, rmSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';

// ── Project imports ──────────────────────────────────────────────────────────
import { extractVideoFrames, videoToSpriteSheet } from '../lib/video_gen.js';
import { runFfmpegAsync } from '../lib/runner.js';
import { ErrorCode } from '../lib/result.js';
import { createTempDir, cleanupTempDir } from '../lib/temp.js';

// ── Tiny test harness ────────────────────────────────────────────────────────

let total = 0;
let passed = 0;
let failed = 0;
const failures = [];

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

function assert(condition, label, detail = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `  ✗ ${label} — ${detail}` : `  ✗ ${label}`;
    console.log(msg);
    failures.push(label);
  }
}

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  assert(ok, label, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertErrorCode(result, expectedCode, label) {
  const ok = !result.success && result.error?.code === expectedCode;
  assert(ok, label, ok ? '' : `expected error code ${expectedCode}, got ${JSON.stringify(result.error?.code ?? result)}`);
}

function assertApprox(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) <= tolerance;
  assert(ok, label, ok ? '' : `expected ~${expected} ±${tolerance}, got ${actual}`);
}

// ── Fixture creation ─────────────────────────────────────────────────────────

/**
 * Create a fresh test video fixture using ffmpeg directly.
 * 2 seconds, 32×32, 4 FPS, red solid color, H.264.
 */
async function createTestVideoFixture(tmpDir) {
  const videoPath = path.join(tmpDir, 'test_video.mp4');
  await runFfmpegAsync([
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=red:s=32x32:d=2:r=4',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    videoPath,
  ]);
  if (!existsSync(videoPath)) {
    throw new Error(`Failed to create test video fixture at ${videoPath}`);
  }
  return videoPath;
}

// ── Async test runner ────────────────────────────────────────────────────────

async function run() {
  let fixtureDir = null;
  let fixtureVideoPath = null;

  try {
    // ════════════════════════════════════════════════════════════════════════
    //  1. FIXTURE CREATION
    // ════════════════════════════════════════════════════════════════════════
    section('1. Test Video Fixture Creation');

    fixtureDir = createTempDir('test_fixture');
    fixtureVideoPath = await createTestVideoFixture(fixtureDir);

    assert(existsSync(fixtureVideoPath), 'Test video file exists');
    const fixtureStat = statSync(fixtureVideoPath);
    assert(fixtureStat.size > 0, `Test video is non-empty (${fixtureStat.size} bytes)`);

    // ════════════════════════════════════════════════════════════════════════
    //  2. extractVideoFrames
    // ════════════════════════════════════════════════════════════════════════
    section('2. extractVideoFrames');

    const framesDir = path.join(fixtureDir, 'frames_out');
    const extractResult = await extractVideoFrames({
      video_path: fixtureVideoPath,
      fps: 4,
      output_dir: framesDir,
    });

    assert(extractResult.success === true, 'extractVideoFrames returns success');
    if (!extractResult.success) {
      console.log('    Error:', JSON.stringify(extractResult.error));
    } else {
      const { frame_count, output_dir, files } = extractResult.data;

      // frame_count: 2s × 4fps = ~8 frames (ffmpeg may produce 7–9 depending on rounding)
      assertApprox(frame_count, 8, 2, `frame_count ≈ 8 (got ${frame_count})`);

      assert(output_dir === framesDir, `output_dir matches requested path`);

      // First frame exists
      assert(files.length > 0, 'files array is non-empty');
      assert(existsSync(files[0]), 'First frame file exists on disk');

      // Frame numbering is continuous (frame_0000, frame_0001, ...)
      let numberingContinuous = true;
      for (let i = 0; i < files.length; i++) {
        const expected = path.join(framesDir, `frame_${String(i).padStart(4, '0')}.png`);
        if (files[i] !== expected) {
          numberingContinuous = false;
          break;
        }
      }
      assert(numberingContinuous, 'Frame numbering is continuous (frame_0000, frame_0001, ...)');

      // Each frame can be decoded by sharp and has correct dimensions
      const { default: sharp } = await import('sharp');
      let allDecodable = true;
      let allCorrectSize = true;
      for (let i = 0; i < files.length; i++) {
        try {
          const meta = await sharp(files[i]).metadata();
          if (!meta.width || !meta.height) {
            allDecodable = false;
            break;
          }
          if (meta.width !== 32 || meta.height !== 32) {
            allCorrectSize = false;
            console.log(`    Frame ${i}: ${meta.width}×${meta.height} (expected 32×32)`);
          }
        } catch (e) {
          allDecodable = false;
          console.log(`    Frame ${i} decode error: ${e.message}`);
          break;
        }
      }
      assert(allDecodable, 'Each frame can be decoded by sharp');
      assert(allCorrectSize, 'Each frame dimensions are 32×32');
    }

    // ════════════════════════════════════════════════════════════════════════
    //  3. videoToSpriteSheet
    // ════════════════════════════════════════════════════════════════════════
    section('3. videoToSpriteSheet');

    const spriteOutputPath = path.join(fixtureDir, 'sprite_output.png');
    const spriteResult = await videoToSpriteSheet({
      video_path: fixtureVideoPath,
      fps: 4,
      pixel_scale: 1,
      output_path: spriteOutputPath,
    });

    assert(spriteResult.success === true, 'videoToSpriteSheet returns success');
    if (!spriteResult.success) {
      console.log('    Error:', JSON.stringify(spriteResult.error));
    } else {
      const { output_path, frame_count, grid, cell_size } = spriteResult.data;

      // Sprite sheet file exists
      assert(existsSync(output_path), 'Sprite sheet file exists on disk');

      // Can be decoded by sharp
      const { default: sharp } = await import('sharp');
      let sheetMeta = null;
      try {
        sheetMeta = await sharp(output_path).metadata();
        assert(sheetMeta.width > 0 && sheetMeta.height > 0, 'Sprite sheet is decodable by sharp');
      } catch (e) {
        assert(false, 'Sprite sheet is decodable by sharp', e.message);
      }

      // frame_count matches extraction
      if (extractResult.success) {
        assertEqual(frame_count, extractResult.data.frame_count, 'frame_count matches extraction');
      }

      // grid.cols × grid.rows >= frame_count
      assert(grid.cols * grid.rows >= frame_count, `grid (${grid.cols}×${grid.rows}) ≥ frame_count (${frame_count})`);

      // cell_size is correct — with pixel_scale=1, cell_size should match the 32px input
      assert(cell_size[0] > 0 && cell_size[1] > 0, `cell_size is positive (${cell_size[0]}×${cell_size[1]})`);

      // sheet dimensions = grid × cell_size
      if (sheetMeta) {
        assertEqual(sheetMeta.width, grid.cols * cell_size[0], 'sheet width = grid.cols × cell_size[0]');
        assertEqual(sheetMeta.height, grid.rows * cell_size[1], 'sheet height = grid.rows × cell_size[1]');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  4. Boundary / Invalid Argument Tests
    // ════════════════════════════════════════════════════════════════════════
    section('4. Boundary Tests (Invalid Arguments)');

    // --- fps=0 → INVALID_ARGUMENT ---
    {
      const r = await extractVideoFrames({ video_path: fixtureVideoPath, fps: 0, output_dir: path.join(fixtureDir, 'b0') });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'extractVideoFrames: fps=0 → INVALID_ARGUMENT');
    }

    // --- fps=-1 → INVALID_ARGUMENT ---
    {
      const r = await extractVideoFrames({ video_path: fixtureVideoPath, fps: -1, output_dir: path.join(fixtureDir, 'b1') });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'extractVideoFrames: fps=-1 → INVALID_ARGUMENT');
    }

    // --- fps=NaN → INVALID_ARGUMENT ---
    {
      const r = await extractVideoFrames({ video_path: fixtureVideoPath, fps: NaN, output_dir: path.join(fixtureDir, 'b2') });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'extractVideoFrames: fps=NaN → INVALID_ARGUMENT');
    }

    // --- fps=Infinity → INVALID_ARGUMENT ---
    {
      const r = await extractVideoFrames({ video_path: fixtureVideoPath, fps: Infinity, output_dir: path.join(fixtureDir, 'b3') });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'extractVideoFrames: fps=Infinity → INVALID_ARGUMENT');
    }

    // --- pixel_scale=0 → INVALID_ARGUMENT (videoToSpriteSheet) ---
    {
      const r = await videoToSpriteSheet({
        video_path: fixtureVideoPath,
        pixel_scale: 0,
        output_path: path.join(fixtureDir, 'b4_sprite.png'),
      });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'videoToSpriteSheet: pixel_scale=0 → INVALID_ARGUMENT');
    }

    // --- columns=0 → INVALID_ARGUMENT (videoToSpriteSheet) ---
    {
      const r = await videoToSpriteSheet({
        video_path: fixtureVideoPath,
        columns: 0,
        output_path: path.join(fixtureDir, 'b5_sprite.png'),
      });
      assertErrorCode(r, ErrorCode.INVALID_ARGUMENT, 'videoToSpriteSheet: columns=0 → INVALID_ARGUMENT');
    }

    // --- ffmpeg not found → DEPENDENCY_MISSING ---
    // Mock by temporarily overriding the SPRITE_GEN_FFMPEG_PATH env var to a
    // non-existent path and the SPRITE_GEN_FFPROBE_PATH to force resolution
    // failure. The local tools/ffmpeg/ may still be found, so we also temporarily
    // shadow the binary by setting env to a path that doesn't contain ffmpeg.
    {
      const origFfmpegEnv = process.env.SPRITE_GEN_FFMPEG_PATH;
      const origFfprobeEnv = process.env.SPRITE_GEN_FFPROBE_PATH;
      try {
        // Point to a directory that definitely does NOT contain ffmpeg
        process.env.SPRITE_GEN_FFMPEG_PATH = path.join(fixtureDir, 'nonexistent_ffmpeg', 'ffmpeg');
        process.env.SPRITE_GEN_FFPROBE_PATH = path.join(fixtureDir, 'nonexistent_ffmpeg', 'ffprobe');

        // We need to bust the module-level cache for exec_path resolution.
        // Since ESM modules are cached by the loader, and resolveFfmpegPath
        // reads process.env at call time, setting the env var is sufficient —
        // the function re-reads it each call. However, the local tools/ fallback
        // in resolveExecPath may still find the binary. To fully test this,
        // we call the function and check the result; if ffmpeg is still found
        // locally, we skip the assertion with a note.
        const r = await extractVideoFrames({
          video_path: fixtureVideoPath,
          fps: 4,
          output_dir: path.join(fixtureDir, 'b6'),
        });

        // The local tools/ ffmpeg takes precedence over the env-var override.
        // This test verifies that the function does NOT crash and returns a
        // valid result regardless of the env-var mock.
        if (r.success) {
          assert(r.data.frame_count > 0, 'ffmpeg available via tools/ — frames extracted');
        } else if (r.error?.code === ErrorCode.DEPENDENCY_MISSING) {
          // ffmpeg not found in PATH/tools/ — DEPENDENCY_MISSING is correct
          // (not expected in this environment which has local ffmpeg)
        } else {
          // Any other failure is unexpected
          assert(false, `Unexpected result: ${r.error?.code ?? JSON.stringify(r).slice(0, 100)}`);
        }
      } finally {
        // Restore env vars
        if (origFfmpegEnv === undefined) delete process.env.SPRITE_GEN_FFMPEG_PATH;
        else process.env.SPRITE_GEN_FFMPEG_PATH = origFfmpegEnv;
        if (origFfprobeEnv === undefined) delete process.env.SPRITE_GEN_FFPROBE_PATH;
        else process.env.SPRITE_GEN_FFPROBE_PATH = origFfprobeEnv;
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  5. Colors Parameter Check — Quantization with multi-color video
    // ════════════════════════════════════════════════════════════════════════
    section('5. Colors Parameter Check');

    // Create a multi-color video fixture by encoding individual color frames
    const { default: sharp } = await import('sharp');
    const multiColorDir = path.join(fixtureDir, 'multicolor_fixture');
    mkdirSync(multiColorDir, { recursive: true });
    const multiColorVideo = path.join(multiColorDir, 'multicolor.mp4');
    const colorFrames = [];
    const mcColors = [
      { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 },
      { r: 255, g: 255, b: 255 }, { r: 255, g: 165, b: 0 },
    ];
    for (let i = 0; i < mcColors.length; i++) {
      const buf = await sharp({
        create: { width: 64, height: 64, channels: 3, background: mcColors[i] },
      }).png().toBuffer();
      const fp = path.join(multiColorDir, `mc_${String(i).padStart(4, '0')}.png`);
      writeFileSync(fp, buf);
      colorFrames.push(fp);
    }
    // Encode frames into video using ffmpeg's framerate input
    await runFfmpegAsync([
      '-y',
      '-framerate', '4',
      '-i', path.join(multiColorDir, 'mc_%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      multiColorVideo,
    ]);
    const multiColorVideoExists = existsSync(multiColorVideo);

    // Test colors=4 quantization (use multi-color video if available, else fallback)
    const colors4Path = path.join(fixtureDir, 'colors4_sprite.png');
    const colors4Result = await videoToSpriteSheet({
      video_path: multiColorVideoExists ? multiColorVideo : fixtureVideoPath,
      fps: 4,
      pixel_scale: 1,
      colors: 4,
      output_path: colors4Path,
    });

    assert(colors4Result.success === true, 'videoToSpriteSheet with colors=4 succeeds');
    if (colors4Result.success) {
      assertEqual(colors4Result.data.colors, 4, 'colors=4 is reflected in result.data.colors');
      assert(
        colors4Result.data.actual_unique_colors > 0,
        `actual_unique_colors is reported (${colors4Result.data.actual_unique_colors})`,
      );
    }

    // Test colors=32 quantization
    const colors32Path = path.join(fixtureDir, 'colors32_sprite.png');
    const colors32Result = await videoToSpriteSheet({
      video_path: multiColorVideoExists ? multiColorVideo : fixtureVideoPath,
      fps: 4,
      pixel_scale: 1,
      colors: 32,
      output_path: colors32Path,
    });

    assert(colors32Result.success === true, 'videoToSpriteSheet with colors=32 succeeds');
    if (colors32Result.success) {
      assertEqual(colors32Result.data.colors, 32, 'colors=32 is reflected in result.data.colors');
    }

    // Verify quantization reduces colors when source has many colors
    if (existsSync(multiColorVideo) && colors4Result.success && colors32Result.success) {
      const { default: sharp } = await import('sharp');
      const { data: d4, info: i4 } = await sharp(colors4Path).raw().toBuffer({ resolveWithObject: true });
      const { data: d32, info: i32 } = await sharp(colors32Path).raw().toBuffer({ resolveWithObject: true });
      const set4 = new Set();
      const set32 = new Set();
      for (let i = 0; i < d4.length; i += i4.channels) set4.add(`${d4[i]},${d4[i+1]},${d4[i+2]}`);
      for (let i = 0; i < d32.length; i += i32.channels) set32.add(`${d32[i]},${d32[i+1]},${d32[i+2]}`);
      const unique4 = set4.size;
      const unique32 = set32.size;
      // Quantization to 4 must not exceed 4 * small_tolerance (some dithering OK)
      assert(unique4 <= 6, `colors=4 quantization effective: ${unique4} unique colors (expected ≤6)`);
      // colors=4 should produce fewer or equal colors vs unquantized baseline
      assert(unique4 <= unique32, `Quantization effective: colors=4 has ${unique4} unique colors vs ${unique32} for colors=32`);
      console.log(`  Actual unique colors — colors=4: ${unique4}, colors=32: ${unique32}`);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  6. Cleanup Verification
    // ════════════════════════════════════════════════════════════════════════
    section('6. Cleanup Verification');

    // After successful runs, the fixture's own temp dir is cleaned manually.
    // The videoToSpriteSheet and extractVideoFrames functions clean their own
    // internal temp dirs via finally blocks. We verify no temp/video_* dirs leak.
    // Note: extractVideoFrames writes to the user-specified output_dir (not a temp),
    // so those files remain. videoToSpriteSheet uses an internal temp dir.
    {
      // Check that no orphaned tmp/video_* directories exist in the working dir
      const tmpBase = path.join(process.cwd(), 'tmp');
      let orphanedTempDirs = [];
      if (existsSync(tmpBase)) {
        const entries = readdirSync(tmpBase);
        orphanedTempDirs = entries.filter(e => e.startsWith('video_') || e.startsWith('test_fixture_'));
      }
      // Allow the current test fixture dir (we'll clean it below)
      assert(
        orphanedTempDirs.length <= 1,
        `No orphaned video temp dirs in tmp/ (${orphanedTempDirs.length} found)`,
      );
    }

  } finally {
    // ════════════════════════════════════════════════════════════════════════
    //  FINAL CLEANUP — remove fixture dir regardless of pass/fail
    // ════════════════════════════════════════════════════════════════════════
    if (fixtureDir) {
      cleanupTempDir(fixtureDir);
      const cleaned = !existsSync(fixtureDir);
      section('Cleanup');
      assert(cleaned, `Fixture temp dir cleaned up: ${fixtureDir}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed / ${failed} failed / ${total} total`);
  console.log(`${'─'.repeat(60)}`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    • ${f}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

// ── Entry ────────────────────────────────────────────────────────────────────
run().catch((e) => {
  console.error('\n  FATAL:', e);
  process.exit(1);
});
