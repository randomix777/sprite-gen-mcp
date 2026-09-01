/**
 * Configuration manager for dsh-sprite-gen
 * 
 * Supports multiple image generation providers with custom configuration.
 *
 * Security:
 *   - API keys are never logged
 *   - Error messages never contain API keys or auth headers
 *   - Config file is written atomically
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ok, err, ErrorCode } from './result.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

/** Supported image generation providers */
export const IMAGE_PROVIDERS = {
  // Free providers
  gemini_flash: {
    name: 'Google Gemini Flash',
    description: 'Free tier with generous limits (20 req/min)',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.0-flash-exp',
    requiresApiKey: true,
    freeTier: true,
    maxImages: 60,
    rateLimit: '20 requests per minute'
  },
  stable_diffusion: {
    name: 'Stable Diffusion (free)',
    description: 'Free public API (100 images/day)',
    baseUrl: 'https://stable-diffusionapi.com/api/v5',
    model: 'sdxl',
    requiresApiKey: true,
    freeTier: true,
    maxImages: 100,
    rateLimit: '10 requests per minute'
  },
  agnes: {
    name: 'Agnes AI',
    description: 'High quality artistic images (Free forever)',
    baseUrl: 'https://apihub.agnes-ai.com/v1/images/generations',
    model: 'agnes-image-2.1-flash',
    requiresApiKey: true,
    freeTier: true,
    maxImages: Infinity,
    rateLimit: 'Unlimited'
  },
  comfy: {
    name: 'ComfyUI (Local SD)',
    description: 'Local Stable Diffusion via ComfyUI (free, no API key needed)',
    baseUrl: 'http://127.0.0.1:8188',
    model: 'sdxl',
    requiresApiKey: false,
    freeTier: true,
    maxImages: Infinity,
    rateLimit: 'Unlimited (depends on GPU)'
  }
};

/**
 * Provider capability matrix — which features each provider supports.
 * Native alpha: provider returns true RGBA PNGs reliably.
 * Image-to-image: provider accepts reference images (URL or base64).
 * Negative prompt: provider accepts negative_prompt parameter.
 */
export const PROVIDER_CAPABILITIES = {
  gemini_flash: {
    native_alpha: true,
    image_to_image: false,
    negative_prompt: false,
    seed: false,
    supported_formats: ['png'],
  },
  stable_diffusion: {
    native_alpha: true,
    image_to_image: false,
    negative_prompt: true,
    seed: true,
    supported_formats: ['png', 'jpeg'],
  },
  agnes: {
    native_alpha: false,
    image_to_image: true,
    negative_prompt: true,
    seed: true,
    solid_chroma: true,
    requires_post_cutout: true,
    supported_formats: ['png'],
  },
  comfy: {
    native_alpha: false,
    image_to_image: false,
    negative_prompt: true,
    seed: true,
    solid_chroma: false,
    requires_post_cutout: true,
    supported_formats: ['png'],
  },
};

/** Default configuration */
const DEFAULT_CONFIG = {
  defaultProvider: 'gemini_flash',
  providers: {},
  spriteSheet: {
    defaultGridCols: 4,
    defaultGridRows: 4,
    defaultCropMode: 'auto',
    defaultSpacing: 0,
    defaultCellWidth: 32,
    defaultCellHeight: 32,
    outputDir: './output'
  },
  credentials: {
    gemini_flash: { apiKey: '' },
    stable_diffusion: { apiKey: '' },
    agnes: { apiKey: '' }
  }
};

/**
 * Load configuration
 */
export function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    // Don't log full error which might contain sensitive info from the file
    console.error('[sprite-gen] Failed to load config:', e.code || 'parse error');
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration
 */
export function saveConfig(config) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return ok(null);
  } catch (e) {
    return err(ErrorCode.OUTPUT_WRITE_FAILED, e.message, { stage: 'export' });
  }
}

/**
 * Get provider configuration
 */
export function getProviderConfig(provider) {
  const config = loadConfig();
  const providerConfig = IMAGE_PROVIDERS[provider];
  if (!providerConfig) return null;

  const cap = PROVIDER_CAPABILITIES[provider] || {};
  const cred = config.credentials?.[provider] || {};
  return {
    ...providerConfig,
    ...cap,
    ...cred,
    apiKey: cred.apiKey || cred.api_key || '',
    baseUrl: cred.baseUrl || cred.base_url || providerConfig.baseUrl || '',
    model: cred.model || providerConfig.model || ''
  };
}

/**
 * Set provider configuration
 */
export function setProviderConfig(provider, settings) {
  const config = loadConfig();
  if (!config.credentials) config.credentials = {};
  if (!config.credentials[provider]) config.credentials[provider] = {};
  
  Object.assign(config.credentials[provider], settings);
  return saveConfig(config);
}

/**
 * Get all providers
 */
export function listProviders() {
  return Object.entries(IMAGE_PROVIDERS).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description,
    requiresApiKey: config.requiresApiKey,
    freeTier: config.freeTier || false
  }));
}

/**
 * Validate configuration
 */
export function validateConfig(config) {
  const errors = [];
  
  if (!config.defaultProvider || !IMAGE_PROVIDERS[config.defaultProvider]) {
    errors.push('Invalid default provider');
  }
  
  // Check API keys for required providers
  for (const [provider, settings] of Object.entries(config.credentials || {})) {
    const providerConfig = IMAGE_PROVIDERS[provider];
    if (providerConfig?.requiresApiKey && !settings?.apiKey) {
      errors.push(`Missing API key for ${providerConfig.name}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get current configuration summary
 */
export function getConfigSummary() {
  const config = loadConfig();
  const providers = listProviders();
  
  return {
    defaultProvider: config.defaultProvider,
    providers: providers.map(p => ({
      ...p,
      configured: !!config.credentials?.[p.id]?.apiKey
    }))
  };
}

