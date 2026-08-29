/**
 * Godot project deep integration.
 *
 * Tools:
 *   sprite_import_sheet  — Import sprite sheet into a Godot project
 *   sprite_add_animation — Add/update animation on existing SpriteFrames
 *   sprite_wire_scene    — Wire animations into a scene's AnimationPlayer
 *   sprite_project_info  — Read project structure
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import {
  parseTscn, serializeTscn, findNode, addChildNode, setNodeProperty,
  findAllNodes, readProjectInfo, createGodotScene,
} from './godot_scene.js';
import { autoDetectAnimations } from './godot_export.js';

/**
 * Import a sprite sheet into a Godot project.
 *
 * Creates:
 *   - .tres SpriteFrames resource
 *   - .import file for the texture
 *   - Optionally updates or creates a .tscn scene
 *
 * @param {object} args
 * @param {string} args.project_path — path to the Godot project root (has project.godot)
 * @param {string} args.image_path — the sprite sheet PNG
 * @param {number} args.cell_width — frame width
 * @param {number} [args.cell_height]
 * @param {string} [args.node_path] — existing node to update (e.g. "/root/Player/Sprite2D")
 * @param {string} [args.scene_path] — scene to create/update
 * @param {object} [args.animations] — named animation definitions
 * @returns {{ success, scene_path?, node_path?, tre_path?, import_path? }}
 */
export async function godotImportSheet(args) {
  const {
    project_path,
    image_path,
    cell_width,
    cell_height = cell_width,
    node_path,
    scene_path,
    animations,
  } = args;

  if (!project_path) return { success: false, error: 'project_path is required' };
  if (!image_path) return { success: false, error: 'image_path is required' };
  if (!cell_width) return { success: false, error: 'cell_width is required' };
  if (!existsSync(image_path)) return { success: false, error: `Image not found: ${image_path}` };

  const relImage = path.relative(project_path, image_path).replace(/\\/g, '/');
  const resPath = `res://${relImage}`;

  // Validate project
  if (!existsSync(path.join(project_path, 'project.godot'))) {
    return { success: false, error: 'Not a Godot project (no project.godot found)' };
  }

  // Generate .import file for the texture
  const importPath = generateImportFile(project_path, image_path);

  // Detect animations if not provided
  let animDefs = animations;
  if (!animDefs) {
    const detect = await autoDetectAnimations(image_path, cell_width);
    if (detect.success) animDefs = detect.suggested_animations;
  }

  // Create .tres SpriteFrames resource
  const trePath = path.join(path.dirname(image_path), path.basename(image_path) + '.frames.tres');
  const treContent = buildSpriteFramesTres(relImage, cell_width, cell_height, animDefs || {});
  mkdirSync(path.dirname(trePath), { recursive: true });
  writeFileSync(trePath, treContent, 'utf8');

  const resTre = `res://${path.relative(project_path, trePath).replace(/\\/g, '/')}`;

  let result = {
    success: true,
    image_path: resPath,
    tre_path: resTre,
    import_path: importPath,
    grid: { cell_width, cell_height },
    animations: Object.keys(animDefs || {}),
  };

  // Handle scene node
  if (scene_path && node_path) {
    const tscnPath = path.join(project_path, scene_path);
    if (existsSync(tscnPath)) {
      // Update existing scene
      const content = readFileSync(tscnPath, 'utf8');
      const scene = parseTscn(content);
      const node = findNode(scene, node_path);
      if (node) {
        if (!node.properties) node.properties = {};
        node.properties.frames = { __sub_resource__: 0 }; // reference to first sub_resource
        node.properties.region_enabled = true;
        node.properties.v_frames = 1;
        node.properties.h_frames = 1;
        writeFileSync(tscnPath, serializeTscn(scene), 'utf8');
        result.updated_scene = scene_path;
        result.updated_node = node_path;
      } else {
        return { success: false, error: `Node not found: ${node_path} in ${scene_path}` };
      }
    } else {
      // Create new scene
      const newScene = createGodotScene({
        node_name: path.basename(node_path).split('/').pop(),
        type: 'Sprite2D',
        sprite_frames_ref: { __sub_resource__: 0 },
      });
      newScene.sub_resources.push({
        type: 'SpriteFrames',
        id: '1',
        props: buildSpriteFramesProps(cell_width, cell_height, animDefs || {}),
      });
      const newTscnPath = path.join(path.dirname(tscnPath), path.basename(tscnPath));
      writeFileSync(newTscnPath, serializeTscn(newScene), 'utf8');
      result.created_scene = scene_path;
    }
  } else if (scene_path) {
    // Create scene with default node
    const newScene = createGodotScene({
      node_name: 'Sprite2D',
      type: 'Sprite2D',
      sprite_frames_ref: { __sub_resource__: 0 },
    });
    newScene.sub_resources.push({
      type: 'SpriteFrames',
      id: '1',
      props: buildSpriteFramesProps(cell_width, cell_height, animDefs || {}),
    });
    const outPath = path.join(project_path, scene_path);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, serializeTscn(newScene), 'utf8');
    result.created_scene = scene_path;
  }

  return result;
}

