/**
 * Godot 4 .tscn scene parser and writer.
 *
 * Minimal but sufficient for:
 *   - Reading node hierarchy
 *   - Finding nodes by path
 *   - Adding new nodes
 *   - Setting node properties
 *   - Writing back to .tscn
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { ok, err, ErrorCode } from './result.js';

// ─── Parsing ─────────────────────────────────────────────────────────────────

/** Parse a .tscn file into a structured object. */
export function parseTscn(content) {
  const result = {
    header: {},
    ext_resources: [],
    sub_resources: [],
    resources: [],
    nodes: [],
    raw: content,
  };

  const lines = content.split('\n');
  let currentSection = null;
  let currentIndent = 0;
  let subResourceStack = []; // for nested sub_resource blocks

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    // Header
    if (trimmed.startsWith('[gd_scene') || trimmed.startsWith('[gd_scene')) {
      result.header = parseSectionBlock(trimmed);
      continue;
    }

    // Section headers
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (trimmed === '[ext_resource]') {
        currentSection = 'ext_resource';
        continue;
      }
      if (trimmed === '[sub_resource]') {
        currentSection = 'sub_resource';
        subResourceStack.push({ id: null, type: null, lines: [], block: [] });
        continue;
      }
      if (trimmed.startsWith('[sub_resource') || trimmed === '[sub_resource') {
        // Single-line sub_resource
        const block = parseSectionBlock(trimmed);
        result.sub_resources.push(block);
        continue;
      }
      if (trimmed === '[resource]') {
        currentSection = 'resource';
        continue;
      }
      if (trimmed.startsWith('[node ')) {
        currentSection = 'node';
        const nodeBlock = parseSectionBlock(trimmed);
        const node = { ...nodeBlock, children: [], properties: {} };
        result.nodes.push(node);
        continue;
      }
      // Regular section like [groups], [connection], etc.
      currentSection = trimmed.slice(1, -1);
      if (!result[currentSection]) result[currentSection] = [];
      continue;
    }

    // Key = Value lines
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();

      if (currentSection === 'ext_resource') {
        result.ext_resources.push(parseValue(value));
      } else if (currentSection === 'sub_resource') {
        if (subResourceStack.length > 0) {
          subResourceStack[subResourceStack.length - 1].lines.push(line);
        }
      } else if (currentSection === 'resource') {
        result.resources[key] = parseValue(value);
      } else if (currentSection === 'node' && result.nodes.length > 0) {
        const lastNode = result.nodes[result.nodes.length - 1];
        lastNode.properties[key] = parseValue(value);
      } else {
        if (!result[currentSection]) result[currentSection] = [];
        result[currentSection].push({ key, value: parseValue(value) });
      }
    }
  }

  // Process sub_resources (multi-line blocks)
  for (const sr of subResourceStack) {
    if (sr.block.type) {
      result.sub_resources.push({ ...sr.block, id: sr.id, props: {} });
    }
  }

  return result;
}

/** Parse a [section] header into an object. */
function parseSectionBlock(block) {
  const result = {};
  // Match key=value pairs like name="X", type="Y", load_steps=2, format=3
  const nameMatch = block.match(/name="([^"]*)"/);
  const typeMatch = block.match(/type="([^"]*)"/);
  const parentMatch = block.match(/parent="([^"]*)"/);
  const idMatch = block.match(/id="([^"]*)"/);
  const loadStepsMatch = block.match(/load_steps=(\d+)/);
  const formatMatch = block.match(/format=(\d+)/);

  if (nameMatch) result.name = nameMatch[1];
  if (typeMatch) result.type = typeMatch[1];
  if (parentMatch) result.parent = parentMatch[1];
  if (idMatch) result.id = idMatch[1];
  if (loadStepsMatch) result.load_steps = parseInt(loadStepsMatch[1]);
  if (formatMatch) result.format = parseInt(formatMatch[1]);
  return result;
}

