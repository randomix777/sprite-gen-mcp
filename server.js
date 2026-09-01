/**
 * sprite-gen MCP Server — Protocol adapter layer.
 *
 * This file is the ONLY place that imports MCP SDK.
 * All business logic lives in lib/services.js.
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
  configService, sheetService, generateImageService, infoService,
  cutoutService, gifPreviewService, godotExportService,
  detectAnimationsService, sessionListService, editService,
  autotileService, videoToSheetService, extractVideoFramesService,
  engineExportService, paletteExtractService, qcReportService,
  godotImportService, godotAddAnimationService, godotWireAnimationsService,
  godotScanService, styleListService, animationSequenceService,
  animationListService, effectGenerateService, effectListService,
  weaponGenerateService, weaponListService, batchGenerateService,
  batchProcessService, backgroundService,
  generateCoverPropService, auditAssetsService, regenerateRejectedAssetsService,
  generateCoverPropPhase1Service, listPendingReviewsService, approveCoverPropService, processCoverPropPhase2Service,
} from "./lib/services.js";

import { ok, err, ErrorCode, sanitizeMessage } from "./lib/result.js";
import { validate } from "./lib/validate.js";
import { STYLE_PRESETS } from "./lib/prompts.js";

import path from "path";
import { fileURLToPath } from "url";

// ─── Runtime validation schemas ─────────────────────────────────────────────

const TOOL_SCHEMAS = {
  "sprite__config": {
    action: { type: 'string', required: true, enum: ['list', 'get', 'set', 'set_key', 'set_provider', 'get_default'] },
  },
  "sprite__sheet": {
    image_path: { type: 'string', required: true, minLength: 1 },
    grid_cols: { type: 'number', min: 1, max: 64 },
    grid_rows: { type: 'number', min: 1, max: 64 },
  },
  "sprite_generate_image": {
    prompt: { type: 'string', required: true, minLength: 1, maxLength: 10000 },
    provider: { type: 'string', enum: ['gemini_flash', 'stable_diffusion', 'agnes', 'comfy'] },
    width: { type: 'number', min: 16, max: 4096 },
    height: { type: 'number', min: 16, max: 4096 },
  },
  "sprite_cutout": {
    image_path: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_animation_sequence": {
    sequence: { type: 'string', required: true, minLength: 1 },
    reference_image_path: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_generate_effect": {
    effect: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_generate_weapon": {
    weapon: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_batch_generate": {
    items: { type: 'array', required: true, minItems: 1, maxItems: 50 },
  },
  "sprite_batch_process": {
    items: { type: 'array', required: true, minItems: 1, maxItems: 100 },
  },
  "sprite_generate_background": {
    character_prompt: { type: 'string', required: true, minLength: 1 },
    character_image_url: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_preview_gif": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    cell_height: { type: 'number', min: 1, max: 4096 },
    fps: { type: 'number', min: 1, max: 60 },
  },
  "sprite_export_godot": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    output_path: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_detect_animations": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
  },
  "sprite_edit": {
    session_id: { type: 'string', required: true, minLength: 1 },
    instruction: { type: 'string', required: true, minLength: 1, maxLength: 5000 },
  },
  "sprite_autotile": {
    image_path: { type: 'string', required: true, minLength: 1 },
    tile_size: { type: 'array', minItems: 2, maxItems: 2 },
  },
  "sprite_video_to_sheet": {
    video_path: { type: 'string', required: true, minLength: 1 },
    fps: { type: 'number', min: 1, max: 60 },
    pixel_scale: { type: 'number', min: 1, max: 32 },
    colors: { type: 'number', min: 2, max: 256 },
  },
  "sprite_extract_video_frames": {
    video_path: { type: 'string', required: true, minLength: 1 },
    fps: { type: 'number', min: 1, max: 60 },
  },
  "sprite_export_tpacker": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    cell_height: { type: 'number', required: true, min: 1, max: 4096 },
  },
  "sprite_export_aseprite": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    cell_height: { type: 'number', required: true, min: 1, max: 4096 },
  },
  "sprite_export_godot_scene": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    output_path: { type: 'string', required: true, minLength: 1 },
  },
  "sprite_palette_extract": {
    image_path: { type: 'string', required: true, minLength: 1 },
    colors: { type: 'number', min: 1, max: 256 },
  },
  "sprite_qc_report": {
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
    cell_height: { type: 'number', required: true, min: 1, max: 4096 },
  },
  "sprite_godot_import": {
    project_path: { type: 'string', required: true, minLength: 1 },
    image_path: { type: 'string', required: true, minLength: 1 },
    cell_width: { type: 'number', required: true, min: 1, max: 4096 },
  },
  "sprite_godot_add_animation": {
    tre_path: { type: 'string', required: true, minLength: 1 },
    animation_name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
  },
  "sprite_godot_wire_animations": {
    project_path: { type: 'string', required: true, minLength: 1 },
    scene_path: { type: 'string', required: true, minLength: 1 },
    node_path: { type: 'string', required: true, minLength: 1 },
    animations: { type: 'object', required: true },
  },
  "sprite_godot_scan": {
    project_path: { type: 'string', required: true, minLength: 1 },
  },
};

// ─── Tool definitions (MCP schema only) ────────────────────────────────────

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
  // ── CoverProp Asset Pipeline ────────────────────────────────────────────────
  {
    name: "sprite_generate_cover_prop_phase1",
    description: "Phase 1: Generate CoverProp image and run QC preview. User must approve before Phase 2 processing.",
    inputSchema: {
      type: "object",
      properties: {
        prop_id: { type: "string", description: "Unique asset identifier" },
        prompt: { type: "string", description: "Description of the cover prop" },
        material_type: { type: "string", enum: ["wood", "metal", "glass", "fabric", "masonry", "composite"] },
        cover_height: { type: "string", enum: ["low", "high"], default: "low" },
        width: { type: "integer", default: 128 },
        height: { type: "integer", default: 128 },
        provider: { type: "string" },
        output_dir: { type: "string", default: "./output/phase1_previews" },
      },
      required: ["prop_id", "prompt", "material_type"],
    },
  },
  {
    name: "sprite_list_pending_reviews",
    description: "List all pending CoverProp assets awaiting user approval.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "sprite_approve_cover_prop",
    description: "Approve a CoverProp asset for Phase 2 processing (cutout + post-processing).",
    inputSchema: {
      type: "object",
      properties: {
        prop_id: { type: "string", description: "Asset ID to approve" },
        candidate_dir: { type: "string", description: "Path to candidate directory" },
      },
      required: ["prop_id", "candidate_dir"],
    },
  },
  {
    name: "sprite_process_cover_prop_phase2",
    description: "Process approved CoverProp assets: cutout, post-processing, and Godot export.",
    inputSchema: {
      type: "object",
      properties: {
        prop_id: { type: "string", description: "Asset ID to process" },
        candidate_dir: { type: "string", description: "Path to approved candidate directory" },
        godot_project_path: { type: "string", description: "Godot project path for scene export" },
      },
      required: ["prop_id", "candidate_dir"],
    },
  },
  {
    name: "sprite_generate_cover_prop",
    description: "Generate a complete CoverProp asset: AI-generated intact state, QC gates, rubble variant, manifest, and optional Godot scene export.",
    inputSchema: {
      type: "object",
      properties: {
        prop_id: { type: "string", description: "Unique asset identifier" },
        prompt: { type: "string", description: "Description of the cover prop" },
        material_type: { type: "string", enum: ["wood", "metal", "glass", "fabric", "masonry", "composite"] },
        cover_height: { type: "string", enum: ["low", "high"], default: "low" },
        width: { type: "integer", default: 1024 },
        height: { type: "integer", default: 1024 },
        provider: { type: "string" },
        reference_image_path: { type: "string" },
        seed: { type: "integer" },
        states: { type: "array", items: { type: "string" }, default: ["intact", "rubble"] },
        output_dir: { type: "string", default: "./output/cover_props" },
        godot_project_path: { type: "string" },
      },
      required: ["prop_id", "prompt", "material_type"],
    },
  },
  {
    name: "sprite_audit_assets",
    description: "Audit existing game assets against QC gates: check transparency, body composition, background contamination, and state consistency. Read-only — does not modify any files.",
    inputSchema: {
      type: "object",
      properties: {
        input_path: { type: "string", description: "Single file, directory, or Godot project path" },
        recursive: { type: "boolean", default: true },
        asset_type: { type: "string", enum: ["auto", "cover_prop", "sprite", "animation", "effect", "tileset", "ui"] },
        report_dir: { type: "string" },
        strict: { type: "boolean", default: true },
      },
      required: ["input_path"],
    },
  },
  {
    name: "sprite_regenerate_rejected_assets",
    description: "Regenerate assets that failed QC gates. Reads an audit report, re-generates only REJECTED assets with adaptive strategies, and re-runs all QC gates. Original files are never overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        audit_report_path: { type: "string", description: "Path to asset_audit.json from a prior audit" },
        statuses: { type: "array", items: { type: "string" }, default: ["REJECTED"] },
        rule_ids: { type: "array", items: { type: "string" } },
        asset_paths: { type: "array", items: { type: "string" } },
        provider: { type: "string" },
        max_assets: { type: "integer", default: 50 },
        max_attempts_per_asset: { type: "integer", default: 3 },
        output_root: { type: "string", default: "./output/cover_props/regenerations" },
        approve_after_gate: { type: "boolean", default: false },
        replace: { type: "boolean", default: false },
        dry_run: { type: "boolean", default: false },
      },
      required: ["audit_report_path"],
    },
  },
];

// ─── Tool dispatch (thin routing only) ──────────────────────────────────────

async function handleToolCall(name, args) {
  // Runtime parameter validation
  const schema = TOOL_SCHEMAS[name];
  if (schema) {
    const validationError = validate(args, schema);
    if (validationError) return validationError;
  }

  // Route to application service
  switch (name) {
    case "sprite__config":              return configService(args);
    case "sprite__sheet":               return sheetService(args);
    case "sprite_generate_image":       return generateImageService(args);
    case "sprite__info":                return infoService();
    case "sprite_cutout":               return cutoutService(args);
    case "sprite_animation_sequence":   return animationSequenceService(args);
    case "sprite_animation_list":       return animationListService();
    case "sprite_generate_effect":      return effectGenerateService(args);
    case "sprite_effect_list":          return effectListService();
    case "sprite_generate_weapon":      return weaponGenerateService(args);
    case "sprite_weapon_list":          return weaponListService();
    case "sprite_batch_generate":       return batchGenerateService(args);
    case "sprite_batch_process":        return batchProcessService(args);
    case "sprite_generate_background":  return backgroundService(args);
    case "sprite_preview_gif":          return gifPreviewService(args);
    case "sprite_export_godot":         return godotExportService(args);
    case "sprite_detect_animations":    return detectAnimationsService(args);
    case "sprite_session_list":         return sessionListService();
    case "sprite_edit":                 return editService(args);
    case "sprite_autotile":             return autotileService(args);
    case "sprite_video_to_sheet":       return videoToSheetService(args);
    case "sprite_extract_video_frames": return extractVideoFramesService(args);
    case "sprite_style_list":           return styleListService();
    case "sprite_export_tpacker":       return engineExportService("tpacker", args);
    case "sprite_export_aseprite":      return engineExportService("aseprite", args);
    case "sprite_export_godot_scene":   return engineExportService("godot_scene", args);
    case "sprite_palette_extract":      return paletteExtractService(args);
    case "sprite_qc_report":            return qcReportService(args);
    case "sprite_godot_import":         return godotImportService(args);
    case "sprite_godot_add_animation":  return godotAddAnimationService(args);
    case "sprite_godot_wire_animations": return godotWireAnimationsService(args);
    case "sprite_godot_scan":           return godotScanService(args);
    case "sprite_generate_cover_prop":  return generateCoverPropService(args);
    case "sprite_generate_cover_prop_phase1":  return generateCoverPropPhase1Service(args);
    case "sprite_list_pending_reviews":  return listPendingReviewsService(args);
    case "sprite_approve_cover_prop":  return approveCoverPropService(args);
    case "sprite_process_cover_prop_phase2":  return processCoverPropPhase2Service(args);
    case "sprite_audit_assets":         return auditAssetsService(args);
    case "sprite_regenerate_rejected_assets": return regenerateRejectedAssetsService(args);
    default:
      return err(ErrorCode.INVALID_ARGUMENT, `Unknown tool: ${name}`, { stage: 'validation' });
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
  const start = Date.now();
  try {
    const result = await handleToolCall(request.params.name, request.params.arguments ?? {});
    // Ensure metrics are present
    if (!result.metrics) result.metrics = { duration_ms: Date.now() - start };
    else result.metrics.duration_ms = result.metrics.duration_ms || (Date.now() - start);
    // Sanitize error messages — never leak API keys, auth headers, or vendor details
    if (result.success === false && result.error?.message) {
      result.error.message = sanitizeMessage(result.error.message);
    }
    const text = JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const text = JSON.stringify({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: sanitizeMessage(err.message), stage: 'internal', retryable: false },
      metrics: { duration_ms: Date.now() - start },
    }, null, 2);
    return { content: [{ type: "text", text }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sprite-gen-mcp] Server running on stdio");
}

// Only start server when run directly (not imported as module)
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((err) => {
    console.error("[sprite-gen-mcp] Fatal error:", err);
    process.exit(1);
  });
}

// Export for contract testing
export { TOOLS };