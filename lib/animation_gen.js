/**
 * Animation sequence generation — multi-frame sprite sheets with reference consistency.
 */
import { ok, err, ErrorCode, artifact } from './result.js';
import { getProviderConfig } from './config.js';
import { generateImage } from './image_gen.js';
import { ANIMATION_SEQUENCES } from './prompts.js';
import { saveGeneratedImage } from './utils.js';

/**
 * Generate an animation sequence from a reference image.
 * @param {object} args
 * @param {string} args.sequence — key from ANIMATION_SEQUENCES
 * @param {string} args.reference_image_path — path to reference character image
 * @param {string} [args.provider] — AI provider (default: config default)
 * @param {string} [args.output_path] — output path
 * @param {object} [ctx] — DSH context
 */
export async function generateAnimationSequence(args) {
  const {
    sequence,
    reference_image_path,
    provider,
    output_path,
  } = args;

  if (!sequence) return err(ErrorCode.INVALID_ARGUMENT, 'sequence is required', { stage: 'validation' });
  if (!reference_image_path) return err(ErrorCode.INVALID_ARGUMENT, 'reference_image_path is required', { stage: 'validation' });

  const seqDef = ANIMATION_SEQUENCES[sequence];
  if (!seqDef) return err(ErrorCode.INVALID_ARGUMENT, `Unknown sequence: ${sequence}. Available: ${Object.keys(ANIMATION_SEQUENCES).join(', ')}`, { stage: 'validation' });

  // Check if reference image exists
  const fs = await import('fs');
  const path = await import('path');
  const absRef = path.resolve(reference_image_path);
  if (!fs.existsSync(absRef)) return err(ErrorCode.FILE_NOT_FOUND, `Reference image not found: ${reference_image_path}`, { stage: 'validation' });

  // Build prompt with reference image info
  const prompt = seqDef.prompt(absRef);

  // Determine provider
  const cfg = await import('./config.js');
  const config = cfg.loadConfig();
  const providerId = provider || config.defaultProvider || 'agnes';

  // Get provider config
  const providerConfig = getProviderConfig(providerId);
  if (!providerConfig) return err(ErrorCode.INVALID_ARGUMENT, `Unknown provider: ${providerId}`, { stage: 'validation' });
  if (providerConfig.requiresApiKey && !providerConfig.apiKey) {
    return err(ErrorCode.PROVIDER_NOT_CONFIGURED, `API key required for ${providerConfig.name}`, { stage: 'provider' });
  }

  try {
    const genArgs = {
      provider: providerId,
      prompt,
      width: seqDef.frames <= 4 ? 1024 : 2048,
      height: seqDef.frames <= 4 ? 1024 : 1024,
      num_images: 1,
    };

    const gen = await generateImage(genArgs);
    if (!gen.success) return gen;
    if (!gen.images || gen.images.length === 0) return err(ErrorCode.PROCESSING_FAILED, 'No images generated', { stage: 'processing' });

    const outPath = output_path || `./output/${sequence}_anim.png`;
    const absPath = saveGeneratedImage(gen.images[0].data, gen.images[0].mimeType, outPath);

    return ok({
      output_path: absPath,
      sequence,
      frames: seqDef.frames,
      provider: providerId,
    }, { artifacts: [artifact('image', absPath, { mime_type: 'image/png' })] });
  } catch (e) {
    return err(ErrorCode.INTERNAL_ERROR, e.message, { stage: 'processing', cause: e.stack });
  }
}

/**
 * List all available animation sequences.
 */
export function listAnimationSequences() {
  return ok(Object.entries(ANIMATION_SEQUENCES).map(([key, def]) => ({
    id: key,
    name: def.name,
    frames: def.frames,
  })));
}
