/**
 * Application services — the core business logic layer.
 *
 * This module is the public API for all sprite-gen operations.
 * It can be called directly from JavaScript without MCP.
 *
 * Dependency direction:
 *   services.js → generation/processing/export modules → providers, filesystem, process runner
 *   services.js does NOT import MCP SDK.
 */

import path from 'path';
import fs from 'fs';
import {
  loadConfig, saveConfig, getProviderConfig, listProviders, getConfigSummary, IMAGE_PROVIDERS
} from './config.js';
import { generateImage } from './image_gen.js';
import { saveGeneratedImage, runPythonScript } from './utils.js';
import { generateAnimationSequence, listAnimationSequences } from './animation_gen.js';
import { generateEffect, listEffects } from './effects_gen.js';
import { generateWeapon, listWeapons } from './weapon_gen.js';
import { batchGenerate, batchProcess } from './batch_gen.js';
import {
  generateParallaxBackground,
  regenerateParallaxLayer,
} from './background_gen.js';
import { createSession, appendEdit, getSession, listSessions } from './sessions.js';
import { exportGodotSpriteFrames, autoDetectAnimations } from './godot_export.js';
import { generateGifPreview, generateDirectionalGifs } from './gif_preview.js';
import { videoToSpriteSheet, extractVideoFrames } from './video_gen.js';
import { STYLE_PRESETS } from './prompts.js';
import { exportTexturePacker, exportAseprite, exportGodotScene } from './engine_export.js';
import { extractPalette, qcReport } from './analysis.js';
import { godotImportSheet, godotAddAnimation, godotWireAnimations, godotScanProject } from './godot_integration.js';
import { ok, err, ErrorCode, artifact } from './result.js';
import { validateOutputPath } from './path_safety.js';

// ─── Config service ─────────────────────────────────────────────────────────

export async function configService(args) {
  const config = loadConfig();
  switch (args.action) {
    case "list":
      return ok({
        defaultProvider: config.defaultProvider,
        providers: listProviders().map((p) => ({
          ...p,
          hasKey: !!config.credentials?.[p.id]?.apiKey,
        })),
        spriteSheet: config.spriteSheet || {},
      });
    case "get":
      return ok(config);
    case "get_default":
      return ok({
        defaultProvider: config.defaultProvider,
        ...(config.spriteSheet || {}),
      });
    case "set":
      if (args.config) {
        saveConfig({ ...config, ...args.config });
        return ok(getConfigSummary());
      }
      if (args.sprite_sheet) {
        saveConfig({ ...config, spriteSheet: { ...config.spriteSheet, ...args.sprite_sheet } });
        return ok(getConfigSummary());
      }
      if (args.default_provider) {
        if (!IMAGE_PROVIDERS[args.default_provider])
          return err(ErrorCode.INVALID_ARGUMENT, `Unknown provider: ${args.default_provider}`, { stage: 'validation' });
        saveConfig({ ...config, defaultProvider: args.default_provider });
        return ok(getConfigSummary());
      }
      return err(ErrorCode.INVALID_ARGUMENT, 'Missing provider or config', { stage: 'validation' });
    case "set_key": {
      if (!args.provider || !args.api_key)
        return err(ErrorCode.INVALID_ARGUMENT, 'Missing provider or api_key', { stage: 'validation' });
      if (!IMAGE_PROVIDERS[args.provider])
        return err(ErrorCode.INVALID_ARGUMENT, `Unknown provider: ${args.provider}`, { stage: 'validation' });
      const credentials = {
        ...(config.credentials || {}),
        [args.provider]: {
          apiKey: args.api_key,
          ...(args.base_url ? { baseUrl: args.base_url } : {}),
          ...(args.model ? { model: args.model } : {}),
        },
      };
      saveConfig({ ...config, credentials });
      return ok(getConfigSummary());
    }
    case "set_provider": {
      if (!args.provider || !IMAGE_PROVIDERS[args.provider])
        return err(ErrorCode.INVALID_ARGUMENT, `Invalid or unknown provider: ${args.provider}`, { stage: 'validation' });
      saveConfig({ ...config, defaultProvider: args.provider });
      return ok(getConfigSummary());
    }
    default:
      return err(ErrorCode.INVALID_ARGUMENT, `Unknown action: ${args.action}`, { stage: 'validation' });
  }
}

// ─── Sheet service ──────────────────────────────────────────────────────────

