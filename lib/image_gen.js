/**
 * Image generation module for sprite-gen.
 *
 * Supports multiple AI image generation services.
 * All HTTP requests go through provider_http.js.
 */

import { getProviderConfig } from './config.js';
import { STYLE_PRESETS } from './prompts.js';
import { ok, err, ErrorCode, timer } from './result.js';
import { LIMITS } from './limits.js';
import { validateComfyUrl, sanitizeUrl } from './url_safety.js';
import { providerFetch, cancellableDelay } from './provider_http.js';
import { providerSemaphore } from './concurrency.js';
import { runPythonScript } from './utils.js';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { retryWithBackoff } from './retry.js';

/** Generate image using specified AI provider. */
export async function generateImage(args, ctx) {
  let {
    provider = 'gemini_flash',
    prompt,
    negative_prompt = '',
    width = 1024,
    height = 1024,
    num_images = 1,
    style = 'pixel_art',
    imageUrls,
    signal,
  } = args;

  if (!prompt) {
    return err(ErrorCode.INVALID_ARGUMENT, 'prompt is required', { stage: 'validation' });
  }

  if (prompt.length > LIMITS.text.maxPromptLength) {
    prompt = prompt.slice(0, LIMITS.text.maxPromptLength);
  }

  const styleDef = STYLE_PRESETS[style] || STYLE_PRESETS.pixel_art;
  const finalPrompt = styleDef.prompt_suffix
    ? `${prompt}, ${styleDef.prompt_suffix}`
    : prompt;
  const finalNegative = styleDef.negative_prompt
    ? `${negative_prompt}, ${styleDef.negative_prompt}`.trim()
    : negative_prompt;

  const providerConfig = getProviderConfig(provider);
  if (!providerConfig) {
    return err(ErrorCode.INVALID_ARGUMENT, `Unknown provider: ${provider}`, { stage: 'validation' });
  }

  if (providerConfig.requiresApiKey && !providerConfig.apiKey) {
    return err(ErrorCode.PROVIDER_NOT_CONFIGURED, `API key required for ${providerConfig.name}`, { stage: 'provider' });
  }

  const elapsed = timer();
  const release = await providerSemaphore.acquire();
  try {
    let result;

    switch (provider) {
      case 'gemini_flash':
        result = await generateWithGemini(finalPrompt, providerConfig, { width, height, num_images, signal });
        break;
      case 'stable_diffusion':
        result = await generateWithStableDiffusion(finalPrompt, providerConfig, { width, height, num_images, negative_prompt: finalNegative, signal });
        break;
      case 'agnes':
        result = await generateWithAgnes(finalPrompt, providerConfig, { width, height, num_images, imageUrls, signal });
        break;
      case 'comfy':
        result = await generateWithComfy(finalPrompt, providerConfig, { width, height, num_images, signal });
        break;
      default:
        return err(ErrorCode.UNSUPPORTED_FORMAT, `Unsupported provider: ${provider}`, { stage: 'provider' });
    }

    // Propagate provider-level errors
    if (result.error) {
      return err(result.error.code || ErrorCode.PROCESSING_FAILED, result.error.message || 'Provider returned no images', {
        stage: 'provider',
        retryable: result.error.retryable ?? false,
      });
    }

    // Post-cutout: providers that emit opaque RGB (agnes, comfy) need
    // chroma-key background removal to produce RGBA sprites with alpha.
    if (providerConfig.requires_post_cutout && result.images.length > 0) {
      const tmpDir = path.resolve('output', 'tmp_gen');
      mkdirSync(tmpDir, { recursive: true });
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        const inPath = path.join(tmpDir, `gen_in_${i}.png`);
        const outPath = path.join(tmpDir, `gen_out_${i}.png`);
        writeFileSync(inPath, Buffer.from(img.data, 'base64'));
        const cutoutResult = await runPythonScript({
          command: 'cutout',
          image_path: inPath,
          output_path: outPath,
          dist_threshold: 60,
          corner_region: 8,
          target_width: width,
          target_height: height,
        });
        if (cutoutResult.success && cutoutResult.output_path) {
          const outBuf = readFileSync(cutoutResult.output_path);
          img.data = outBuf.toString('base64');
          img.mimeType = 'image/png';
          img.format = 'png';
        }
        try { unlinkSync(inPath); } catch (_) {}
        try { unlinkSync(outPath); } catch (_) {}
      }
    }

    return ok({
      images: result.images,
      metadata: result.metadata,
      provider,
    }, { duration_ms: elapsed() });
  } catch (e) {
    return err(ErrorCode.INTERNAL_ERROR, e.message, { stage: 'provider', cause: e.stack, duration_ms: elapsed() });
  } finally {
    release();
  }
}