/**
 * Add or update an animation on an existing SpriteFrames .tres resource.
 */
export async function godotAddAnimation(args) {
  const { tre_path, animation_name, frame_start, frame_end, fps, loop } = args;
  if (!tre_path) return { success: false, error: 'tre_path is required' };
  if (!animation_name) return { success: false, error: 'animation_name is required' };
  if (!existsSync(tre_path)) return { success: false, error: `File not found: ${tre_path}` };

  const content = readFileSync(tre_path, 'utf8');
  // Parse the .tres (simplified: find the frames block and inject)
  const updated = injectAnimationIntoTres(content, animation_name, {
    frame_start: frame_start ?? 0,
    frame_end: frame_end ?? 3,
    fps: fps ?? 8,
    loop: loop ?? true,
  });

  writeFileSync(tre_path, updated, 'utf8');
  return { success: true, tre_path, animation_name };
}

/**
 * Wire animation sequences into a scene's AnimationPlayer node.
 */
export async function godotWireAnimations(args) {
  const {
    project_path,
    scene_path,
    node_path,           // Sprite2D node
    animations,          // { idle: { start, end, fps }, walk: { ... } }
    default_animation,
  } = args;

  if (!project_path || !scene_path || !node_path || !animations) {
    return { success: false, error: 'project_path, scene_path, node_path, and animations are required' };
  }

  const tscnPath = path.join(project_path, scene_path);
  if (!existsSync(tscnPath)) return { success: false, error: `Scene not found: ${tscnPath}` };

  const content = readFileSync(tscnPath, 'utf8');
  const scene = parseTscn(content);

  // Find or create AnimationPlayer
  const spriteNode = findNode(scene, node_path);
  if (!spriteNode) return { success: false, error: `Sprite node not found: ${node_path}` };

  const parentPath = node_path.replace(/\/[^/]+$/, '');
  let animPlayer = findNode(scene, `${parentPath}/AnimationPlayer`);

  if (!animPlayer) {
    // Create AnimationPlayer as sibling of the sprite node
    const newNode = {
      name: 'AnimationPlayer',
      type: 'AnimationPlayer',
      properties: {},
      children: [],
    };
    addChildNode(scene, parentPath, newNode);
    animPlayer = newNode;
  }

  // Build animation tracks
  const tracks = {};
  for (const [name, anim] of Object.entries(animations)) {
    const frames = [];
    for (let i = anim.start; i <= anim.end; i++) {
      frames.push({ offset_x: (i % 4) * 64, offset_y: Math.floor(i / 4) * 64, duration: Math.round(1000 / (anim.fps || 8)) });
    }
    tracks[name] = {
      resource_path: '', // references the SpriteFrames resource
      frames,
      loop: anim.loop !== false,
    };
  }

  // Store on AnimationPlayer
  animPlayer.properties.anim_tracks = tracks;
  animPlayer.properties.current_animation = default_animation || Object.keys(animations)[0];

  // Set process_mode on sprite to match animation player
  spriteNode.properties.process_mode = 1; // PROCESS_MODE_PAUSABLE

  const outPath = path.join(project_path, scene_path);
  writeFileSync(outPath, serializeTscn(scene), 'utf8');

  return {
    success: true,
    scene_path,
    node_path,
    animations: Object.keys(animations),
    default_animation: default_animation || Object.keys(animations)[0],
  };
}

/**
 * Scan a Godot project and report all sprite-related resources and scenes.
 */
