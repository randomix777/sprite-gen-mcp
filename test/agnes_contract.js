// Agnes API contract test — validates generateWithAgnes output shape
// and that requires_post_cutout flag flows through providerConfig

import { ok, err, ErrorCode } from '../lib/result.js';
import { getProviderConfig } from '../lib/config.js';
import { buildAgnesEndpoint, buildAgnesRequestBody } from '../lib/image_gen.js';

const TEST_PROVIDER = 'agnes';

async function runAgnesContract() {
  // 1. Verify provider config has requires_post_cutout
  const cfg = getProviderConfig(TEST_PROVIDER);
  if (!cfg) {
    console.log(`✗ ${TEST_PROVIDER} config not found`);
    process.exit(2);
  }

  const hasCutout = cfg.requires_post_cutout;
  console.log(`  ${TEST_PROVIDER}.requires_post_cutout = ${hasCutout} ${hasCutout ? '✓' : '✗'}`);

  // 2. Verify config structure
  const hasName = !!cfg.name;
  const hasBaseUrl = !!cfg.baseUrl;
  const hasApiKey = !!cfg.apiKey;

  console.log(`  ${TEST_PROVIDER}.name = ${hasName} ${hasName ? '✓' : '✗'}`);
  console.log(`  ${TEST_PROVIDER}.baseUrl = ${hasBaseUrl} ${hasBaseUrl ? '✓' : '✗'}`);
  console.log(`  ${TEST_PROVIDER}.apiKey configured = ${hasApiKey} ${hasApiKey ? '✓' : '✗'}`);

  if (!hasCutout || !hasName || !hasBaseUrl) {
    console.log('✗ Agnes config contract incomplete');
    console.log('  Config:', JSON.stringify(cfg, null, 2));
    process.exit(2);
  }

  if (cfg.model !== 'agnes-image-2.5-flash') {
    throw new Error(`Unexpected Agnes model: ${cfg.model}`);
  }

  const endpoint = buildAgnesEndpoint(cfg.baseUrl);
  if (endpoint !== 'https://apihub.agnes-ai.com/v1/images/generations') {
    throw new Error(`Unexpected Agnes endpoint: ${endpoint}`);
  }

  const textBody = buildAgnesRequestBody('test', cfg.model, { width: 128, height: 128 });
  if (textBody.size !== '1K' || textBody.ratio !== '1:1'
      || textBody.extra_body?.response_format !== 'url'
      || 'return_base64' in textBody) {
    throw new Error(`Unexpected Agnes text request: ${JSON.stringify(textBody)}`);
  }

  const landscapeBody = buildAgnesRequestBody('test', cfg.model, { width: 1920, height: 1080 });
  if (landscapeBody.size !== '2K' || landscapeBody.ratio !== '16:9') {
    throw new Error(`Unexpected Agnes landscape request: ${JSON.stringify(landscapeBody)}`);
  }

  console.log('  ✓ Agnes contract test passed (config shape)');
}

// Run and exit with code 0 (success) or 2 (failure)
runAgnesContract().then(() => {
  console.log('Agnes contract verification complete');
  process.exit(0);
}).catch(e => {
  console.error('Agnes contract fatal:', e);
  process.exit(2);
});
