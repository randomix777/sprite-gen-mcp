# Synthetic Test Image Generator

Generates synthetic PNG images for cutout pipeline testing.

## Usage

```bash
node scripts/make_synth.mjs <width> <height> <background_color> <output_path>
```

## Parameters

- `width` — canvas width in pixels (default: 128)
- `height` — canvas height in pixels (default: 128)
- `background_color` — object `{r, g, b}` or string `'magenta'|'green'|'transparent'`
- `output_path` — path to write PNG file

## Generated Test Cases

### 1. Pure Magenta Background (QC-APPROVED after cutout)

```bash
node scripts/make_synth.mjs 128 128 magenta output/synth_magenta.png
```
- RGB: {r:255, g:0, b:255}
- After cutout: alpha channel added, CHECKERBOARD=0
- Expected: APPROVED

### 2. Pure Green Background (QC-APPROVED after cutout)

```bash
node scripts/make_synth.mjs 128 128 green output/synth_green.png
```
- RGB: {r:0, g:255, b:0}
- After cutout: alpha channel added, CHECKERBOARD=0
- Expected: APPROVED

### 3. Checkerboard Background (QC-REJECTED)

```bash
node scripts/make_synth.mjs 128 128 checkerboard output/synth_checker.png
```
- AI will render checkerboard pattern
- Expected: REJECTED (demonstrates the anti-pattern)

### 4. Transparent Background (QC-REJECTED without cutout)

```bash
node scripts/make_synth.mjs 128 128 transparent output/synth_trans.png
```
- No alpha in Agnes API output
- After cutout: alpha added, but may have edge artifacts
- Expected: Conditional on cutout quality

## Script Logic

1. Use `sharp` to create canvas with specified background
2. Optionally composite a centered body rectangle
3. Output PNG buffer to specified path
4. No LLM calls — purely synthetic generation

## Verification

Run alongside `scripts/verify_cutout_chain.mjs` to confirm
cutout + QC pipeline behavior for each background type.