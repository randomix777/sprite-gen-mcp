/**
 * Prompt templates for sprite generation.
 * Consolidated from agnes-sprite-gen/prompts.py and sprite-sheet-creator prompts.
 */

// ─── Style Presets ───────────────────────────────────────────────────────────

export const STYLE_PRESETS = {
  // ── Characters ────────────────────────────────────────────────────────────
  fantasy: {
    name: 'Fantasy',
    description: 'High-fantasy RPG — armor, magic, medieval aesthetic',
    prompt_suffix: 'High fantasy RPG character design, detailed armor and clothing, magical atmosphere, vibrant colors, game-ready sprite quality.',
    negative_prompt: 'modern, sci-fi, photorealistic, blurry',
  },
  sci_fi: {
    name: 'Sci-Fi',
    description: 'Futuristic sci-fi — tech, space, neon',
    prompt_suffix: 'Futuristic sci-fi character design, sleek tech armor, holographic elements, neon accents, space-age aesthetic, clean lines.',
    negative_prompt: 'fantasy, medieval, rustic, pixelated',
  },
  horror: {
    name: 'Horror',
    description: 'Dark horror — grotesque, eerie, unsettling',
    prompt_suffix: 'Dark horror character design, grotesque features, eerie atmosphere, muted desaturated colors, unsettling details, gothic aesthetic.',
    negative_prompt: 'bright, cheerful, cartoonish, cute',
  },
  painterly: {
    name: 'Painterly',
    description: 'Brush-stroke painting — expressive, textured',
    prompt_suffix: 'Painterly art style with visible brush strokes, textured canvas feel, impressionistic color blending, hand-painted game asset quality.',
    negative_prompt: 'photorealistic, digital, flat, smooth',
  },
  simple: {
    name: 'Simple / Minimal',
    description: 'Clean minimal — bold shapes, limited palette',
    prompt_suffix: 'Simple minimal art style, bold clean shapes, limited color palette, flat shading, mobile game aesthetic, easy to read at small sizes.',
    negative_prompt: 'overly detailed, photorealistic, complex, cluttered',
  },
  top_down: {
    name: 'Top-Down RPG',
    description: 'Isometric top-down view — classic RPG perspective',
    prompt_suffix: 'Top-down isometric RPG character, 3/4 perspective view, clear silhouette from above, consistent camera angle, game sprite quality.',
    negative_prompt: 'side view, front view, photorealistic',
  },
  platformer: {
    name: 'Platformer',
    description: 'Side-scrolling platformer — clear action poses',
    prompt_suffix: 'Side-scrolling platformer character design, clear silhouette, dynamic pose, vibrant colors, readable at small sprite sizes, 2D game asset quality.',
    negative_prompt: 'isometric, top-down, photorealistic',
  },

  // ── Tiles & Maps ──────────────────────────────────────────────────────────
  isometric: {
    name: 'Isometric Tile',
    description: 'Isometric perspective — 3D-looking 2D tiles',
    prompt_suffix: 'Isometric tile art, 3/4 perspective, clean geometric shapes, seamless tileable edges, isometric puzzle aesthetic, game map quality.',
    negative_prompt: 'pixelated, side view, photorealistic',
  },
  hexagonal: {
    name: 'Hexagonal Tile',
    description: 'Hex grid maps — hex-shaped terrain tiles',
    prompt_suffix: 'Hexagonal tile art for strategy games, hex-shaped terrain, seamless edge matching, clean isometric shading, tabletop RPG aesthetic.',
    negative_prompt: 'square tiles, pixelated, photorealistic',
  },
  dungeon: {
    name: 'Dungeon Map',
    description: 'Dungeon/tileset — stone, corridors, dark atmosphere',
    prompt_suffix: 'Dungeon tileset art, stone textures, dark corridor aesthetic, roguelike game tiles, seamless edge matching, moody atmospheric lighting.',
    negative_prompt: 'bright, outdoor, grassy, photorealistic',
  },

  // ── UI & Icons ────────────────────────────────────────────────────────────
  fps_weapon: {
    name: 'FPS Weapon',
    description: 'First-person shooter weapon — clean side profile',
    prompt_suffix: 'FPS weapon sprite, clean side-profile view, detailed mechanical parts, metallic sheen, game HUD quality, solid magenta background (uniform flat single color, no pattern, chroma key), game HUD quality.',
    negative_prompt: 'front view, cartoonish, pixelated',
  },
  spell_icon: {
    name: 'Spell / Skill Icon',
    description: 'Circular skill icon — magical effects, potion bottles',
    prompt_suffix: 'Circular skill icon design, magical glowing effects, rich jewel tones, ornate border, game UI icon quality, centered composition.',
    negative_prompt: 'rectangular, photorealistic, minimalist',
  },
  ui_panel: {
    name: 'UI Panel',
    description: 'Game UI panel — decorative frame, ornate borders',
    prompt_suffix: 'Game UI panel design, ornate decorative border, fantasy/steampunk frame, centered content area, cohesive visual style, interface element quality.',
    negative_prompt: 'plain, modern, minimalist, photorealistic',
  },
  inventory: {
    name: 'Inventory Item',
    description: 'Standalone inventory icon — item on transparent bg',
    prompt_suffix: 'Inventory item icon, standalone object on solid magenta background (uniform flat single color, no pattern, chroma key), clear silhouette, isometric or front view, game HUD quality, clean edges.',
    negative_prompt: 'grouped, background elements, photorealistic',
  },
  typography: {
    name: 'Typography Logo',
    description: 'Stylized text/lettering — game title treatment',
    prompt_suffix: 'Stylized typography logo, bold decorative lettering, game title treatment, ornamental details, cohesive font design, professional logo quality.',
    negative_prompt: 'plain text, photo, photorealistic',
  },

  // ── Animation Styles ──────────────────────────────────────────────────────
  walk_4dir: {
    name: '4-Direction Walk',
    description: 'Top-down 4-direction walk cycle — consistent sprite',
    prompt_suffix: 'Top-down 4-direction walk cycle sprite sheet, consistent character design across all 4 directions, clean edges, game sprite quality, same scale and pose style.',
    negative_prompt: 'side view only, photorealistic, inconsistent',
  },
  walk_idle: {
    name: 'Walk & Idle',
    description: 'Combined walk cycle + idle loop — two animation rows',
    prompt_suffix: 'Character sprite sheet with walk cycle and idle animation, two rows of frames, consistent art style, game-ready sprite quality, smooth animation poses.',
    negative_prompt: 'single action, photorealistic',
  },
  vfx_effects: {
    name: 'VFX Effects',
    description: 'Spell effects, particles, explosions — transparent bg',
    prompt_suffix: 'VFX particle effect sprite, glowing magical effects, energy bursts, smoke trails, solid magenta background (uniform flat single color, no pattern, chroma key), game FX quality, dynamic pose.',
    negative_prompt: 'solid background, character, photorealistic',
  },
  small_sprites: {
    name: 'Small Sprites (8-bit)',
    description: 'Tiny 16x16 or 32x32 sprites — retro mobile aesthetic',
    prompt_suffix: 'Small retro sprite design, 16x16 or 32x32 pixel aesthetic, limited palette, crisp pixel edges, mobile game quality, readable at tiny size.',
    negative_prompt: 'high detail, photorealistic, large canvas',
  },
  eight_direction: {
    name: '8-Direction Rotation',
    description: 'Full 8-direction walk — top-down RPG movement',
    prompt_suffix: '8-directional walk cycle sprite sheet, consistent character from all angles, smooth rotation poses, top-down RPG quality, same scale across all directions.',
    negative_prompt: '4-direction only, side view, photorealistic',
  },

  // ── Art Styles ────────────────────────────────────────────────────────────
  pixel_art: {
    name: 'Pixel Art',
    description: 'Classic 16-bit retro pixel art with crisp edges',
    prompt_suffix: 'Detailed pixel art style with crisp anti-aliased edges, limited color palette, no gradients, 32-bit console aesthetic, game sprite quality.',
    negative_prompt: 'blurry, smooth, photorealistic, 3D render, high detail, photograph',
  },
  clean_hd: {
    name: 'Clean HD',
    description: 'Clean hand-painted HD for modern 2D games',
    prompt_suffix: 'Clean hand-painted HD illustration style, sharp lines, vibrant colors, game asset quality, no pixelation, Studio Ghibli inspired.',
    negative_prompt: 'pixelated, low res, blurry, rough sketch, photorealistic',
  },
  pixel_inspired: {
    name: 'Pixel Inspired',
    description: 'Modern style with pixel-art aesthetic at higher res',
    prompt_suffix: 'Pixel-inspired digital art, clean geometric shapes, limited palette with soft shading, game-ready quality, modern retro blend.',
    negative_prompt: 'photorealistic, 3D, overly detailed, blur',
  },
  retro_pixel: {
    name: 'Retro Pixel',
    description: 'Authentic 8-bit / 16-bit retro game aesthetic',
    prompt_suffix: 'Authentic retro 8-bit pixel art, limited to 16 colors, dithering shading, SNES-era aesthetic, chunky pixel style, nostalgic game feel.',
    negative_prompt: 'modern, HD, smooth, photorealistic, 3D',
  },
  watercolor: {
    name: 'Watercolor',
    description: 'Soft watercolor painting — whimsical, storybook',
    prompt_suffix: 'Soft watercolor painting style, gentle brush strokes, pastel colors, whimsical atmosphere, storybook illustration, dreamy translucent layers.',
    negative_prompt: 'pixelated, harsh lines, photorealistic, dark, gritty',
  },
  neon_cyber: {
    name: 'Neon Cyberpunk',
    description: 'Glowing neon aesthetic — sci-fi, synthwave',
    prompt_suffix: 'Neon-lit cyberpunk aesthetic, glowing edges, solid black background, flat uniform single color, no pattern, no checkerboard, futuristic tech visual, synthwave palette, electric blue and magenta highlights.',
    negative_prompt: 'natural lighting, daytime, pixelated, rustic, vintage',
  },
  stained_glass: {
    name: 'Stained Glass',
    description: 'Vibrant jewel-tone stained glass window style',
    prompt_suffix: 'Stained glass window art style, vibrant jewel-tone colors, thick dark outlines, luminous translucent quality, gothic cathedral aesthetic, light passing through colored glass.',
    negative_prompt: 'photorealistic, muted colors, plain, modern',
  },
  cartoon: {
    name: 'Cartoon',
    description: 'Bold cartoon — thick outlines, exaggerated expressions',
    prompt_suffix: 'Bold cartoon art style, thick black outlines, exaggerated expressions, flat vibrant colors, animated show quality, fun and expressive character design.',
    negative_prompt: 'realistic, photorealistic, subtle, muted',
  },
  manga: {
    name: 'Manga / Anime',
    description: 'Japanese anime style — expressive eyes, dynamic shading',
    prompt_suffix: 'Japanese anime/manga art style, expressive large eyes, dynamic shading, cel-shaded colors, detailed hair, studio production quality, 2D animation aesthetic.',
    negative_prompt: 'western comic, photorealistic, pixelated',
  },
  low_poly: {
    name: 'Low-Poly 3D',
    description: 'Polygonal 3D aesthetic — flat-shaded geometric',
    prompt_suffix: 'Low-poly 3D art style, flat-shaded geometric faces, triangular mesh aesthetic, vibrant solid colors, modern indie game visual, clean polygonal edges.',
    negative_prompt: 'photorealistic, high detail, realistic textures, pixelated',
  },
  vector: {
    name: 'Vector Illustration',
    description: 'Clean vector art — geometric, flat design',
    prompt_suffix: 'Clean vector illustration style, geometric shapes, flat design aesthetic, bold solid colors, no gradients, modern UI/UX design quality, crisp scalable edges.',
    negative_prompt: 'photorealistic, detailed texture, pixelated, messy',
  },
  woodcut: {
    name: 'Woodcut / Linocut',
    description: 'Traditional printmaking — bold black lines, textured',
    prompt_suffix: 'Woodcut printmaking art style, bold black ink lines, textured paper feel, high contrast black and white with selective color, traditional Japanese ukiyo-e influence.',
    negative_prompt: 'photorealistic, soft gradients, digital smooth',
  },
  ink_wash: {
    name: 'Ink Wash Painting',
    description: 'Eastern ink wash — atmospheric, minimal, monochrome',
    prompt_suffix: 'Eastern ink wash painting style, atmospheric brush strokes, monochrome with subtle color accents, negative space composition, traditional sumi-e aesthetic, poetic mood.',
    negative_prompt: 'vibrant colors, photorealistic, pixelated, busy',
  },
  comic_book: {
    name: 'Comic Book',
    description: 'Western comic — halftone dots, bold inks',
    prompt_suffix: 'Western comic book art style, bold black ink outlines, halftone dot shading, vibrant primary colors, dynamic action poses, printing quality, graphic novel aesthetic.',
    negative_prompt: 'photorealistic, subtle, minimalist, pixelated',
  },
  pixel_perfect: {
    name: 'Pixel Perfect',
    description: 'Ultra-clean pixel art — no anti-aliasing, hard edges',
    prompt_suffix: 'Ultra-clean pixel perfect art, no anti-aliasing, hard pixel edges, precise pixel placement, limited palette, authentic retro game sprite, sharp geometric forms.',
    negative_prompt: 'smooth, blended, photorealistic, soft edges',
  },
};

