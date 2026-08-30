/**
 * Godot project deep integration.
 *
 * Tools:
 *   sprite_import_sheet  — Import sprite sheet into a Godot project
 *   sprite_add_animation — Add/update animation on existing SpriteFrames
 *   sprite_wire_scene    — Wire animations into a scene's AnimationPlayer
 *   sprite_project_info  — Read project structure
 *
 * Path safety:
 *   - All project_path validated via validateGodotProject() (realpath, project.godot check)
 *   - All scene_path/tre_path resolved via resolveGodotPath() (traversal, UNC, symlink check)
 *   - All writeFileSync guarded by validateGodotWritePath() (containment, overwrite, protected files)
 *   - image_path must be within the project root
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { ok, err, ErrorCode, artifact } from './result.js';
import { LIMITS } from './limits.js';

import {
  parseTscn, serializeTscn, findNode, addChildNode, setNodeProperty,
  findAllNodes, readProjectInfo, createGodotScene,
} from './godot_scene.js';
import { autoDetectAnimations } from './godot_export.js';
import { safeScanDir } from './safe_scan.js';
import {
  validateGodotProject, resolveGodotPath, validateGodotWritePath,
  validateInputFile,
} from './path_safety.js';

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
 * @param {string} [args.scene_path] — scene to create/update (project-relative)
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

  if (!project_path) return err(ErrorCode.INVALID_ARGUMENT, 'project_path is required', { stage: 'validation' });
  if (!image_path) return err(ErrorCode.INVALID_ARGUMENT, 'image_path is required', { stage: 'validation' });
  if (!cell_width) return err(ErrorCode.INVALID_ARGUMENT, 'cell_width is required', { stage: 'validation' });

  // Validate project root (realpath, project.godot check)
  const projectRoot = validateGodotProject(project_path);
  if (projectRoot && projectRoot.error) return projectRoot;
  if (typeof projectRoot !== 'string') return projectRoot;

  // Validate image exists
  const imgCheck = validateInputFile(image_path);
  if (imgCheck && imgCheck.error) return imgCheck;

  // Verify image is within the project root
  const resolvedImage = path.resolve(image_path);
  const imgRel = path.relative(projectRoot, resolvedImage);
  if (imgRel.startsWith('..') || path.isAbsolute(imgRel)) {
    return err(ErrorCode.INVALID_ARGUMENT, `image_path must be within the project: ${image_path}`, { stage: 'validation' });
  }

  const relImage = imgRel.replace(/\\/g, '/');
  const resPath = `res://${relImage}`;

  // Generate .import file for the texture
  const importPath = generateImportFile(projectRoot, resolvedImage);

  // Detect animations if not provided
  let animDefs = animations;
  if (!animDefs) {
    const detect = await autoDetectAnimations(resolvedImage, cell_width);
    if (detect.success) animDefs = detect.data.suggested_animations;
  }

  // Create .tres SpriteFrames resource — must be within project
  const trePath = path.join(path.dirname(resolvedImage), path.basename(resolvedImage) + '.frames.tres');
  const treWriteErr = validateGodotWritePath(projectRoot, trePath, { allowOverwrite: true });
  if (treWriteErr) return treWriteErr;

  const treContent = buildSpriteFramesTres(relImage, cell_width, cell_height, animDefs || {});
  mkdirSync(path.dirname(trePath), { recursive: true });
  writeFileSync(trePath, treContent, 'utf8');

  const resTre = `res://${path.relative(projectRoot, trePath).replace(/\\/g, '/')}`;

  let resultData = {
    image_path: resPath,
    tre_path: resTre,
    import_path: importPath,
    grid: { cell_width, cell_height },
    animations: Object.keys(animDefs || {}),
  };

  // Handle scene node — scene_path must be project-relative
  if (scene_path && node_path) {
    const sceneResolved = resolveGodotPath(projectRoot, scene_path);
    if (sceneResolved && sceneResolved.error) return sceneResolved;

    const writeErr = validateGodotWritePath(projectRoot, sceneResolved, { allowOverwrite: true, forbiddenNames: ['project.godot'] });
    if (writeErr) return writeErr;

    if (existsSync(sceneResolved)) {
      // Update existing scene
      const content = readFileSync(sceneResolved, 'utf8');
      const scene = parseTscn(content);
      const node = findNode(scene, node_path);
      if (node) {
        if (!node.properties) node.properties = {};
        node.properties.frames = { __sub_resource__: 0 };
        node.properties.region_enabled = true;
        node.properties.v_frames = 1;
        node.properties.h_frames = 1;
        writeFileSync(sceneResolved, serializeTscn(scene), 'utf8');
        resultData.updated_scene = scene_path;
        resultData.updated_node = node_path;
      } else {
        return err(ErrorCode.FILE_NOT_FOUND, `Node not found: ${node_path} in ${scene_path}`, { stage: 'processing' });
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
      mkdirSync(path.dirname(sceneResolved), { recursive: true });
      writeFileSync(sceneResolved, serializeTscn(newScene), 'utf8');
      resultData.created_scene = scene_path;
    }
  } else if (scene_path) {
    const sceneResolved = resolveGodotPath(projectRoot, scene_path);
    if (sceneResolved && sceneResolved.error) return sceneResolved;

    const writeErr = validateGodotWritePath(projectRoot, sceneResolved, { allowOverwrite: true, forbiddenNames: ['project.godot'] });
    if (writeErr) return writeErr;

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
    mkdirSync(path.dirname(sceneResolved), { recursive: true });
    writeFileSync(sceneResolved, serializeTscn(newScene), 'utf8');
    resultData.created_scene = scene_path;
  }

  return ok(resultData);
}

/**
 * Add or update an animation on an existing SpriteFrames .tres resource.
 * tre_path must be validated by the caller or within the project.
 */