/**
 * Gemini image generation via providerFetch.
 */
async function generateWithGemini(prompt, config, options) {
  const { apiKey, baseUrl, model } = config;
  const { signal } = options;

  const resp = await providerFetch(
    `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: 'image' },
      },
      provider: 'gemini',
      stage: 'provider',
      timeout: LIMITS.timeout.fetchMs || 120000,
      maxResponseBytes: 10 * 1024 * 1024,
      signal,
    }
  );

  if (!resp.success) return { images: [], metadata: {}, error: resp.error };

  const data = resp.data;
  const images = [];
  if (data.candidates && data.candidates.length > 0) {
    for (const candidate of data.candidates) {
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            images.push({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'image/png',
              format: (part.inlineData.mimeType || 'image/png').split('/')[1],
            });
          }
        }
      }
    }
  }

  if (images.length === 0) {
    return { images: [], metadata: { provider: 'gemini', width: options.width, height: options.height }, error: { code: 'PROCESSING_FAILED', message: 'Provider returned no images', retryable: false } };
  }

  return {
    images: images.slice(0, options.num_images || 1),
    metadata: { provider: 'gemini', width: options.width, height: options.height },
  };
}

/**
 * Stable Diffusion WebUI image generation via providerFetch.
 */
async function generateWithStableDiffusion(prompt, config, options) {
  const { apiKey, baseUrl, model } = config;
  const { signal } = options;
  const params = new URLSearchParams({
    prompt,
    negative_prompt: options.negative_prompt || '',
    steps: '30',
    width: String(options.width || 512),
    height: String(options.height || 512),
    batch_size: String(options.num_images || 1),
  });

  const resp = await providerFetch(
    `${baseUrl}/sdapi/v1/txt2img?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        prompt,
        negative_prompt: options.negative_prompt || '',
        steps: 30,
        width: options.width || 512,
        height: options.height || 512,
        batch_size: options.num_images || 1,
      },
      provider: 'stable_diffusion',
      stage: 'provider',
      timeout: LIMITS.timeout.fetchMs || 120000,
      maxResponseBytes: 10 * 1024 * 1024,
      signal,
    }
  );

  if (!resp.success) return { images: [], metadata: {}, error: resp.error };

  const data = resp.data;
  const images = (data.images || []).map(img => ({
    data: typeof img === 'string' ? img : img.toString('base64'),
    mimeType: 'image/png',
    format: 'png',
  }));

  if (images.length === 0) {
    return { images: [], metadata: {}, error: { code: 'PROCESSING_FAILED', message: 'Stable Diffusion returned no images', retryable: false } };
  }

  return {
    images: images.slice(0, options.num_images || 1),
    metadata: { provider: 'stable_diffusion', width: options.width, height: options.height },
  };
}

/**
 * Agnes image generation via providerFetch.
 */