// ─── Character Prompts ───────────────────────────────────────────────────────

export const CHARACTER_PROMPTS = {
  // Side-scroller
  walk: `Create a 4-frame pixel art walk cycle sprite sheet of this character.
Arrange the 4 frames in a 2x2 grid on white background. The character is walking to the right.
Frame 1 (top-left): Right leg forward, left leg back — stride position.
Frame 2 (top-right): Legs close together, passing/crossing — transition.
Frame 3 (bottom-left): Left leg forward, right leg back — opposite stride.
Frame 4 (bottom-right): Legs close together, passing/crossing — transition back.
Use detailed 32-bit pixel art style with proper shading and highlights. Same character design in all frames. Character facing right.`,

  jump: `Create a 4-frame pixel art jump animation sprite sheet of this character.
Arrange the 4 frames in a 2x2 grid on white background. The character is jumping.
Frame 1 (top-left): Crouch/anticipation — character slightly crouched, knees bent, preparing to jump.
Frame 2 (top-right): Rising — character in air, legs tucked up, arms up, ascending.
Frame 3 (bottom-left): Apex/peak — character at highest point of jump, body stretched or tucked.
Frame 4 (bottom-right): Landing — character landing, slight crouch to absorb impact.
Use detailed 32-bit pixel art style. Same character design in all frames. Character facing right.`,

  attack: `Create a 4-frame pixel art attack animation sprite sheet of this character.
Arrange the 4 frames in a 2x2 grid on white background. The character is performing an attack that fits their design.
Frame 1 (top-left): Wind-up/anticipation — preparing to attack, pulling back weapon or gathering energy.
Frame 2 (top-right): Attack in motion — the strike or spell being unleashed.
Frame 3 (bottom-left): Impact/peak — maximum extension of attack, full power.
Frame 4 (bottom-right): Recovery — returning to ready stance.
Use detailed 32-bit pixel art style. Same character design in all frames. Make the attack visually dynamic.`,

  idle: `Create a 4-frame pixel art idle/breathing animation sprite sheet of this character.
Arrange the 4 frames in a 2x2 grid on white background. The character is standing still with subtle idle animation.
Frame 1 (top-left): Neutral standing pose — relaxed stance.
Frame 2 (top-right): Slight inhale — chest/body rises subtly.
Frame 3 (bottom-left): Full breath — slight upward posture.
Frame 4 (bottom-right): Exhale — returning to neutral, slight settle.
Keep movements subtle. Same character design in all frames. Character facing right.`,

  // Isometric / Top-down RPG
  'walk-down': `Create a 4-frame pixel art walk cycle walking DOWNWARD (toward camera) in top-down isometric RPG perspective (3/4 overhead view).
Arrange the 4 frames in a 2x2 grid on white background. The character is walking toward the viewer.
Frame 1 (top-left): Left foot forward stride, arms swinging naturally.
Frame 2 (top-right): Feet together, passing/transition pose.
Frame 3 (bottom-left): Right foot forward stride, arms swinging naturally.
Frame 4 (bottom-right): Feet together, passing/transition back.
We see the character's front/face from a top-down 3/4 view. Detailed 32-bit pixel art style. Same character in all frames.`,

  'walk-up': `Create a 4-frame pixel art walk cycle walking UPWARD (away from camera) in top-down isometric RPG perspective (3/4 overhead view).
Arrange the 4 frames in a 2x2 grid on white background. The character is walking away from the viewer.
ALL 4 frames must show the character's BACK from EXACTLY the same angle. Only leg and arm positions differ for the walk cycle.
Frame 1 (top-left): Left foot forward — BACK VIEW. Frame 2 (top-right): Feet together — BACK VIEW.
Frame 3 (bottom-left): Right foot forward — BACK VIEW. Frame 4 (bottom-right): Feet together — BACK VIEW.
Detailed 32-bit pixel art style. Same character in all frames.`,

  'walk-side': `Create a 4-frame pixel art walk cycle walking to the RIGHT in top-down isometric RPG perspective (3/4 overhead view).
Arrange the 4 frames in a 2x2 grid on white background. Character faces RIGHT.
Frame 1 (top-left): Right leg forward, left leg back — stride position. Frame 2 (top-right): Legs close together — transition.
Frame 3 (bottom-left): Left leg forward, right leg back — opposite stride. Frame 4 (bottom-right): Legs close together — transition back.
Detailed 32-bit pixel art style. Same character design in all frames.`,

  'attack-down': `Create a 4-frame pixel art ATTACK animation walking DOWNWARD (toward camera) in top-down isometric RPG perspective.
Arrange the 4 frames in a 2x2 grid on white background. Character faces toward the viewer.
Frame 1 (top-left): Wind-up/anticipation — preparing to strike. Frame 2 (top-right): Attack in motion — strike unleashed downward.
Frame 3 (bottom-left): Impact/peak — maximum extension. Frame 4 (bottom-right): Recovery — returning to ready stance.
Detailed 32-bit pixel art style. Same character design in all frames.`,

  'attack-up': `Create a 4-frame pixel art ATTACK animation walking UPWARD (away from camera) in top-down isometric RPG perspective.
Show the attack from BEHIND, using the same attack type as the reference.
Arrange the 4 frames in a 2x2 grid on white background.
Frame 1 (top-left): Wind-up/anticipation — same motion seen from behind. Frame 2 (top-right): Attack unleashed upward.
Frame 3 (bottom-left): Impact/peak — same attack type. Frame 4 (bottom-right): Recovery.
Detailed 32-bit pixel art style. MUST use the same attack style as reference.`,

  'attack-side': `Create a 4-frame pixel art ATTACK animation to the SIDE (right) in top-down isometric RPG perspective.
Show the character's SIDE PROFILE facing RIGHT performing the same attack as the reference.
Arrange the 4 frames in a 2x2 grid on white background.
Frame 1 (top-left): Wind-up from side view, facing right. Frame 2 (top-right): Strike unleashed to the right.
Frame 3 (bottom-left): Impact/peak. Frame 4 (bottom-right): Recovery.
Detailed 32-bit pixel art style. MUST use the same attack style as reference.`,

  'idle-iso': `Create a 4-frame pixel art idle/breathing animation in top-down isometric RPG perspective.
The character faces toward the camera (south/down). Arrange the 4 frames in a 2x2 grid on white background.
Frame 1 (top-left): Neutral standing pose — relaxed stance. Frame 2 (top-right): Slight inhale — body rises subtly.
Frame 3 (bottom-left): Full breath — slight upward posture. Frame 4 (bottom-right): Exhale — returning to neutral.
Keep movements subtle. Same character design in all frames.`,
};

