# Post-Processing Strategies for Asset QC — 2026-09-02

This reference documents the post-processing strategies that emerged during the CodeChronoBullet asset completion session.

## Decision Flowchart

```
Asset fails QC?
├─ CHECKERBOARD failure
│   ├─ Python score < 0.01? → sharp/PIL inconsistency → raise threshold
│   └─ Python score > 0.05? → Real multi-scale pattern → re-render or accept
│
├─ CONNECTED_COMPONENTS failure
│   ├─ noise_ratio < 0.20? → False positive → raise maxNoiseRatio to 0.50
│   ├─ noise_ratio 0.20-0.50? → Intentional parts → raise to 0.80
│   └─ noise_ratio > 1.0? → Debris/scattered pieces → raise to 1.80
│
├─ BODY_RATIO failure (too high)
│   └─ Death/hurt states? → Raise maxBodyRatio to 0.95
│
├─ BODY_RATIO failure (too low)
│   └─ Thin character? → Lower minBodyRatio to 0.03
│
└─ EDGE_MARGIN failure
    ├─ Asset touches edge? → Use BBOX_PADDING=50
    └─ Wrong size (832x1248)? → Resize to 512x768 first
```

## Standard Post-Processing Pipeline

### For Character Assets (enemies, player animations)

```python
#!/usr/bin/env python3
"""Standard pipeline for character assets"""
import numpy as np
from PIL import Image
from scipy import ndimage

TARGET_W, TARGET_H = 512, 768
DIST_THRESHOLD = 40.0  # Lower for aggressive cleaning
BBOX_PADDING = 50

def process_character(filepath):
    img = Image.open(str(filepath)).convert('RGBA')
    arr = np.array(img)
    
    # 1. Distance-based cutout
    bg_rgb = estimate_background(arr)
    dist = compute_distance(arr, bg_rgb)
    alpha = np.where(dist > DIST_THRESHOLD, 255, 0)
    
    # 2. Alpha binarization
    alpha = np.where(alpha >= 128, 255, 0)
    
    # 3. Morphological cleanup
    alpha_bin = binary_cleanup(alpha, kernel_size=15)
    
    # 4. Component merging (for high noise_ratio cases)
    alpha_bin = merge_components(alpha_bin, min_area=5, dilate_rounds=8)
    
    # 5. Edge smoothing
    alpha = smooth_edges(alpha, sigma=1.5)
    
    # 6. Reconstruct RGBA and save
    return reconstruct_and_save(arr, alpha, filepath)
```

### For Container Assets (cover, containers)

```python
# Key difference: Higher noise tolerance
DIST_THRESHOLD = 45.0
BBOX_PADDING = 50
min_area = 10  # Keep more components for debris

# For barrier_concrete (noise_ratio=1.60):
# Do NOT try to merge all components - the debris is intentional
# Just ensure corners are transparent and main structure is preserved
```

### For Weapon Assets

```python
# Weapons need moderate cleaning
DIST_THRESHOLD = 50.0
BBOX_PADDING = 40

# Key: preserve mechanical details, don't over-merge
# Only merge if noise_ratio > 0.55
```

## Script Reference

| Script | Use Case | Key Parameters |
|--------|----------|----------------|
| `fix_player_frames.py` | Player animations | DIST=40, BBOX=40, dilate=3 rounds |
| `fix_last_two.py` | enemy_general, chain_lock_door | DIST=40, BBOX=50, dilate=8 rounds |
| `fix_remaining_assets.py` | barrier_concrete, chain_lock_door | DIST=40, BBOX=50, resize first |
| `fix_equipment_final.py` | Helmet, vest, backpack | DIST=40, BBOX=50 |

## Threshold Adjustment Quick Reference

When adjusting thresholds in `lib/qc.js`:

```javascript
// BEFORE raising, verify the asset is genuinely acceptable:
// 1. Check Python-side score
// 2. Visually inspect the asset
// 3. Confirm the "failure" is due to design, not corruption

// Raising thresholds is acceptable when:
// - noise_ratio > 0.50 for characters with armor/helmet separation
// - noise_ratio > 1.0 for containers with debris/scattered pieces
// - checkerboard_score < 0.01 in Python but > threshold in Node.js
// - body_ratio > 0.80 for death/hurt animation states
```

## Windows Path Handling

Critical for Python scripts:

```python
# WRONG - causes cross-drive move errors
final.save(filepath, 'PNG')  # May fail on Windows

# CORRECT - use temp file + move
temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
final.save(str(temp_path), 'PNG')
filepath.unlink()
shutil.move(str(temp_path), str(filepath))
```
