# Phased CoverProp Asset Pipeline

## Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Phase 1       │────▶│   User Review   │────▶│   Phase 2       │
│ Generate + QC   │     │  (Approve/      │     │ Cutout + Post-  │
│                 │     │   Reject)       │     │ Processing      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Tools

### `sprite_generate_cover_prop_phase1`
Phase 1: Generate image and run QC preview.
- Input: prop_id, prompt, material_type, cover_height, width, height, provider
- Output: Image saved to `output/phase1_previews/`, manifest.json, QC status
- Asset added to review queue for user approval

### `sprite_list_pending_reviews`
List all assets awaiting user approval.
- Shows prop_id, QC status, generated timestamp
- User can view images before approving

### `sprite_approve_cover_prop`
Approve an asset for Phase 2 processing.
- Input: prop_id, candidate_dir
- Marks asset as approved in review queue
- Ready for cutout and post-processing

### `sprite_process_cover_prop_phase2`
Process approved assets: cutout, post-processing, Godot export.
- Input: prop_id, candidate_dir, godot_project_path (optional)
- Outputs: Final assets with cut background
- Optional: Generate Godot scene (.tscn)

## Usage Example

```javascript
// Phase 1: Generate and preview
const gen = await tools.callTool("sprite_generate_cover_prop_phase1", {
  prop_id: "sandbag_wall_v2",
  prompt: "War-survival graphic-novel style sandbag wall...",
  material_type: "fabric",
  cover_height: "low",
  width: 128,
  height: 128,
  provider: "agnes"
});

// List pending reviews
const reviews = await tools.callTool("sprite_list_pending_reviews", {});

// User reviews and approves
await tools.callTool("sprite_approve_cover_prop", {
  prop_id: "sandbag_wall_v2",
  candidate_dir: gen.data.candidates_dir
});

// Phase 2: Process approved asset
const processed = await tools.callTool("sprite_process_cover_prop_phase2", {
  prop_id: "sandbag_wall_v2",
  candidate_dir: gen.data.candidates_dir,
  godot_project_path: "D:/Projects/CodeChronoBullet"
});
```

## Directory Structure

```
output/
├── phase1_previews/          # Generated images awaiting approval
│   ├── candidates/           # Raw generated assets
│   │   └── cover_<timestamp>/
│   │       ├── <prop_id>_intact.png
│   │       ├── <prop_id>_rubble.png
│   │       └── manifest.json
│   └── rejected/             # Failed QC assets
├── phase2_approved/          # Processed assets
│   └── <prop_id>/
│       ├── <prop_id>_intact.png
│       ├── <prop_id>_rubble.png
│       └── <prop_id>.tscn (optional)
└── review_queue.json         # Pending approval list
```