// Aspect ratios for each sprite type
export const SPRITE_ASPECT_RATIOS = {
  walk: '1:1', jump: '1:1', attack: '21:9', idle: '1:1',
  'walk-down': '1:1', 'walk-up': '1:1', 'walk-side': '1:1',
  'attack-down': '9:16', 'attack-up': '9:16', 'attack-side': '16:9',
  'idle-iso': '1:1',
};

// ─── Parallax Background Prompts ─────────────────────────────────────────────

export const PARALLAX_PROMPTS = {
  layer1: (characterPrompt) =>
    `Create the SKY/BACKDROP layer for a side-scrolling pixel art game parallax background for a character: "${characterPrompt}".
This is the FURTHEST layer — only sky and very distant elements (distant mountains, clouds, horizon).
Style: Pixel art, 32-bit retro game aesthetic. Wide panoramic scene, aspect ratio 21:9.`,

  layer2: `Create the MIDDLE layer of a 3-layer parallax background for a side-scrolling pixel art game.
I've sent you images of: 1) the character, 2) the background/sky layer already created.
Create the character's ICONIC location from their story — home village, famous landmarks, signature battlegrounds.
Elements should fill the frame from middle down to bottom.
IMPORTANT: Use a solid, uniform chroma-key background color for clean cutout processing. Do NOT draw any pattern, grid, or checkerboard — the background must be one flat solid color.`,

  layer3: `Create the FOREGROUND layer of a 3-layer parallax background for a side-scrolling pixel art game.
I've sent you images of: 1) the character, 2) the background/sky layer, 3) the middle layer.
Create the closest foreground elements (ground, grass, rocks, platforms) that complete the scene.
IMPORTANT: Use a solid, uniform chroma-key background color for clean cutout processing. Do NOT draw any pattern, grid, or checkerboard — the background must be one flat solid color.`,
};

