/**
 * Weapon & equipment layer generation.
 */
import { ok, err, ErrorCode, artifact, unwrapImages } from './result.js';
import { getProviderConfig } from './config.js';
import { generateImage } from './image_gen.js';
import { WEAPON_PROMPTS } from './prompts.js';
import { saveGeneratedImage } from './utils.js';

/**
 * Generate a weapon/equipment sprite.
 * @param {object} args
 * @param {string} args.weapon — key from WEAPON_PROMPTS
 * @param {string} [args.provider]
 * @param {string} [args.output_path]
 * @param {number} [args.width] — default 128
 * @param {number} [args.height] — default 128
 * @param {object} [ctx]
 */
export async function generateWeapon(args) {
  const {
    weapon,
    provider,
    output_path,
    width = 128,
    height = 128,
  } = args;

  if (!weapon) return err(ErrorCode.INVALID_ARGUMENT, 'weapon is required', { stage: 'validation' });
  const promptText = WEAPON_PROMPTS[weapon];
  if (!promptText) return err(ErrorCode.INVALID_ARGUMENT, `Unknown weapon: ${weapon}. Available: ${Object.keys(WEAPON_PROMPTS).join(', ')}`, { stage: 'validation' });

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
    const unwrapped = unwrapImages(gen);
    if (!unwrapped || unwrapped.images.length === 0) return err(ErrorCode.PROCESSING_FAILED, 'No images generated', { stage: 'processing' });

    const outPath = output_path || `./output/weapons/${weapon}.png`;
    const fs = await import('fs');
    const path = await import('path');
    const absPath = path.resolve(outPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    saveGeneratedImage(unwrapped.images[0].data, unwrapped.images[0].mimeType, absPath);

    return ok({ output_path: absPath, weapon, provider: providerId }, { artifacts: [artifact('image', absPath, { mime_type: 'image/png' })] });
  } catch (e) {
    return err(ErrorCode.INTERNAL_ERROR, e.message, { stage: 'processing', cause: e.stack });
  }
}

/**
 * List all available weapons/equipment.
 */
export function listWeapons() {
  return ok(Object.keys(WEAPON_PROMPTS).map((key) => ({
    id: key,
    description: WEAPON_PROMPTS[key].split('\n')[0],
  })));
}