async function generateWithAgnes(prompt, config, options) {
  const { apiKey, baseUrl, model } = config;
  const { signal } = options;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Build body — include reference images if provided
  const body = {
    model,
    prompt,
    n: options.num_images || 1,
    size: `${options.width || 1024}x${options.height || 1024}`,
  };

  // Pass reference images if Agnes supports image-to-image
  if (options.imageUrls && Array.isArray(options.imageUrls) && options.imageUrls.length > 0) {
    const fs = await import('fs');
    const pathMod = await import('path');
    const refImages = [];
    for (const refUrl of options.imageUrls) {
      if (!refUrl) continue;
      // Try reading local file as base64
      const localPath = refUrl.startsWith('file://') ? refUrl.slice(7) : refUrl;
      try {
        if (fs.existsSync(localPath)) {
          const ext = pathMod.extname(localPath).toLowerCase();
          const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
          const buf = fs.readFileSync(localPath);
          refImages.push({
            url: `data:${mimeType};base64,${buf.toString('base64')}`,
          });
        } else {
          // Assume it's a URL
          refImages.push({ url: refUrl });
        }
      } catch (_) {
        refImages.push({ url: refUrl });
      }
    }
    if (refImages.length > 0) body.image_urls = refImages;
  }

  const resp = await retryWithBackoff(async () => {
    return providerFetch(
      `${baseUrl}/v1/images/generations`,
      {
        method: 'POST',
        headers,
        body,
        provider: 'agnes',
        stage: 'provider',
        timeout: LIMITS.timeout.fetchMs || 120000,
        maxResponseBytes: 10 * 1024 * 1024,
        signal,
      }
    );
  }, 3, 2000);

  if (!resp.success) return { images: [], metadata: {}, error: resp.error };

  const data = resp.data;

  // Agnes API is async: returns task_id and URL, may have b64_json or url
  const items = data.data || [];
  if (items.length === 0 && data.task_id) {
    // Task submitted but no result yet - wait and poll
    const maxRetries = 12;
    const pollInterval = 5000; // 5 seconds
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, pollInterval));
      const pollResp = await providerFetch(
        `${BASE_URL}/tasks/${data.task_id}`,
        { method: 'GET', headers: { 'Authorization': `Bearer ${config.apiKey}` }, provider: 'agnes', stage: 'provider', timeout: 30000 }
      );
      if (pollResp.success && pollResp.data?.data?.[0]) {
        const item = pollResp.data.data[0];
        if (item.url) {
          const imgResp = await providerFetch(item.url, { provider: 'agnes', stage: 'download', timeout: 60000 });
          if (imgResp.success) {
            return {
              images: [{ data: Buffer.from(imgResp.data).toString('base64'), mimeType: 'image/png', format: 'png', url: item.url }],
              metadata: { provider: 'agnes', width: options.width, height: options.height, task_id: data.task_id },
            };
          }
        }
      }
    }
    return { images: [], metadata: {}, error: { code: 'PROCESSING_FAILED', message: 'Agnes task timeout', retryable: true } };
  }

  const images = items.map(item => ({
    data: item.b64_json || item.url,
    mimeType: 'image/png',
    format: 'png',
    url: item.url,
  }));

  if (images.length === 0) {
    return { images: [], metadata: {}, error: { code: 'PROCESSING_FAILED', message: 'Agnes returned no images', retryable: false } };
  }

  // Download from URL if b64_json is empty
  for (let i = 0; i < images.length; i++) {
    if (!images[i].data || images[i].data.startsWith('http')) {
      const url = images[i].data || images[i].url;
      if (url) {
        const imgResp = await providerFetch(url, { provider: 'agnes', stage: 'download', timeout: 60000 });
        if (imgResp.success) {
          images[i].data = Buffer.from(imgResp.data).toString('base64');
        }
      }
    }
  }

  return {
    images: images.slice(0, options.num_images || 1),
    metadata: {
      provider: 'agnes',
      width: options.width,
      height: options.height,
      reference_images_used: options.imageUrls?.length ?? 0,
      task_id: data.task_id,
    },
  };
}

/**
 * ComfyUI image generation via providerFetch.
 * Uses queue → poll → download pattern. All steps respect signal.
 */