// ─── Animation Sequence Prompts ──────────────────────────────────────────────

export const ANIMATION_SEQUENCES = {
  player_idle: {
    name: 'Player Idle',
    frames: 4,
    prompt: (refImage) =>
      `Generate a 4-frame pixel art IDLE animation sequence of the character shown in the reference image.
Each frame shows a subtle breathing/idle movement. Maintain exact character appearance across all frames.
Output a single image with 4 frames arranged horizontally (1×4 grid) on white background.
Detailed 32-bit pixel art style, consistent character design.`,
  },
  player_run: {
    name: 'Player Run',
    frames: 6,
    prompt: (refImage) =>
      `Generate a 6-frame pixel art RUN/WALK CYCLE animation sequence of the character shown in the reference image.
Each frame shows a different phase of the running motion. Maintain exact character appearance across all frames.
Output a single image with 6 frames arranged in a 2×3 grid (2 rows, 3 columns) on white background.
Detailed 32-bit pixel art style, consistent character design.`,
  },
  player_jump: {
    name: 'Player Jump',
    frames: 2,
    prompt: (refImage) =>
      `Generate a 2-frame pixel art JUMP animation sequence of the character shown in the reference image.
Frame 1: Character in air, legs tucked up, ascending. Frame 2: Landing, slight crouch to absorb impact.
Maintain exact character appearance. Output as a single image with 2 frames side-by-side on white background.
Detailed 32-bit pixel art style.`,
  },
  player_shoot: {
    name: 'Player Shoot',
    frames: 3,
    prompt: (refImage) =>
      `Generate a 3-frame pixel art SHOOT animation sequence of the character shown in the reference image.
Frame 1: Wind-up/aiming. Frame 2: Firing — weapon/spell unleashed. Frame 3: Recovery.
Maintain exact character appearance. Output as a single image with 3 frames side-by-side on white background.
Detailed 32-bit pixel art style.`,
  },
  player_hurt: {
    name: 'Player Hurt',
    frames: 2,
    prompt: (refImage) =>
      `Generate a 2-frame pixel art HURT/RECOIL animation sequence of the character shown in the reference image.
Frame 1: Impact — character recoils from hit. Frame 2: Recovery — returning to neutral stance.
Maintain exact character appearance. Output as a single image with 2 frames side-by-side on white background.
Detailed 32-bit pixel art style.`,
  },
  enemy_idle: {
    name: 'Enemy Idle',
    frames: 4,
    prompt: (refImage) =>
      `Generate a 4-frame pixel art IDLE animation sequence of an ENEMY character (aggressive posture, menacing).
Each frame shows subtle breathing/idle movement. Maintain exact character appearance across all frames.
Output a single image with 4 frames arranged horizontally (1×4 grid) on white background.
Detailed 32-bit pixel art style, consistent enemy design.`,
  },
  enemy_run: {
    name: 'Enemy Run',
    frames: 4,
    prompt: (refImage) =>
      `Generate a 4-frame pixel art RUN/WALK CYCLE animation sequence of an ENEMY character.
Each frame shows a different phase of running toward the player. Maintain exact character appearance.
Output as a single image with 4 frames in a 2×2 grid on white background.
Detailed 32-bit pixel art style.`,
  },
  enemy_attack: {
    name: 'Enemy Attack',
    frames: 4,
    prompt: (refImage) =>
      `Generate a 4-frame pixel art ATTACK animation sequence of an ENEMY character.
Frame 1 (top-left): Wind-up/anticipation. Frame 2 (top-right): Attack in motion.
Frame 3 (bottom-left): Impact/peak. Frame 4 (bottom-right): Recovery.
Output as a 2×2 grid on white background. Maintain exact character appearance.
Detailed 32-bit pixel art style.`,
  },
};