/** Parse a Godot value string into a JS value. */
export function parseValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);

  // Vector2i(10, 20)
  const vec2iMatch = str.match(/^Vector2i\(([^)]+)\)$/);
  if (vec2iMatch) {
    const [x, y] = vec2iMatch[1].split(',').map(s => parseInt(s.trim()));
    return { x, y };
  }

  // Vector2(10.5, 20.5)
  const vec2Match = str.match(/^Vector2\(([^)]+)\)$/);
  if (vec2Match) {
    const [x, y] = vec2Match[1].split(',').map(s => parseFloat(s.trim()));
    return { x, y };
  }

  // Vector3(x, y, z)
  const vec3Match = str.match(/^Vector3\(([^)]+)\)$/);
  if (vec3Match) {
    const [x, y, z] = vec3Match[1].split(',').map(s => parseFloat(s.trim()));
    return { x, y, z };
  }

  // Vector2i(0, 0)
  const rectMatch = str.match(/^Rect2i\(([^)]+)\)$/);
  if (rectMatch) {
    const [x, y, w, h] = rectMatch[1].split(',').map(s => parseInt(s.trim()));
    return { x, y, w, h };
  }

  // Array[...] or [a, b, c]
  if (str.startsWith('[') && str.endsWith(']')) {
    const inner = str.slice(1, -1).trim();
    if (inner === '') return [];
    return strToArray(inner);
  }

  // SubResource(N) or ExtResource(N)
  const subResMatch = str.match(/^SubResource\((\d+)\)$/);
  if (subResMatch) return { __sub_resource__: parseInt(subResMatch[1]) };
  const extResMatch = str.match(/^ExtResource\((\d+)\)$/);
  if (extResMatch) return { __ext_resource__: parseInt(extResMatch[1]) };

  // String
  const stringMatch = str.match(/^"(.*)"$/s);
  if (stringMatch) return stringMatch[1];

  return str;
}