export async function godotAddAnimation(args) {
  const { tre_path, animation_name, frame_start, frame_end, fps, loop, project_path } = args;
  if (!tre_path) return err(ErrorCode.INVALID_ARGUMENT, 'tre_path is required', { stage: 'validation' });
  if (!animation_name) return err(ErrorCode.INVALID_ARGUMENT, 'animation_name is required', { stage: 'validation' });

  // If project_path provided, validate containment
  if (project_path) {
    const projectRoot = validateGodotProject(project_path);
    if (projectRoot && projectRoot.error) return projectRoot;
    if (typeof projectRoot === 'string') {
      const resolved = path.resolve(tre_path);
      const rel = path.relative(projectRoot, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return err(ErrorCode.INVALID_ARGUMENT, `tre_path must be within the project: ${tre_path}`, { stage: 'validation' });
      }
    }
  }

  // Validate the file exists and is a .tres
  if (!existsSync(tre_path)) return err(ErrorCode.FILE_NOT_FOUND, `File not found: ${tre_path}`, { stage: 'validation' });
  if (!tre_path.endsWith('.tres')) {
    return err(ErrorCode.INVALID_ARGUMENT, `tre_path must be a .tres file: ${tre_path}`, { stage: 'validation' });
  }

  const content = readFileSync(tre_path, 'utf8');
  const updated = injectAnimationIntoTres(content, animation_name, {
    frame_start: frame_start ?? 0,
    frame_end: frame_end ?? 3,
    fps: fps ?? 8,
    loop: loop ?? true,
  });

  writeFileSync(tre_path, updated, 'utf8');
  return ok({ tre_path, animation_name });
}

/**
 * Wire animation sequences into a scene's AnimationPlayer node.
 */
export async function godotWireAnimations(args) {
  const {
    project_path,
    scene_path,
    node_path,
    animations,
    default_animation,
  } = args;

  if (!project_path || !scene_path || !node_path || !animations) {
    return err(ErrorCode.INVALID_ARGUMENT, 'project_path, scene_path, node_path, and animations are required', { stage: 'validation' });
  }

  // Validate project root
  const projectRoot = validateGodotProject(project_path);
  if (projectRoot && projectRoot.error) return projectRoot;
  if (typeof projectRoot !== 'string') return projectRoot;

  // Resolve scene_path within project
  const sceneResolved = resolveGodotPath(projectRoot, scene_path);
  if (sceneResolved && sceneResolved.error) return sceneResolved;

  if (!existsSync(sceneResolved)) return err(ErrorCode.FILE_NOT_FOUND, `Scene not found: ${scene_path}`, { stage: 'validation' });

  const content = readFileSync(sceneResolved, 'utf8');
  const scene = parseTscn(content);

  // Find or create AnimationPlayer
  const spriteNode = findNode(scene, node_path);
  if (!spriteNode) return err(ErrorCode.FILE_NOT_FOUND, `Sprite node not found: ${node_path}`, { stage: 'processing' });

  const parentPath = node_path.replace(/\/[^/]+$/, '');
  let animPlayer = findNode(scene, `${parentPath}/AnimationPlayer`);

  if (!animPlayer) {
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
      resource_path: '',
      frames,
      loop: anim.loop !== false,
    };
  }

  animPlayer.properties.anim_tracks = tracks;
  animPlayer.properties.current_animation = default_animation || Object.keys(animations)[0];
  spriteNode.properties.process_mode = 1;

  const writeErr = validateGodotWritePath(projectRoot, sceneResolved, { allowOverwrite: true, forbiddenNames: ['project.godot'] });
  if (writeErr) return writeErr;

  writeFileSync(sceneResolved, serializeTscn(scene), 'utf8');

  return ok({
    scene_path,
    node_path,
    animations: Object.keys(animations),
    default_animation: default_animation || Object.keys(animations)[0],
  });
}

/**
 * Scan a Godot project and report all sprite-related resources and scenes.
 */
export async function godotScanProject(args) {
  const { project_path } = args;
  if (!project_path) return err(ErrorCode.INVALID_ARGUMENT, 'project_path is required', { stage: 'validation' });

  const projectRoot = validateGodotProject(project_path);
  if (projectRoot && projectRoot.error) return projectRoot;
  if (typeof projectRoot !== 'string') return projectRoot;

  const info = readProjectInfo(projectRoot);
  if (!info) return err(ErrorCode.PROCESSING_FAILED, 'Cannot read project.godot', { stage: 'processing' });

  const scanResult = safeScanDir(projectRoot, {
    extensions: ['.tres'],
  });
  const tresFiles = scanResult.files;

  const spriteNodes = [];
  for (const scene of info.scenes) {
    const sp = path.join(projectRoot, scene);
    // Verify scene path is within project
    const rel = path.relative(projectRoot, sp);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
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

  return ok({
    project_version: info.version,
    main_scene: info.main_scene,
    total_scenes: info.scenes.length,
    total_tres: tresFiles.length,
    sprite_nodes: spriteNodes,
  });
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Generate a Godot .import file for a texture. */
function generateImportFile(projectPath, imagePath) {
  const absPath = path.resolve(imagePath);
  const relPath = path.relative(projectPath, absPath).replace(/\\/g, '/');
  const absUri = `res://${relPath}`;

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
      const dur = Math.round(1000 / (animDef.fps || 8));
      result.pop();
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
      result.push(lines[i]);
      added = true;
      inFrames = false;
    }
  }

  return result.join('\n');
}