// ─── Effects Prompts ─────────────────────────────────────────────────────────

export const EFFECT_PROMPTS = {
  bullet_trail: `Generate a pixel art bullet projectile sprite. A small fast-moving bullet or bullet trail on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  bullet_impact: `Generate a pixel art bullet impact/hit effect sprite. Sparks, flash, or explosion fragment on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  fire_ball: `Generate a pixel art fire ball/projectile sprite. A glowing ball of fire on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  fire_explosion: `Generate a pixel art fire explosion effect sprite. Explosive fire burst on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  explosion: `Generate a pixel art explosion effect sprite. Fire and debris burst on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  smoke: `Generate a pixel art smoke/particle effect sprite. Wisp of smoke on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
  spark: `Generate a pixel art spark effect sprite. Bright spark or energy fragment on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style. Square aspect ratio.`,
};

// ─── Weapon Prompts ──────────────────────────────────────────────────────────

export const WEAPON_PROMPTS = {
  assault_rifle: `Generate a pixel art assault rifle sprite (AK-47 style). Side profile view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style with metallic sheen.`,
  pistol_9mm: `Generate a pixel art 9mm pistol sprite. Side profile view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style with metallic sheen.`,
  pump_shotgun: `Generate a pixel art pump-action shotgun sprite. Side profile view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style.`,
  bolt_action: `Generate a pixel art bolt-action rifle sprite (Kar98k style). Side profile view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style.`,
  sword: `Generate a pixel art sword sprite. Side view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style with metallic sheen.`,
  magic_staff: `Generate a pixel art magic staff/wand sprite. Side view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style.`,
  helmet: `Generate a pixel art helmet sprite. Front/side view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style.`,
  vest: `Generate a pixel art ballistic vest sprite. Front view on solid green background (uniform flat single color, no pattern, chroma key).
Detailed 32-bit pixel art style.`,
};

// ─── Cutout Validation Result Type ───────────────────────────────────────────

/**
 * @typedef {Object} CutoutValidation
 * @property {boolean} size_ok
 * @property {boolean} mode_ok
 * @property {boolean} corners_ok
 * @property {boolean} transparent_ratio_ok
 * @property {boolean} border_ok
 * @property {number[]} corner_alphas
 * @property {number} transparent_ratio
 * @property {number} border_ratio
 * @property {boolean} all_ok
 * @property {[number,number,number,number]} bbox
 */
