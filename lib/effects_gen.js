/**
 * Effects generation — bullets, fire, particles, explosions.
 */
import { ok, err, ErrorCode, artifact } from './result.js';
import { getProviderConfig } from './config.js';
import { generateImage } from './image_gen.js';
import { EFFECT_PROMPTS } from './prompts.js';
import { saveGeneratedImage } from './utils.js';

/**
 * Generate a sprite effect (bullet, fire, particle, etc.)
 * @param {object} args
 * @param {string} args.effect — key from EFFECT_PROMPTS
 * @param {string} [args.provider]
 * @param {string} [args.output_path]
 * @param {number} [args.width] — default 64
 * @param {number} [args.height] — default 64
 * @param {object} [ctx]
 */
export async function generateEffect(args) {
  const {
    effect,
    provider,
    output_path,
    width = 64,
    height = 64,
  } = args;

  if (!effect) return err(ErrorCode.INVALID_ARGUMENT, 'effect is required', { stage: 'validation' });
  const promptText = EFFECT_PROMPTS[effect];
  if (!promptText) return err(ErrorCode.INVALID_ARGUMENT, `Unknown effect: ${effect}. Available: ${Object.keys(EFFECT_PROMPTS).join(', ')}`, { stage: 'validation' });

  const cfg = await import('./config.js');
  const config = cfg.loadConfig();
  const providerId = provider || config.defaultProvider || 'agnes';
  const providerConfig = getProviderConfig(providerId);
  if (!providerConfig) return err(ErrorCode.INVALID_ARGUMENT, `Unknown provider: ${providerId}`, { stage: 'validation' });
  if (providerConfig.requiresApiKey && !providerConfig.apiKey) {
    return err(ErrorCode.PROVIDER_NOT_CONFIGURED, `API key required for ${providerConfig.name}`, { stage: 'provider' });
  }

  try {
    const gen = await generateImage({
      provider: providerId,
      prompt: promptText,
      width,
      height,
      num_images: 1,
    });
    if (!gen.success) return gen;
    if (!gen.images || gen.images.length === 0) return err(ErrorCode.PROCESSING_FAILED, 'No images generated', { stage: 'processing' });

    const outPath = output_path || `./output/effects/${effect}.png`;
    const fs = await import('fs');
    const path = await import('path');
    const absPath = path.resolve(outPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    saveGeneratedImage(gen.images[0].data, gen.images[0].mimeType, absPath);

    return ok({ output_path: absPath, effect, provider: providerId, size: [width, height] }, { artifacts: [artifact('image', absPath, { mime_type: 'image/png' })] });
  } catch (e) {
    return err(ErrorCode.INTERNAL_ERROR, e.message, { stage: 'processing', cause: e.stack });
  }
}

/**
 * List all available effects.
 */
export function listEffects() {
  return ok(Object.keys(EFFECT_PROMPTS).map((key) => ({
    id: key,
    description: EFFECT_PROMPTS[key].split('\n')[0],
  })));
}
