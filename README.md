# sprite-gen-mcp

Sprite Sheet Generator as a standalone MCP server. No DeepSeek Harness required.

## Tools

| Tool | Description |
|------|-------------|
| `sprite__config` | Manage API keys, providers, defaults |
| `sprite_generate_image` | AI image + sprite sheet generation |
| `sprite__sheet` | Convert image to sprite sheet |
| `sprite_cutout` | Background removal + validation |
| `sprite__info` | View plugin info |
| `sprite_animation_sequence` | Generate animation from reference image |
| `sprite_animation_list` | List available animations |
| `sprite_generate_effect` | Generate effect sprites |
| `sprite_effect_list` | List available effects |
| `sprite_generate_weapon` | Generate weapon sprites |
| `sprite_weapon_list` | List available weapons |
| `sprite_batch_generate` | Batch generate multiple sprites |
| `sprite_batch_process` | Batch process images through pipeline |
| `sprite_generate_background` | Generate 3-layer parallax background |
| `sprite_preview_gif` | Generate animated GIF preview from sprite sheet |
| `sprite_export_godot` | Export sprite sheet to Godot 4 SpriteFrames .tres |
| `sprite_detect_animations` | Auto-detect grid and suggest animation ranges |
| `sprite_session_list` | List all generation sessions with history |
| `sprite_edit` | Iteratively edit a sprite via natural language |
| `sprite_autotile` | Generate 16 autotile variants for seamless tilemaps |
| `sprite_video_to_sheet` | Convert video clip to pixel-art sprite sheet |
| `sprite_extract_video_frames` | Extract individual frames from video |
| `sprite_style_list` | List available art style presets |
| `sprite_export_tpacker` | Export to TexturePacker JSON (Unity/Godot) |
| `sprite_export_aseprite` | Export to Aseprite JSON format |
| `sprite_export_godot_scene` | Generate a Godot .tscn scene with Sprite2D |
| `sprite_palette_extract` | Extract color palette from an image |
| `sprite_qc_report` | Quality control report: edge-touch, empty frames, diversity |
| `sprite_godot_import` | Import sprite sheet into Godot project (creates .tres + .import) |
| `sprite_godot_add_animation` | Add animation to existing SpriteFrames .tres |
| `sprite_godot_wire_animations` | Wire animations into scene's AnimationPlayer |
| `sprite_godot_scan` | Scan Godot project for scenes, resources, sprite nodes |

## Art Styles (35 presets)

| Style | Category | Description |
|-------|----------|-------------|
| `pixel_art` | Art | Classic 16-bit retro pixel art with crisp edges |
| `pixel_perfect` | Art | Ultra-clean, no anti-aliasing, hard pixel edges |
| `retro_pixel` | Art | Authentic 8-bit / 16-bit, 16-color limited palette |
| `clean_hd` | Art | Clean hand-painted HD, Studio Ghibli inspired |
| `pixel_inspired` | Art | Modern pixel aesthetic at higher resolution |
| `watercolor` | Art | Soft whimsical watercolor painting |
| `neon_cyber` | Art | Glowing neon cyberpunk / synthwave |
| `stained_glass` | Art | Vibrant jewel-tone stained glass |
| `cartoon` | Art | Bold cartoon, thick outlines, flat colors |
| `manga` | Art | Japanese anime/manga style |
| `low_poly` | Art | Polygonal 3D, flat-shaded geometric |
| `vector` | Art | Clean vector, geometric flat design |
| `woodcut` | Art | Traditional printmaking, bold ink lines |
| `ink_wash` | Art | Eastern ink wash, atmospheric monochrome |
| `comic_book` | Art | Western comic, halftone dots, bold inks |
| `fantasy` | Character | High-fantasy RPG, armor and magic |
| `sci_fi` | Character | Futuristic sci-fi, tech armor, neon |
| `horror` | Character | Dark horror, grotesque, eerie |
| `painterly` | Character | Expressive brush strokes, textured |
| `simple` | Character | Minimal, bold shapes, limited palette |
| `top_down` | Character | Isometric top-down RPG view |
| `platformer` | Character | Side-scrolling platformer, dynamic poses |
| `isometric` | Tile | Isometric 3D-looking 2D tiles |
| `hexagonal` | Tile | Hex grid strategy game tiles |
| `dungeon` | Tile | Dark dungeon/roguelike tileset |
| `fps_weapon` | UI | First-person shooter weapon, side profile |
| `spell_icon` | UI | Circular skill/magic icon |
| `ui_panel` | UI | Decorative game UI panel/frame |
| `inventory` | UI | Standalone inventory item icon |
| `typography` | UI | Stylized game title/logo text |
| `walk_4dir` | Animation | Top-down 4-direction walk cycle |
| `walk_idle` | Animation | Combined walk + idle animation rows |
| `vfx_effects` | Animation | Spell/particle/explosion VFX |
| `small_sprites` | Animation | Tiny 16x16/32x32 retro mobile sprites |
| `eight_direction` | Animation | Full 8-direction rotation walk cycle |