async function generateWithComfy(prompt, config, options) {
  const { baseUrl: comfyUrl } = config;
  const { signal } = options;
  if (!comfyUrl) throw new Error('ComfyUI base URL not configured');

  const urlValidation = validateComfyUrl(comfyUrl);
  if (urlValidation) throw new Error(urlValidation.error.message);

  // Check cancellation early
  if (signal?.aborted) {
    return { images: [], metadata: {}, error: { code: ErrorCode.CANCELLED, message: 'Operation cancelled', retryable: false } };
  }

  // Build a simple text-to-image workflow
  const workflow = {
    3: {
      class_type: 'KSampler',
      inputs: { seed: Math.floor(Math.random() * 2147483647), steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: config.model || 'model.safetensors' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: options.width || 512, height: options.height || 512, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'sprite_gen', images: ['8', 0] } },
  };

  // Queue prompt
  const queueResp = await providerFetch(`${comfyUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { prompt: workflow },
    provider: 'comfy',
    stage: 'provider',
    timeout: 30000,
    signal,
  });

  if (!queueResp.success) return { images: [], metadata: {}, error: queueResp.error };

  const promptId = queueResp.data?.prompt_id;
  if (!promptId) throw new Error('No prompt_id returned from ComfyUI');

  // Poll for completion — each wait and request is cancellable
  const maxPolls = 60;
  const pollInterval = 2000;
  let result = null;

  for (let i = 0; i < maxPolls; i++) {
    // Cancellable delay between polls
    try {
      await cancellableDelay(pollInterval, signal, 'comfy');
    } catch (e) {
      if (e.code === 'ABORT_ERR') {
        return { images: [], metadata: {}, error: { code: ErrorCode.CANCELLED, message: 'Operation cancelled', retryable: false } };
      }
      throw e;
    }

    const historyResp = await providerFetch(`${comfyUrl}/history/${promptId}`, {
      provider: 'comfy',
      stage: 'provider',
      timeout: 10000,
      signal,
    });

    if (historyResp.success && historyResp.data && historyResp.data[promptId]) {
      result = historyResp.data[promptId];
      break;
    }

    // If history request was cancelled
    if (historyResp.error?.code === ErrorCode.CANCELLED) {
      return { images: [], metadata: {}, error: historyResp.error };
    }
  }

  if (!result) throw new Error('ComfyUI generation timed out (polling limit reached)');
  if (result.status?.status_str === 'error') throw new Error('ComfyUI generation failed');

  // Collect images from outputs — each download is cancellable
  const images = [];
  for (const [nodeId, nodeData] of Object.entries(result.outputs)) {
    if (nodeData.images) {
      for (const img of nodeData.images) {
        const imgUrl = new URL(`${comfyUrl}/view`);
        imgUrl.searchParams.set('filename', img.filename);
        imgUrl.searchParams.set('subfolder', img.subfolder || '');
        imgUrl.searchParams.set('type', img.type || 'output');

        const imgResp = await providerFetch(imgUrl.toString(), {
          headers: { 'Accept': 'image/png' },
          provider: 'comfy',
          stage: 'provider',
          timeout: 30000,
          maxResponseBytes: LIMITS.image.maxFileSizeBytes,
          signal,
        });

        if (imgResp.error?.code === ErrorCode.CANCELLED) {
          return { images: [], metadata: {}, error: imgResp.error };
        }

        if (imgResp.success && Buffer.isBuffer(imgResp.data)) {
          images.push({
            data: imgResp.data.toString('base64'),
            mimeType: 'image/png',
            format: 'png',
          });
        }
      }
    }
  }

  if (images.length === 0) {
    return { images: [], metadata: {}, error: { code: 'PROCESSING_FAILED', message: 'ComfyUI returned no images', retryable: false } };
  }

  return {
    images,
    metadata: { provider: 'comfy', width: options.width, height: options.height },
  };
}
