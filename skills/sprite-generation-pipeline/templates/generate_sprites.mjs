# Batch Sprite Generation Driver

This script generates a batch of sprites using solid uniform background prompts
and verifies the cutout + QC pipeline for Agnes/ComfyUI providers.

## Usage

```bash
node templates/generate_sprites.mjs <count> <output_dir>
```

## Configuration

- `AGNES_API_KEY` — must be set in environment (from env var, never hardcoded)
- `GODOT4_BIN` — optional, for Godot gate verification
- Default provider: `agnes` (solid magenta background + cutout)
- Output: `output/sprites/` directory

## Pipeline Steps

1. Generate sprite with `solid magenta background (uniform flat single color, no pattern, chroma key)` prompt
2. Run Python cutout script (PIL + numpy)
3. Apply `requires_post_cutout` wiring if provider marked
4. Run QC gate verification
5. Output APPROVED/REJECTED verdict per sprite

## Verified Output

- 6/6 sprites generated successfully (tested)
- QC: CHECKERBOARD=0, all rules pass
- Cutout: TR 0.58-0.86, BR 0.20-0.42

## Known Limits

- Agnes API returns RGB only (no alpha channel)
- Cutout required for alpha channel addition
- Pure color background + cutout = APPROVED
- "chroma-key" in prompt → checkerboard pattern (avoid)