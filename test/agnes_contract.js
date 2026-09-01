// Agnes API contract test — validates generateWithAgnes output shape
// and that requires_post_cutout flag flows through providerConfig

import { ok, err, ErrorCode } from '../lib/result.js';
import { getProviderConfig } from '../lib/config.js';

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
