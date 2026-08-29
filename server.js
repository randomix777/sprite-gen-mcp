/**
 * sprite-gen MCP Server
 * Standalone MCP server — no DeepSeek Harness required.
 *
 * Usage:
 *   node server.js
 *
 * Register with Hermes:
 *   hermes mcp add --command node --args server.js sprite-gen
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  loadConfig, saveConfig, getProviderConfig, listProviders, getConfigSummary, IMAGE_PROVIDERS
} from "./lib/config.js";
import { generateImage } from "./lib/image_gen.js";
import { saveGeneratedImage, runPythonScript } from "./lib/utils.js";
import { generateAnimationSequence, listAnimationSequences } from "./lib/animation_gen.js";
import { generateEffect, listEffects } from "./lib/effects_gen.js";
import { generateWeapon, listWeapons } from "./lib/weapon_gen.js";
import { batchGenerate, batchProcess } from "./lib/batch_gen.js";
import {
  generateParallaxBackground,
  regenerateParallaxLayer,
} from "./lib/background_gen.js";
import { createSession, appendEdit, getSession, listSessions } from "./lib/sessions.js";
import { exportGodotSpriteFrames, autoDetectAnimations } from "./lib/godot_export.js";
import { generateGifPreview, generateDirectionalGifs } from "./lib/gif_preview.js";
import { videoToSpriteSheet, extractVideoFrames } from "./lib/video_gen.js";
import { STYLE_PRESETS } from "./lib/prompts.js";
import { exportTexturePacker, exportAseprite, exportGodotScene } from "./lib/engine_export.js";
import { extractPalette, qcReport } from "./lib/analysis.js";
import { godotImportSheet, godotAddAnimation, godotWireAnimations, godotScanProject } from "./lib/godot_integration.js";

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "lib", "process_sprites.py");

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  // ── Config ───────────────────────────────────────────────────────────────
  {
    name: "sprite__config",
    description:
      "Manage sprite plugin configuration: view providers, set API keys, configure defaults.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "set", "set_key", "set_provider", "get_default"],
          description: "Configuration action",
        },
        provider: { type: "string", description: "Provider ID (for set/set_key/set_provider actions)" },
        api_key: { type: "string", description: "API key (for set/set_key actions)" },
        base_url: { type: "string", description: "Custom base URL" },
        model: { type: "string", description: "Custom model" },
        default_provider: { type: "string", description: "Default provider ID" },
        sprite_sheet: { type: "object", description: "Sprite sheet defaults" },
        config: { type: "object", description: "Full configuration object" },
      },
      required: ["action"],
    },
  },
  // ── Sprite sheet ─────────────────────────────────────────────────────────
  {
    name: "sprite__sheet",
    description:
      "Generate a Game-engine-compatible sprite sheet from an image. Supports auto-crop, grid arrangement, and transparent edge removal.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input image path" },
        grid_cols: { type: "integer", default: 4 },
        grid_rows: { type: "integer", default: 4 },
        crop_mode: { type: "string", enum: ["auto", "fixed", "none"], default: "auto" },
        spacing: { type: "integer", default: 0 },
        cell_width: { type: "integer", default: 32 },
        cell_height: { type: "integer", default: 32 },
        output_path: { type: "string", default: "./output/sprite_sheet.png" },
        padding: { type: "integer", default: 0 },
      },
      required: ["image_path"],
    },
  },
  // ── Image generation + sheet ─────────────────────────────────────────────
  {
    name: "sprite_generate_image",
    description:
      "Generate an AI image and convert it to a sprite sheet. Supports multiple providers (gemini_flash, stable_diffusion, agnes, comfy).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        provider: { type: "string", default: "gemini_flash" },
        negative_prompt: { type: "string", default: "" },
        width: { type: "integer", default: 1024 },
        height: { type: "integer", default: 1024 },
        num_images: { type: "integer", default: 1 },
        grid_cols: { type: "integer", default: 4 },
        grid_rows: { type: "integer", default: 4 },
        crop_mode: { type: "string", enum: ["auto", "fixed", "none"], default: "auto" },
        output_path: { type: "string", default: "./output/generated.png" },
        style: { type: "string", enum: Object.keys(STYLE_PRESETS).join(",").split(","), description: "Art style preset (see sprite_style_list)" },
      },
      required: ["prompt"],
    },
  },
  // ── Info ─────────────────────────────────────────────────────────────────
  {
    name: "sprite__info",
    description:
      "View information about the sprite plugin, including supported providers and current configuration.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Cutout ───────────────────────────────────────────────────────────────
  {
    name: "sprite_cutout",
    description:
      "Apply background cutout with distance-threshold transparency, bbox crop, scale to target size, and validation.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input image path" },
        output_path: { type: "string", default: "./output/cutout.png" },
        dist_threshold: { type: "integer", default: 60 },
        corner_region: { type: "integer", default: 30 },
        target_width: { type: "integer", default: 512 },
        target_height: { type: "integer", default: 768 },
      },
      required: ["image_path"],
    },
  },
  // ── Animation ────────────────────────────────────────────────────────────
  {
    name: "sprite_animation_sequence",
    description:
      "Generate a multi-frame animation sequence (walk, jump, attack, idle, etc.) from a reference character image using AI.",
    inputSchema: {
      type: "object",
      properties: {
        sequence: { type: "string", description: "Animation type key (see sprite_animation_list)" },
        reference_image_path: { type: "string", description: "Path to reference character image" },
        provider: { type: "string", description: "AI provider (default: config default)" },
        output_path: { type: "string", description: "Output path" },
      },
      required: ["sequence", "reference_image_path"],
    },
  },
  {
    name: "sprite_animation_list",
    description: "List all available animation sequence types.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Effects ──────────────────────────────────────────────────────────────
  {
    name: "sprite_generate_effect",
    description: "Generate a pixel art sprite effect (bullet, fire, explosion, smoke, spark).",
    inputSchema: {
      type: "object",
      properties: {
        effect: { type: "string", description: "Effect type key (see sprite_effect_list)" },
        provider: { type: "string" },
        output_path: { type: "string", default: "./output/effects/<effect>.png" },
        width: { type: "integer", default: 64 },
        height: { type: "integer", default: 64 },
      },
      required: ["effect"],
    },
  },
  {
    name: "sprite_effect_list",
    description: "List all available effect types.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Weapons ──────────────────────────────────────────────────────────────
  {
    name: "sprite_generate_weapon",
    description: "Generate a pixel art weapon or equipment sprite.",
    inputSchema: {
      type: "object",
      properties: {
        weapon: { type: "string", description: "Weapon type key (see sprite_weapon_list)" },
        provider: { type: "string" },
        output_path: { type: "string", default: "./output/weapons/<weapon>.png" },
        width: { type: "integer", default: 128 },
        height: { type: "integer", default: 128 },
      },
      required: ["weapon"],
    },
  },
  {
    name: "sprite_weapon_list",
    description: "List all available weapon/equipment types.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Batch ────────────────────────────────────────────────────────────────
  {
    name: "sprite_batch_generate",
    description: "Generate multiple AI sprites in batch (one API call per item).",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of {prompt, output_path, width?, height?}",
          items: { type: "object" },
        },
        provider: { type: "string" },
      },
      required: ["items"],
    },
  },
  {
    name: "sprite_batch_process",
    description: "Process multiple existing images through sprite sheet pipeline (crop/grid).",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of {image_path, output_path, grid_cols?, grid_rows?, crop_mode?}",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  // ── Background ───────────────────────────────────────────────────────────
  {
    name: "sprite_generate_background",
    description:
      "Generate a 3-layer parallax background (sky/midground/foreground) for side-scroller games.",
    inputSchema: {
      type: "object",
      properties: {
        character_prompt: { type: "string", description: "Description of character/world" },
        character_image_url: { type: "string", description: "URL of character image" },
        layer1_url: { type: "string", description: "Existing layer 1 URL (for regeneration)" },
        layer2_url: { type: "string", description: "Existing layer 2 URL" },
        regenerate_layer: { type: "integer", description: "Regenerate only layer 1/2/3" },
        provider: { type: "string" },
      },
      required: ["character_prompt", "character_image_url"],
    },
  },
  // ── GIF Preview ───────────────────────────────────────────────────────────
  {
    name: "sprite_preview_gif",
    description: "Generate an animated GIF preview from a sprite sheet. Useful for visual QC before importing to engine.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input sprite sheet path" },
        cell_width: { type: "integer", description: "Single frame width in pixels" },
        cell_height: { type: "integer", description: "Single frame height (defaults to cell_width)" },
        fps: { type: "integer", default: 8 },
        output_path: { type: "string", description: "Output GIF path" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  // ── Godot Export ───────────────────────────────────────────────────────────
  {
    name: "sprite_export_godot",
    description: "Export a sprite sheet to Godot 4 SpriteFrames .tres format. Returns both .tres and .json metadata.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input sprite sheet path" },
        cell_width: { type: "integer", description: "Single frame width in pixels" },
        cell_height: { type: "integer", description: "Single frame height" },
        output_path: { type: "string", description: "Output .tres file path" },
        animations: {
          type: "object",
          description: "Named animation definitions, e.g. { idle: { start: 0, end: 3, fps: 8 } }",
        },
      },
      required: ["image_path", "cell_width", "output_path"],
    },
  },
  {
    name: "sprite_detect_animations",
    description: "Auto-detect grid layout and suggest animation ranges from a sprite sheet.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input sprite sheet path" },
        cell_width: { type: "integer", description: "Expected frame width" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  // ── Session / Edit ─────────────────────────────────────────────────────────
  {
    name: "sprite_session_list",
    description: "List all sprite generation sessions with history.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sprite_edit",
    description: "Iteratively edit a previously generated sprite using natural language instructions. References the session by ID.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from sprite_session_list" },
        instruction: { type: "string", description: "Edit instruction, e.g. 'make the colors darker' or 'change to walk cycle'" },
        output_path: { type: "string", description: "Optional output path for the edited version" },
        provider: { type: "string", description: "Override provider" },
      },
      required: ["session_id", "instruction"],
    },
  },
  // ── Autotile ────────────────────────────────────────────────────────────────
  {
    name: "sprite_autotile",
    description: "Generate 16 autotile variants from a single tile image for seamless tilemap use. Each variant represents a different edge configuration (no neighbor, top-only, corner, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string", description: "Input single tile image path" },
        tile_size: { type: "array", items: { type: "integer" }, default: [64, 64], description: "[width, height] of the tile" },
        output_dir: { type: "string", description: "Output directory for variants" },
      },
      required: ["image_path"],
    },
  },
  // ── Video → Sprite ──────────────────────────────────────────────────────────
  {
    name: "sprite_video_to_sheet",
    description: "Convert a video clip into a pixel-art sprite sheet. Extracts frames, downscales to pixel-art resolution, and assembles into a grid.",
    inputSchema: {
      type: "object",
      properties: {
        video_path: { type: "string", description: "Input video file path" },
        fps: { type: "integer", default: 8, description: "Frame extraction rate" },
        pixel_scale: { type: "integer", default: 4, description: "Downscale factor (4 = 1/4 size)" },
        colors: { type: "integer", default: 32, description: "Target color count" },
        columns: { type: "integer", description: "Frames per row (auto if omitted)" },
        output_path: { type: "string", description: "Output sprite sheet PNG" },
      },
      required: ["video_path"],
    },
  },
  {
    name: "sprite_extract_video_frames",
    description: "Extract individual frames from a video as separate PNG files.",
    inputSchema: {
      type: "object",
      properties: {
        video_path: { type: "string", description: "Input video file path" },
        fps: { type: "integer", default: 8 },
        output_dir: { type: "string", description: "Output directory for frames" },
      },
      required: ["video_path"],
    },
  },
  // ── Style Presets ───────────────────────────────────────────────────────────
  {
    name: "sprite_style_list",
    description: "List all available art style presets with descriptions.",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Engine Export ───────────────────────────────────────────────────────────
  {
    name: "sprite_export_tpacker",
    description: "Export sprite sheet to TexturePacker JSON format (Unity/Godot compatible).",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string" },
        cell_width: { type: "integer" },
        cell_height: { type: "integer" },
        output_path: { type: "string" },
        prefix: { type: "string", default: "frame" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  {
    name: "sprite_export_aseprite",
    description: "Export sprite sheet to Aseprite JSON format.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string" },
        cell_width: { type: "integer" },
        cell_height: { type: "integer" },
        fps: { type: "integer", default: 8 },
        output_path: { type: "string" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  {
    name: "sprite_export_godot_scene",
    description: "Generate a minimal Godot 4 .tscn scene file with a Sprite2D node wired to the sprite sheet.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string" },
        cell_width: { type: "integer" },
        cell_height: { type: "integer" },
        node_name: { type: "string", default: "Character" },
        position: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } } },
        animations: { type: "object" },
        output_path: { type: "string" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  // ── Analysis ────────────────────────────────────────────────────────────────
  {
    name: "sprite_palette_extract",
    description: "Extract a color palette from a sprite sheet or image. Returns top-N dominant colors as hex values.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string" },
        colors: { type: "integer", default: 16 },
        output_path: { type: "string", description: "Optional: write palette as hex colors, one per line" },
      },
      required: ["image_path"],
    },
  },
  {
    name: "sprite_qc_report",
    description: "Run quality control on a sprite sheet: detect edge-touch frames, empty frames, transparency ratios, and color diversity per frame.",
    inputSchema: {
      type: "object",
      properties: {
        image_path: { type: "string" },
        cell_width: { type: "integer" },
        cell_height: { type: "integer" },
      },
      required: ["image_path", "cell_width"],
    },
  },
  // ── Godot Integration ───────────────────────────────────────────────────────
  {
    name: "sprite_godot_import",
    description: "Import a sprite sheet into a Godot 4 project: creates .tres SpriteFrames resource, .import texture file, and optionally wires it into a scene.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project root (contains project.godot)" },
        image_path: { type: "string", description: "Sprite sheet PNG path" },
        cell_width: { type: "integer", description: "Single frame width" },
        cell_height: { type: "integer", description: "Single frame height" },
        node_path: { type: "string", description: "Existing node path to update (e.g. /root/Player/Sprite2D)" },
        scene_path: { type: "string", description: "Scene to create/update (relative to project root)" },
        animations: { type: "object", description: "Animation definitions { idle: {start, end, fps} }" },
      },
      required: ["project_path", "image_path", "cell_width"],
    },
  },
  {
    name: "sprite_godot_add_animation",
    description: "Add or update an animation on an existing SpriteFrames .tres resource.",
    inputSchema: {
      type: "object",
      properties: {
        tre_path: { type: "string", description: "Path to the .tres SpriteFrames resource" },
        animation_name: { type: "string", description: "Animation name (e.g. 'walk')" },
        frame_start: { type: "integer", default: 0 },
        frame_end: { type: "integer", default: 3 },
        fps: { type: "integer", default: 8 },
        loop: { type: "boolean", default: true },
      },
      required: ["tre_path", "animation_name"],
    },
  },
  {
    name: "sprite_godot_wire_animations",
    description: "Wire animation sequences into a scene's AnimationPlayer. Creates the AnimationPlayer if missing, sets up tracks for each animation.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string" },
        scene_path: { type: "string", description: "Relative to project root" },
        node_path: { type: "string", description: "Sprite2D node path (e.g. /root/Player/Sprite2D)" },
        animations: { type: "object", description: "{ idle: {start, end, fps}, walk: {...} }" },
        default_animation: { type: "string", description: "Which animation plays on ready" },
      },
      required: ["project_path", "scene_path", "node_path", "animations"],
    },
  },
  {
    name: "sprite_godot_scan",
    description: "Scan a Godot project: list all scenes, SpriteFrames resources, and Sprite2D/AnimatedSprite2D nodes.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to Godot project root" },
      },
      required: ["project_path"],
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleConfig(args) {
  const config = loadConfig();
  switch (args.action) {
    case "list":
      return {
        success: true,
        data: {
          defaultProvider: config.defaultProvider,
          providers: listProviders().map((p) => ({
            ...p,
            hasKey: !!config.credentials?.[p.id]?.apiKey,
          })),
          spriteSheet: config.spriteSheet || {},
        },
      };
    case "get":
      return { success: true, data: config };
    case "get_default":
      return {
        success: true,
        data: {
          defaultProvider: config.defaultProvider,
          ...(config.spriteSheet || {}),
        },
      };
    case "set":
      if (args.config) {
        saveConfig({ ...config, ...args.config });
        return { success: true, data: getConfigSummary() };
      }
      if (args.sprite_sheet) {
        saveConfig({ ...config, spriteSheet: { ...config.spriteSheet, ...args.sprite_sheet } });
        return { success: true, data: getConfigSummary() };
      }
      if (args.default_provider) {
        if (!IMAGE_PROVIDERS[args.default_provider])
          return { error: `Unknown provider: ${args.default_provider}` };
        saveConfig({ ...config, defaultProvider: args.default_provider });
        return { success: true, data: getConfigSummary() };
      }
      return { error: "Missing provider or config" };
    case "set_key": {
      if (!args.provider || !args.api_key)
        return { error: "Missing provider or api_key" };
      if (!IMAGE_PROVIDERS[args.provider])
        return { error: `Unknown provider: ${args.provider}` };
      const credentials = {
        ...(config.credentials || {}),
        [args.provider]: {
          apiKey: args.api_key,
          ...(args.base_url ? { baseUrl: args.base_url } : {}),
          ...(args.model ? { model: args.model } : {}),
        },
      };
      saveConfig({ ...config, credentials });
      return { success: true, data: getConfigSummary() };
    }
    case "set_provider": {
      if (!args.provider || !IMAGE_PROVIDERS[args.provider])
        return { error: `Invalid or unknown provider: ${args.provider}` };
      saveConfig({ ...config, defaultProvider: args.provider });
      return { success: true, data: getConfigSummary() };
    }
    default:
      return { error: `Unknown action: ${args.action}` };
  }
}

async function handleSheet(args) {
  try {
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
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGenerateImage(args) {
  try {
    const gen = await generateImage(args);
    if (!gen.success) return { success: false, ...gen };
    if (!gen.images || gen.images.length === 0)
      return { success: false, error: "No images generated" };

    const outPath = args.output_path || "./output/generated.png";
    const configDir = path.join(__dirname, "config");
    fs.mkdirSync(configDir, { recursive: true });
    const tmpImagePath = path.join(configDir, ".generated_tmp.png");
    saveGeneratedImage(gen.images[0].data, gen.images[0].mimeType, tmpImagePath);

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
    return {
      success: true,
      output_path: outPath,
      output_size: sheetResult.output_size,
      grid_cols: sheetResult.grid_cols,
      grid_rows: sheetResult.grid_rows,
      crop_mode: sheetResult.crop_mode,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleInfo() {
  const config = loadConfig();
  return {
    success: true,
    data: {
      name: "sprite-gen-mcp",
      version: "1.0.0",
      defaultProvider: config.defaultProvider,
      providers: listProviders(),
      configured: getConfigSummary().providers
        .filter((p) => p.configured)
        .map((p) => p.id),
    },
  };
}

async function handleCutout(args) {
  try {
    const result = await runPythonScript({
      command: "cutout",
      image_path: args.image_path,
      output_path: args.output_path || "./output/cutout.png",
      dist_threshold: args.dist_threshold ?? 60,
      corner_region: args.corner_region ?? 30,
      target_width: args.target_width ?? 512,
      target_height: args.target_height ?? 768,
    });
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGifPreview(args) {
  try {
    const result = await generateGifPreview(args);
    if (!result.success) return result;
    return {
      success: true,
      gif_path: result.gif_path,
      frames: result.frames,
      fps: result.fps,
      message: `GIF saved: ${result.gif_path}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGodotExport(args) {
  try {
    const result = await exportGodotSpriteFrames(args);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleDetectAnimations(args) {
  try {
    const result = await autoDetectAnimations(args.image_path, args.cell_width);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSessionList() {
  return { success: true, sessions: listSessions() };
}

async function handleEdit(args) {
  const { session_id, instruction, output_path, provider } = args;
  const session = getSession(session_id);
  if (!session) return { success: false, error: `Session not found: ${session_id}` };

  const referencePath = session.output_path || session.history?.[session.history.length - 1]?.output_path;
  if (!referencePath) return { success: false, error: "No previous output to edit" };

  // Read the reference image as base64 for the edit prompt
  const fs = (await import('fs')).default;
  const path = (await import('path')).default;
  let imageData = null;
  try {
    imageData = fs.readFileSync(referencePath).toString('base64');
  } catch (_) {
    // File may not exist or be accessible; fall back to text prompt only
  }

  // Generate edited version using the image gen with image_urls reference
  const editPrompt = `${instruction}. Use the reference image at ${referencePath} as the base. Maintain the same art style and character appearance.`;

  const genArgs = {
    provider: provider || session.provider || 'agnes',
    prompt: editPrompt,
    imageUrls: [referencePath],
    width: 1024,
    height: 1024,
  };

  const gen = await (await import('./lib/image_gen.js')).generateImage(genArgs);
  if (!gen.success) return gen;
  if (!gen.images || gen.images.length === 0) {
    return { success: false, error: 'No images generated' };
  }

  const outPath = output_path || path.join(path.dirname(referencePath), `edited_${session_id}.png`);
  const { saveGeneratedImage } = await import('./lib/utils.js');
  const absPath = saveGeneratedImage(gen.images[0].data, gen.images[0].mimeType, outPath);

  const updated = appendEdit(session_id, { instruction, output_path: absPath });
  return {
    success: true,
    session_id,
    step: updated?.history?.length ?? 1,
    output_path: absPath,
    instruction,
  };
}

async function handleToolCall(name, args) {
  switch (name) {
    case "sprite__config":
      return handleConfig(args);
    case "sprite__sheet":
      return handleSheet(args);
    case "sprite_generate_image":
      return handleGenerateImage(args);
    case "sprite__info":
      return handleInfo();
    case "sprite_cutout":
      return handleCutout(args);
    case "sprite_animation_sequence":
      return generateAnimationSequence(args);
    case "sprite_animation_list":
      return { success: true, data: listAnimationSequences() };
    case "sprite_generate_effect":
      return generateEffect(args);
    case "sprite_effect_list":
      return { success: true, data: listEffects() };
    case "sprite_generate_weapon":
      return generateWeapon(args);
    case "sprite_weapon_list":
      return { success: true, data: listWeapons() };
    case "sprite_batch_generate":
      return batchGenerate(args);
    case "sprite_batch_process":
      return batchProcess(args);
    case "sprite_generate_background":
      if (args.regenerate_layer) return regenerateParallaxLayer(args);
      return generateParallaxBackground(args);
    case "sprite_preview_gif":
      return handleGifPreview(args);
    case "sprite_export_godot":
      return handleGodotExport(args);
    case "sprite_detect_animations":
      return handleDetectAnimations(args);
    case "sprite_session_list":
      return handleSessionList();
    case "sprite_edit":
      return handleEdit(args);
    case "sprite_autotile":
      return handleAutotile(args);
    case "sprite_video_to_sheet":
      return handleVideoToSheet(args);
    case "sprite_extract_video_frames":
      return handleExtractVideoFrames(args);
    case "sprite_style_list":
      return { success: true, data: Object.entries(STYLE_PRESETS).map(([id, s]) => ({ id, name: s.name, description: s.description })) };
    case "sprite_export_tpacker":
      return (await handleEngineExport("tpacker", args));
    case "sprite_export_aseprite":
      return (await handleEngineExport("aseprite", args));
    case "sprite_export_godot_scene":
      return (await handleEngineExport("godot_scene", args));
    case "sprite_palette_extract":
      return handlePaletteExtract(args);
    case "sprite_qc_report":
      return handleQcReport(args);
    case "sprite_godot_import":
      return handleGodotImport(args);
    case "sprite_godot_add_animation":
      return handleGodotAddAnimation(args);
    case "sprite_godot_wire_animations":
      return handleGodotWireAnimations(args);
    case "sprite_godot_scan":
      return handleGodotScan(args);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

async function handleAutotile(args) {
  try {
    const result = await runPythonScript({
      command: "autotile",
      image_path: args.image_path,
      tile_size: args.tile_size ?? [64, 64],
      output_dir: args.output_dir || "./output/autotile",
    });
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleVideoToSheet(args) {
  try {
    const result = await videoToSpriteSheet(args);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleExtractVideoFrames(args) {
  try {
    const result = await extractVideoFrames(args);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleEngineExport(type, args) {
  try {
    let result;
    if (type === "tpacker") result = await exportTexturePacker(args);
    else if (type === "aseprite") result = await exportAseprite(args);
    else if (type === "godot_scene") result = await exportGodotScene(args);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handlePaletteExtract(args) {
  try {
    return await extractPalette(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleQcReport(args) {
  try {
    return await qcReport(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGodotImport(args) {
  try {
    return await godotImportSheet(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGodotAddAnimation(args) {
  try {
    return await godotAddAnimation(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGodotWireAnimations(args) {
  try {
    return await godotWireAnimations(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGodotScan(args) {
  try {
    return await godotScanProject(args);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── MCP server setup ────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "sprite-gen-mcp",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await handleToolCall(request.params.name, request.params.arguments ?? {});
  const text =
    result.success
      ? JSON.stringify(result.data ?? result, null, 2)
      : `Error: ${result.error}`;
  return { content: [{ type: "text", text }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sprite-gen-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[sprite-gen-mcp] Fatal error:", err);
  process.exit(1);
});