/** Parse array inner content (handles nested arrays). */
function strToArray(str) {
  const result = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '[') { depth++; current += ch; }
    else if (ch === ']') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) {
      result.push(parseValue(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(parseValue(current.trim()));
  return result;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** Serialize a parsed scene back to .tscn text. */
export function serializeTscn(scene) {
  const lines = [];

  // Header
  const loadSteps = scene.header.load_steps ?? 2;
  lines.push(`[gd_scene load_steps=${loadSteps} format=3]`);

  // Ext resources
  for (const res of scene.ext_resources) {
    lines.push(`[ext_resource type="${res.type}" path="${res.path}" id="${res.id}"]`);
  }

  // Sub resources
  for (const res of scene.sub_resources) {
    lines.push(generateSubResource(res));
  }

  // Resources (global resource block)
  if (scene.resources && Object.keys(scene.resources).length > 0) {
    lines.push('[resource]');
    for (const [key, val] of Object.entries(scene.resources)) {
      lines.push(`  ${key} = ${valueToGodot(val)}`);
    }
  }

  // Nodes
  for (const node of scene.nodes) {
    lines.push(generateNode(node));
  }

  return lines.join('\n') + '\n';
}

function generateSubResource(sr) {
  const lines = [];
  const idStr = sr.id ? ` id="${sr.id}"` : '';
  lines.push(`[sub_resource type="${sr.type}"${idStr}]`);

  const props = sr.props || {};
  if (sr.type === 'SpriteFrames') {
    // Special formatting for SpriteFrames
    const frames = props.frames || {};
    const frameList = Object.entries(frames).map(([name, anim]) => {
      const animLines = [];
      animLines.push(`  texture = ExtResource("${anim.texture_ref}")`);
      animLines.push(`  region = Rect2i(${anim.region?.x ?? 0}, ${anim.region?.y ?? 0}, ${anim.region?.w ?? 64}, ${anim.region?.h ?? 64})`);
      animLines.push(`  frame_count = ${anim.frame_count ?? anim.frames?.length ?? 4}`);
      if (anim.frames && anim.frames.length > 0) {
        animLines.push('  frames = [');
        for (const f of anim.frames) {
          animLines.push(`    { "texture_offset": Vector2i(${f.offset_x ?? 0}, ${f.offset_y ?? 0}), "duration": ${f.duration ?? 125} },`);
        }
        animLines.push('  ]');
      }
      animLines.push(`  loop = ${anim.loop !== false}`);
      return `    "${name}": {${animLines.join('\n')}\n    },`;
    });
    lines.push('  frames = {');
    lines.push(frameList.join('\n'));
    lines.push('  }');
  } else {
    for (const [key, val] of Object.entries(props)) {
      lines.push(`  ${key} = ${valueToGodot(val)}`);
    }
  }
  return lines.join('\n');
}

function generateNode(node) {
  const lines = [];
  const idStr = node.id ? ` id=${node.id}` : '';
  lines.push(`[node name="${node.name}" type="${node.type}"${idStr}]`);

  // Properties
  const props = node.properties || {};
  const skipKeys = new Set(['name', 'type', 'parent', 'id', 'children']);
  for (const [key, val] of Object.entries(props)) {
    if (skipKeys.has(key)) continue;
    lines.push(`  ${key} = ${valueToGodot(val)}`);
  }

  // Parent
  if (props.parent) {
    lines.push(`  parent = ""`); // root node
  }

  // Children
  if (node.children && node.children.length > 0) {
    lines.push('children = [');
    for (const child of node.children) {
      const childLines = generateNode(child).split('\n');
      // Indent children
      for (const cl of childLines) {
        lines.push(`  ${cl}`);
      }
      lines.push('],');
    }
    // Fix trailing comma
    if (lines[lines.length - 1] === '],') {
      lines[lines.length - 1] = ']';
    }
  }

  return lines.join('\n');
}

/** Convert a JS value to Godot text format. */
export function valueToGodot(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return `"${val}"`;

  if (val.__sub_resource__) return `SubResource(${val.__sub_resource__})`;
  if (val.__ext_resource__) return `ExtResource(${val.__ext_resource__})`;

  if (Array.isArray(val)) {
    const items = val.map(v => valueToGodot(v)).join(', ');
    return `[${items}]`;
  }

  // Vector-like objects
  if (val.x !== undefined && val.y !== undefined) {
    if (val.w !== undefined) return `Rect2i(${val.x}, ${val.y}, ${val.w}, ${val.h})`;
    return `Vector2(${val.x}, ${val.y})`;
  }
  if (val.z !== undefined) return `Vector3(${val.x}, ${val.y}, ${val.z})`;

  // Plain dict
  const entries = Object.entries(val);
  if (entries.length > 0 && entries.every(([k]) => typeof k === 'string' && !k.includes(' '))) {
    const pairs = entries.map(([k, v]) => `"${k}": ${valueToGodot(v)}`).join(', ');
    return `{ ${pairs} }`;
  }

  return JSON.stringify(val);
}

// ─── Scene Manipulation ──────────────────────────────────────────────────────

/**
 * Find a node by its scene path (e.g. "/root/Player/Sprite2D").
 * Returns the node object or null.
 */
export function findNode(scene, nodePath) {
  const parts = nodePath.split('/').filter(Boolean);

  // For simple name-only paths, search flat list
  if (parts.length === 1) {
    return scene.nodes.find(n => n.name === parts[0]) || null;
  }

  // For full paths like "Root/Player/Sprite", use parent-path matching
  // Godot parent format: "." for root children, "Root" for root, "Root/Player" for nested
  const targetParentPath = parts.slice(1, -1).join('/');
  const targetName = parts[parts.length - 1];

  for (const node of scene.nodes) {
    if (node.name !== targetName) continue;
    // Check parent matches
    const nodeParent = (node.parent || '').replace(/^"\."$/, '.');
    if (targetParentPath === '' || targetParentPath === '.') {
      // Direct child of root
      if (nodeParent === '.' || nodeParent === '') return node;
    } else {
      if (nodeParent === targetParentPath) return node;
    }
  }

  // Fallback: check children arrays (in case tree was built)
  let current = scene.nodes.find(n => n.name === parts[0]) || null;
  if (!current) return null;
  for (let i = 1; i < parts.length && current; i++) {
    current = (current.children || []).find(c => c.name === parts[i]);
  }
  return current;
}

/**
 * Add a new node as a child of an existing node.
 */
export function addChildNode(scene, parentPath, nodeDef) {
  const parent = findNode(scene, parentPath);
  if (!parent) return err(ErrorCode.FILE_NOT_FOUND, `Parent node not found: ${parentPath}`, { stage: 'processing' });

  const newNode = {
    name: nodeDef.name,
    type: nodeDef.type,
    properties: nodeDef.properties || {},
    children: [],
  };

  if (!parent.children) parent.children = [];
  parent.children.push(newNode);
  return ok({ node: newNode });
}

/**
 * Set a property on a node.
 */
export function setNodeProperty(scene, nodePath, property, value) {
  const node = findNode(scene, nodePath);
  if (!node) return err(ErrorCode.FILE_NOT_FOUND, `Node not found: ${nodePath}`, { stage: 'processing' });
  if (!node.properties) node.properties = {};
  node.properties[property] = value;
  return ok(null);
}

/**
 * Find all nodes of a given type.
 */
export function findAllNodes(scene, type) {
  const results = [];
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type === type) results.push(node);
      if (node.children) walk(node.children);
    }
  }
  walk(scene.nodes);
  return results;
}