export async function sheetService(args) {
  try {
    const outPath = args.output_path ?? "./output/sprite_sheet.png";
    const pathErr = validateOutputPath(outPath, [args.image_path]);
    if (pathErr) return pathErr;
    const result = await runPythonScript({
      image_path: args.image_path,
      grid_cols: args.grid_cols ?? 4,
      grid_rows: args.grid_rows ?? 4,
      crop_mode: args.crop_mode ?? "auto",
      spacing: args.spacing ?? 0,
      cell_width: args.cell_width ?? 32,
      cell_height: args.cell_height ?? 32,
      output_path: args.output_path ?? "./output/sprite_sheet.png",
      padding: args.padding ?? 0,
    });
    return result;
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Generate image service ─────────────────────────────────────────────────

export async function generateImageService(args) {
  const configDir = path.join(process.cwd(), "config");
  const tmpImagePath = path.join(configDir, ".generated_tmp.png");
  try {
    const gen = await generateImage(args);
    if (!gen.success) return gen;
    const images = gen.data?.images || gen.images || [];
    if (images.length === 0)
      return err(ErrorCode.PROCESSING_FAILED, "No images generated", { stage: 'processing' });

    const outPath = args.output_path || "./output/generated.png";
    const pathErr = validateOutputPath(outPath, []);
    if (pathErr) return pathErr;
    fs.mkdirSync(configDir, { recursive: true });
    saveGeneratedImage(images[0].data, images[0].mimeType, tmpImagePath);

    const sheetResult = await runPythonScript({
      image_path: tmpImagePath,
      grid_cols: args.grid_cols ?? 4,
      grid_rows: args.grid_rows ?? 4,
      crop_mode: args.crop_mode ?? "auto",
      spacing: 0,
      cell_width: args.width ?? 1024,
      cell_height: args.height ?? 1024,
      output_path: outPath,
      padding: 0,
    });

    if (!sheetResult.success) return sheetResult;
    return ok({
      output_path: outPath,
      output_size: sheetResult.data?.output_size ?? sheetResult.output_size,
      grid_cols: sheetResult.data?.grid_cols ?? sheetResult.grid_cols,
      grid_rows: sheetResult.data?.grid_rows ?? sheetResult.grid_rows,
      crop_mode: sheetResult.data?.crop_mode ?? sheetResult.crop_mode,
    }, {
      artifacts: [artifact('image', path.resolve(outPath), { mime_type: 'image/png' })],
    });
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  } finally {
    try { if (fs.existsSync(tmpImagePath)) fs.unlinkSync(tmpImagePath); } catch (_) {}
  }
}

// ─── Info service ───────────────────────────────────────────────────────────

export async function infoService() {
  const config = loadConfig();
  return ok({
    name: "sprite-gen-mcp",
    version: "1.0.0",
    defaultProvider: config.defaultProvider,
    providers: listProviders(),
    configured: getConfigSummary().providers
      .filter((p) => p.configured)
      .map((p) => p.id),
  });
}

// ─── Cutout service ─────────────────────────────────────────────────────────

export async function cutoutService(args) {
  try {
    const outPath = args.output_path || "./output/cutout.png";
    const pathErr = validateOutputPath(outPath, [args.image_path]);
    if (pathErr) return pathErr;
    const result = await runPythonScript({
      command: "cutout",
      image_path: args.image_path,
      output_path: outPath,
      dist_threshold: args.dist_threshold ?? 60,
      corner_region: args.corner_region ?? 30,
      target_width: args.target_width ?? 512,
      target_height: args.target_height ?? 768,
    });
    return result;
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── GIF preview service ────────────────────────────────────────────────────

export async function gifPreviewService(args) {
  try {
    const result = await generateGifPreview(args);
    if (!result.success) return result;
    // generateGifPreview returns ok() with data nested, unwrap
    const data = result.data ?? result;
    return ok({
      gif_path: data.gif_path,
      frames: data.frames,
      fps: data.fps,
      message: `GIF saved: ${data.gif_path}`,
    }, {
      artifacts: [artifact('gif', data.gif_path, { mime_type: 'image/gif' })],
    });
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Godot export service ───────────────────────────────────────────────────

export async function godotExportService(args) {
  try {
    return await exportGodotSpriteFrames(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Detect animations service ──────────────────────────────────────────────

export async function detectAnimationsService(args) {
  try {
    return await autoDetectAnimations(args.image_path, args.cell_width);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Session services ───────────────────────────────────────────────────────

export async function sessionListService() {
  const result = listSessions();
  if (!result.success) return result;
  return ok({ sessions: result.data });
}

export async function editService(args) {
  const { session_id, instruction, output_path, provider } = args;
  const sessionResult = getSession(session_id);
  if (!sessionResult.success) return sessionResult;
  const session = sessionResult.data;
  if (!session) return err(ErrorCode.FILE_NOT_FOUND, `Session not found: ${session_id}`, { stage: 'validation' });

  const referencePath = session.output_path || session.history?.[session.history.length - 1]?.output_path;
  if (!referencePath) return err(ErrorCode.FILE_NOT_FOUND, "No previous output to edit", { stage: 'validation' });

  let imageData = null;
  try {
    imageData = fs.readFileSync(referencePath).toString('base64');
  } catch (_) {
    // File may not exist or be accessible; fall back to text prompt only
  }

  const editPrompt = `${instruction}. Use the reference image at ${referencePath} as the base. Maintain the same art style and character appearance.`;

  const genArgs = {
    provider: provider || session.provider || 'agnes',
    prompt: editPrompt,
    imageUrls: [referencePath],
    width: 1024,
    height: 1024,
  };

  const gen = await generateImage(genArgs);
  if (!gen.success) return gen;
  if (!gen.images || gen.images.length === 0) {
    return err(ErrorCode.PROCESSING_FAILED, 'No images generated', { stage: 'processing' });
  }

  const outPath = output_path || path.join(path.dirname(referencePath), `edited_${session_id}.png`);
  const absPath = saveGeneratedImage(gen.images[0].data, gen.images[0].mimeType, outPath);

  const updatedResult = appendEdit(session_id, { instruction, output_path: absPath });
  const updated = updatedResult.success ? updatedResult.data : null;
  return ok({
    session_id,
    step: updated?.history?.length ?? 1,
    output_path: absPath,
    instruction,
  }, {
    artifacts: [artifact('image', absPath, { mime_type: 'image/png' })],
  });
}

// ─── Autotile service ───────────────────────────────────────────────────────

export async function autotileService(args) {
  try {
    const outDir = args.output_dir || "./output/autotile";
    const pathErr = validateOutputPath(outDir + '/_', [args.image_path]);
    if (pathErr) return pathErr;
    return await runPythonScript({
      command: "autotile",
      image_path: args.image_path,
      tile_size: args.tile_size ?? [64, 64],
      output_dir: args.output_dir || "./output/autotile",
    });
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Video services ─────────────────────────────────────────────────────────

export async function videoToSheetService(args) {
  try {
    return await videoToSpriteSheet(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

export async function extractVideoFramesService(args) {
  try {
    return await extractVideoFrames(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Engine export services ─────────────────────────────────────────────────

export async function engineExportService(type, args) {
  try {
    if (type === "tpacker") return await exportTexturePacker(args);
    if (type === "aseprite") return await exportAseprite(args);
    if (type === "godot_scene") return await exportGodotScene(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Palette / QC services ──────────────────────────────────────────────────

export async function paletteExtractService(args) {
  try {
    return await extractPalette(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

export async function qcReportService(args) {
  try {
    return await qcReport(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Godot integration services ─────────────────────────────────────────────

export async function godotImportService(args) {
  try {
    return await godotImportSheet(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

export async function godotAddAnimationService(args) {
  try {
    return await godotAddAnimation(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

export async function godotWireAnimationsService(args) {
  try {
    return await godotWireAnimations(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

export async function godotScanService(args) {
  try {
    return await godotScanProject(args);
  } catch (e) {
    return err(ErrorCode.PROCESSING_FAILED, e.message, { stage: 'processing', cause: e.stack });
  }
}

// ─── Style list service ─────────────────────────────────────────────────────

export async function styleListService() {
  return ok(Object.entries(STYLE_PRESETS).map(([id, s]) => ({ id, name: s.name, description: s.description })));
}

// ─── Animation / Effect / Weapon list services ──────────────────────────────

export async function animationSequenceService(args) {
  return generateAnimationSequence(args);
}

export async function animationListService() {
  return ok(listAnimationSequences());
}

export async function effectGenerateService(args) {
  return generateEffect(args);
}

export async function effectListService() {
  return ok(listEffects());
}

export async function weaponGenerateService(args) {
  return generateWeapon(args);
}

export async function weaponListService() {
  return ok(listWeapons());
}

// ─── Batch services ─────────────────────────────────────────────────────────

export async function batchGenerateService(args) {
  return batchGenerate(args);
}

export async function batchProcessService(args) {
  return batchProcess(args);
}

// ─── Background services ────────────────────────────────────────────────────

export async function backgroundService(args) {
  if (args.regenerate_layer) return regenerateParallaxLayer(args);
  return generateParallaxBackground(args);
}
