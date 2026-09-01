# QC Gate Specification

## Status Values

| Status | Numeric | Meaning |
|--------|---------|---------|
| `APPROVED` | 0 | All checks passed, sprite safe for publish |
| `REJECTED` | 1 | Critical failure — do not publish |
| `REVIEW_REQUIRED` | 2 | Needs human review — not APPROVED, not REJECTED |

## QC Checks (run in order)

1. **CHECKERBOARD** — score from 0.0 to 1.0; pass if `< 0.001`
   - Score range 0.012-0.033 = AI rendered checkerboard pattern (fails)
   - Score 0.0 = pure color background passes

2. **TRANSPARENCY_RATIO** — float 0.0 to 1.0
   - Must be `> 0.1` and `< 0.9` (not fully transparent, not fully opaque)
   - After cutout: typically 0.4-0.6

3. **BODY_RATIO** — float 0.0 to 1.0
   - Must be `> 0.3` and `< 0.8` (significant body present)
   - After cutout: typically 0.5-0.6

4. **CONNECTED_COMPONENTS** — integer >= 1
   - After cutout: must be exactly 1 (one contiguous body)
   - 0 = body completely disconnected (failure)

5. **EDGE_MARGIN** — float 0.0 to 1.0
   - Cropped region must not exceed image bounds after clamp
   - Verify: left >= 0, top >= 0, left+width <= canvas_width, top+height <= canvas_height

6. **RGB_COLOR_CHECK** — all three channels must be non-zero for opaque regions
   - After cutout: RGB values should be preserved from original generation

## Output Shape

```json
{
  "status": "APPROVED|REJECTED|REVIEW_REQUIRED",
  "data": {
    "checkerboard_score": 0.0,
    "transparency_ratio": 0.457,
    "body_ratio": 0.543,
    "edge_margin": {
      "left": 10,
      "top": 15,
      "width": 108,
      "height": 108
    },
    "connected_components": 1,
    "evidence_path": "path/to/qc_evidence.png"
  }
}
```

## Failure Behavior

- Any CHECKERBOARD score >= 0.001: REJECTED
- TRANSPARENCY_RATIO outside (0.1, 0.9): REJECTED
- BODY_RATIO outside (0.3, 0.8): REJECTED
- CONNECTED_COMPONENTS != 1: REJECTED
- EDGE_MARGIN out of bounds: REJECTED
- All pass: APPROVED