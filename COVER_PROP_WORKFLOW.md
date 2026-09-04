# CoverProp Production Workflow

## Design principles

The workflow separates design approval from production views and state variants. User approval is a hard gate. No later stage may silently change the approved object identity.

## Target workflow

```text
Design brief
  → concept candidates (text-to-image)
  → concept revision (image-to-image by default)
  → approve design identity
  → select and generate production views
  → approve or regenerate each view independently
  → generate intact / damaged / rubble variants per approved view
  → technical and semantic QC
  → final user approval
  → publish versioned assets and manifest
```

## Concept rules

- The first concept is generated from text.
- A rejected concept is revised from the current image and the user's revision prompt.
- Revision must preserve identity, construction, material, palette, proportions, and style unless explicitly changed.
- “Restart from text” is a separate destructive-design action. It preserves history but does not use the current image as a reference.
- Every revision is stored as a new file; previous images and feedback remain available.

## View rules

- Camera view is a structured preset, not free-form prompt wording.
- View generation happens after design approval.
- Each view is an independent image generated from the approved concept reference.
- A failed view can be regenerated without invalidating approved sibling views.
- Required views must all be approved before state generation.

## State rules

- State variants are generated from an approved production view, never from an unapproved candidate.
- Recommended states are `intact`, `damaged`, and `rubble`.
- Each variant inherits the view, identity, scale, anchor, material, and palette constraints.

## Revision prompt contract

Concept image-to-image prompts must contain four explicit sections:

1. authoritative reference declaration;
2. original design brief and structured camera constraint;
3. properties that must be preserved;
4. the user's requested revision as the only allowed change.

The provider request must include the current concept image in `extra_body.image`. Prompt text alone is not considered a concept revision.