## Usage Examples

```
# Generate with style
sprite_generate_image(prompt="knight warrior idle pose", style="neon_cyber", provider="agnes")

# Create autotiles
sprite_autotile(image_path="./tile_grass.png", tile_size=[64, 64])

# Video to sprite
sprite_video_to_sheet(video_path="./walk_cycle.mp4", fps=8, pixel_scale=4)

# Export to Godot
sprite_export_godot(image_path="./character.png", cell_width=128, output_path="./character.tres")
```

## Staged CoverProp Approval Workflow

Launch the local review UI with `npm run web`, then open the address printed in the terminal (default `http://127.0.0.1:4317`). If that port is occupied, the server automatically selects the next available port and records it in `output/review-ui.json`. It preserves every rejected revision and requires approval before generating the next stage.

CoverProp assets can be generated one stage at a time. A stage never advances without explicit user approval:

Concept creation and concept revision use different generation modes. The first concept is text-to-image. Rejected concept revisions use the current concept as an image-to-image identity reference by default; the user must explicitly choose “restart from text” to discard the design.

```text
concept (text-to-image)
  → approve
intact (image-to-image from concept)
  → approve
rubble (image-to-image from intact)
  → approve
publish concept + intact + rubble
```

1. Call `sprite_generate_cover_prop_phase1` to generate only the concept preview.
2. Review `preview_path`, then call `sprite_approve_cover_prop` with the returned `candidate_dir`.
3. Call `sprite_process_cover_prop_phase2` to generate exactly one next stage.
4. Review and approve the intact preview, then call `sprite_process_cover_prop_phase2` again for rubble.
5. Approving rubble publishes all three retained stage images.

Use `sprite_list_pending_reviews` to retrieve workflows currently waiting for approval. Intact and rubble responses include QC status, rejected rules, and an evidence image, but user approval remains mandatory.

## Providers

- **gemini_flash** — Google Gemini Flash (free tier, API key required)
- **stable_diffusion** — Stable Diffusion API (free tier, API key required)
- **agnes** — Agnes AI (free forever, API key required)
- **comfy** — Local ComfyUI / Stable Diffusion (no API key needed)

## Setup

```bash
cd D:/Projects/MCP/sprite-gen
npm install
```

## Usage with Hermes

```bash
hermes mcp add --command node --args server.js sprite-gen
```

Then in Hermes chat, tools like `sprite_generate_image` will be available automatically.

## Configuration

Set API keys via the `sprite__config` tool:

```
sprite__config(action="set_key", provider="agnes", api_key="your_key")
sprite__config(action="set_provider", provider="comfy")
```

Or edit `config/settings.json` directly.

## Requirements

- Node.js >= 18
- Python 3.8+ with Pillow and numpy
  ```bash
  pip install Pillow numpy
  ```