export async function godotScanProject(args) {
  const { project_path } = args;
  if (!project_path) return { success: false, error: 'project_path is required' };
  if (!existsSync(path.join(project_path, 'project.godot'))) {
    return { success: false, error: 'Not a Godot project' };
  }

  const info = readProjectInfo(project_path);
  if (!info) return { success: false, error: 'Cannot read project.godot' };

  // Find all .tres files
  const fs = require('fs');
  const tresFiles = [];
  function scanDir(dir, rel) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const relPath = path.join(rel, entry.name);
        if (entry.isDirectory()) scanDir(full, relPath);
        else if (entry.name.endsWith('.tres')) tresFiles.push(relPath);
      }
    } catch (_) {}
  }
  scanDir(project_path, '.');

  // Find all Sprite2D/AnimatedSprite2D nodes across scenes
  const spriteNodes = [];
  for (const scene of info.scenes) {
    const sp = path.join(project_path, scene);
    if (!existsSync(sp)) continue;
    try {
      const content = readFileSync(sp, 'utf8');
      const sceneData = parseTscn(content);
      const sprites = findAllNodes(sceneData, 'Sprite2D');
      const animated = findAllNodes(sceneData, 'AnimatedSprite2D');
      for (const s of [...sprites, ...animated]) {
        spriteNodes.push({ scene, node: s.name, type: s.type, path: scene + ' → ' + s.name });
      }
    } catch (_) {}
  }

  return {
    success: true,
    project_version: info.version,
    main_scene: info.main_scene,
    total_scenes: info.scenes.length,
    total_tres: tresFiles.length,
    sprite_nodes: spriteNodes,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Generate a Godot .import file for a texture. */
function generateImportFile(projectPath, imagePath) {
  const absPath = path.resolve(imagePath);
  const relPath = path.relative(projectPath, absPath).replace(/\\/g, '/');
  const absUri = `res://${relPath}`;

  // Compute hash
  let content = '';
  try {
    content = readFileSync(absPath);
  } catch (_) {}
  const hash = content ? createHash('md5').update(content).digest('hex') : '0'.repeat(32);

  const importData = `[remap]
imported_as="texture"
subtype="Texture"
options/compress/mode=0
options/compress/lossy_quality=0.75
options/compress/hdr_mode=0
options/compress/bptc_ldr=0
options/compress/normal_map=0
options/mipmaps/generate=0
options/mipmaps/limit=-1
options/roughness/mode=0
flags/repeat=1
flags/filter=1
flags/aniso=1
flags/srgb=1
process/hdr_as_float_texture=0
process/is_linear_srgb=1
process/stex_format=0
hash="${hash}"
`;

  const importPath = absPath + '.import';
  mkdirSync(path.dirname(importPath), { recursive: true });
  writeFileSync(importPath, importData, 'utf8');
  return importPath;
}

/** Build SpriteFrames .tres content. */
function buildSpriteFramesTres(textureRes, cellW, cellH, anims) {
  const lines = [];
  const animEntries = Object.entries(anims);

  lines.push('[gd_resource type="SpriteFrames" format=3]');
  lines.push(`resource = {`);
  lines.push(`  "frames" : {`);

  for (let ai = 0; ai < animEntries.length; ai++) {
    const [name, anim] = animEntries[ai];
    const dur = Math.round(1000 / (anim.fps || 8));
    const count = anim.end - anim.start + 1;
    lines.push(`    "${name}" : {`);
    lines.push(`      "texture" : ExtResource( 1 ),`);
    lines.push(`      "region" : Rect2i( 0 , 0, ${cellW}, ${cellH} ),`);
    lines.push(`      "frame_count" : ${count},`);
    lines.push(`      "loop" : ${anim.loop !== false},`);
    lines.push(`      "frames" : [`);
    for (let i = anim.start; i <= anim.end; i++) {
      const col = i % Math.round(1024 / cellW); // approximate
      const row = Math.floor(i / Math.round(1024 / cellW));
      lines.push(`        { "texture_offset" : Vector2i( ${i * cellW} , 0 ), "duration" : ${dur} },`);
    }
    lines.push(`      ]`);
    lines.push(`    }${ai < animEntries.length - 1 ? ',' : ''}`);
  }

  lines.push(`  }`);
  lines.push(`}`);
  lines.push(`[ext_resource type="Texture2D" path="${textureRes}" id="1"]`);

  return lines.join('\n') + '\n';
}

/** Build SpriteFrames props object for scene serialization. */
function buildSpriteFramesProps(cellW, cellH, anims) {
  const frames = {};
  for (const [name, anim] of Object.entries(anims)) {
    const dur = Math.round(1000 / (anim.fps || 8));
    const frameList = [];
    for (let i = anim.start; i <= anim.end; i++) {
      frameList.push({
        texture_offset: { x: (i % 4) * cellW, y: Math.floor(i / 4) * cellH },
        duration: dur,
      });
    }
    frames[name] = {
      texture_ref: '1',
      region: { x: 0, y: 0, w: cellW, h: cellH },
      frame_count: anim.end - anim.start + 1,
      frames: frameList,
      loop: anim.loop !== false,
    };
  }
  return { frames };
}

/** Inject an animation definition into an existing .tres text. */
function injectAnimationIntoTres(content, animName, animDef) {
  // Simple approach: find the frames block and append
  const lines = content.split('\n');
  const result = [];
  let inFrames = false;
  let added = false;

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (lines[i].includes('"frames"') && lines[i].includes('{')) {
      inFrames = true;
    }
    if (inFrames && !added && lines[i].trim() === '}') {
      // Insert before closing brace
      const dur = Math.round(1000 / (animDef.fps || 8));
      result.pop(); // remove the }
      result.push(`    "${animName}" : {`);
      result.push(`      "texture" : ExtResource( 1 ),`);
      result.push(`      "region" : Rect2i( 0 , 0, ${animDef.cell_width || 64}, ${animDef.cell_height || 64} ),`);
      result.push(`      "frame_count" : ${animDef.frame_end - animDef.frame_start + 1},`);
      result.push(`      "loop" : ${animDef.loop !== false},`);
      result.push(`      "frames" : [`);
      for (let f = animDef.frame_start; f <= animDef.frame_end; f++) {
        result.push(`        { "texture_offset" : Vector2i( ${f * (animDef.cell_width || 64)} , 0 ), "duration" : ${dur} },`);
      }
      result.push(`      ]`);
      result.push(`    },`);
      result.push(lines[i]); // re-add the }
      added = true;
      inFrames = false;
    }
  }

  return result.join('\n');
}