// ─── Godot Project ───────────────────────────────────────────────────────────

/** Read project.godot and return basic info. */
export function readProjectInfo(projectPath) {
  const godotPath = path.join(projectPath, 'project.godot');
  if (!existsSync(godotPath)) return null;

  const content = readFileSync(godotPath, 'utf8');
  const info = {
    version: '',
    scenes: [],
    assets: [],
  };

  // Parse version
  const versionMatch = content.match(/config\/version\s*=\s*"([^"]+)"/);
  if (versionMatch) info.version = versionMatch[1];

  // Find scene files
  const sceneMatch = content.matchAll(/application\/run_main_scene\s*=\s*"res:\/\/([^"]+)"/g);
  for (const m of sceneMatch) {
    info.main_scene = m[1];
  }

  // Scan for .tscn files
  function scanDir(dir, rel) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const relPath = path.join(rel, entry.name);
        if (entry.isDirectory()) {
          scanDir(full, relPath);
        } else if (entry.name.endsWith('.tscn')) {
          info.scenes.push(relPath);
        } else if (entry.name.endsWith('.tres')) {
          info.assets.push(relPath);
        }
      }
    } catch (_) {}
  }
  scanDir(projectPath, '.');

  return info;
}

/**
 * Create a minimal Godot scene with a Sprite2D using the given SpriteFrames resource.
 */
export function createGodotScene(args) {
  const {
    node_name = 'Sprite2D',
    type = 'Sprite2D',
    position = { x: 0, y: 0 },
    sprite_frames_ref,
    region_enabled = true,
    anchor_preset = 7, // center
  } = args;

  const scene = {
    header: { load_steps: 2, format: 3 },
    ext_resources: [],
    sub_resources: [],
    resources: {},
    nodes: [
      {
        name: 'Root',
        type: 'Node2D',
        properties: { position },
        children: [
          {
            name: node_name,
            type,
            properties: {
              region_enabled,
              'region_rect': { x: 0, y: 0, w: 64, h: 64 }, // will be updated
              'v_frames': 1,
              'h_frames': 1,
            },
            children: [],
          },
        ],
      },
    ],
  };

  if (sprite_frames_ref) {
    scene.nodes[0].children[0].properties.frames = sprite_frames_ref;
  }

  return scene;
}
