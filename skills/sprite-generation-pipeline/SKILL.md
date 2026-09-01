# Sprite Generation Pipeline — Class-Level Skill

**Trigger**: Use when generating game sprites via AI image generation pipeline (Agnes/ComfyUI/Gemini), especially when involving rubble/destruction states, background generation, or cutout post-processing.

**One-line behavior**: Generate valid sprites with solid uniform backgrounds (no checkerboard), proper cutout wiring, and QC-approved output; avoid chroma-key terminology that AI models misinterpret as patterns.

## ─── Prompt Construction ────────────────────────────────────────────────

### Rubble State Prompt (PRIMARY)

**Before** — DO NOT use (causes AI to render checkerboard/fake transparency):

```
Generate the destroyed/rubble version of this game prop: {prompt}.
Material: {materialType}. The prop is broken apart into debris pieces.
Keep the same canvas size {width}x{height} and material appearance.
Isolated on solid chroma-key background. No text or watermarks.
```

**After** — USE THIS (verified QC-approved):

```
Generate the destroyed/rubble version of this game prop: {prompt}.
Material: {materialType}. The prop is broken apart into debris pieces.
Keep the same canvas size {width}x{height} and material appearance.
Solid uniform background, flat single color, no pattern, no checkerboard. No text or watermarks.
```

**Why**: The phrase "chroma-key background" triggers the AI model (agnes-image-2.1-flash) to render a checkerboard pattern (score 0.012-0.033 vs threshold 0.001). Replacing with "solid uniform background, flat single color, no pattern, no checkerboard" eliminates the pattern and enables QC pass.

### Intact State Prompt

Use "solid {color} background (uniform flat single color, no pattern, chroma key)" suffix from STYLE_PRESETS (prompts.js lines 77, 95, 121). Verified 118/118 QC passes.

### Cutout Post-Processing

For providers marked `requires_post_cutout: true` (agnes, comfy):

1. Call `runPythonScript(command='cutout', image_path=..., output_path=...)`
2. Read `cutoutResult.output_path` (NOT `cutoutResult.data?.cutout_path`)
3. Replace `img.data` base64 with output PNG data
4. Update `img.mimeType` = 'image/png', `img.format` = 'png'

**Key fix**: `cutoutResult.output_path` was originally `cutoutResult.data?.cutout_path` — verify actual top-level key.

## ─── QC & Verification ────────────────────────────────────────────────

- **QC CHECKERBOARD test**: score must be 0. Any non-zero score indicates background pattern issue.
- **TRANSPARENCY_RATIO / BODY_RATIO**: must compute correctly after cutout.
- **13/13 rules**: All QC rules must pass for APPROVED verdict.
- **Godot gate**: Requires `GODOT4_BIN` environment variable set to Godot 4 binary path.

## ─── Known Pitfalls ────────────────────────────────────────────────────

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| "chroma-key background" in rubble prompt | CHECKERBOARD score > 0, QC REJECTED | Replace with "solid uniform background, flat single color, no pattern, no checkerboard" |
| `cutoutResult.data?.cutout_path` | undefined, cutout not applied | Use `cutoutResult.output_path` |
| Missing `GODOT4_BIN` | godot_gate BLOCKED, exit code 2 | Set `export GODOT4_BIN="D:/Godot_v4.7.2-stable_win64.exe"` |
| Agnes API 503 rate limit | Provider returns HTML/503 instead of images | Retry later; code path verified via synthetic images |

## ─── Support Files ────────────────────────────────────────────────────

### references/

- `references/qc-gate-spec.md` — QC gate assertion shapes and status values
- `references/prompt-patterns.md` — Condensed prompt pattern library for sprites

### templates/

- `templates/generate_sprites.mjs` — Batch generation driver with solid background prompts
- `templates/check_qc_status.mjs` — Minimal QC verification script

### scripts/

- `scripts/verify_cutout_chain.mjs` — End-to-end cutout pipeline verification
- `scripts/make_synth.mjs` — Synthetic test image generator

## ─── Verification History ─────────────────────────────────────────────

- **2026-08-31**: Verified pure color background + cutout → APPROVED (13/13 QC rules pass)
- **2026-08-31**: Verified rubble prompt "chroma-key" → CHECKERBOARD failure (score 0.012-0.033)
- **2026-08-31**: Fixed `cutoutResult.output_path` key bug in `lib/image_gen.js`
- **2026-08-31**: Fixed `getProviderConfig` to merge `PROVIDER_CAPABILITIES` (enables `requires_post_cutout` visibility)
- **2026-08-31**: Created `test/agnes_contract.js` for provider config verification
- **2026-08-31**: Commercial test through rate: 12/19 → 18/19 → **target: 19/19**