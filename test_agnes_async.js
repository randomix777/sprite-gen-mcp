/**
 * Test Agnes async task polling
 */
import { providerFetch } from './lib/provider_http.js';
import { LIMITS } from './lib/limits.js';

const API_KEY = process.env.AGNES_API_KEY;
if (!API_KEY) throw new Error('Set AGNES_API_KEY before running this test');
const BASE_URL = 'https://apihub.agnes-ai.com/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
};

async function generateImage(prompt, width = 1024, height = 1024) {
  const body = {
    model: 'agnes-image-2.1-flash',
    prompt,
    n: 1,
    size: `${width}x${height}`,
  };

  console.log(`\n[1] Submitting task: ${prompt.slice(0, 40)}...`);
  const resp = await providerFetch(
    `${BASE_URL}/images/generations`,
    {
      method: 'POST',
      headers: HEADERS,
      body,
      provider: 'agnes',
      stage: 'provider',
      timeout: LIMITS.timeout.fetchMs || 120000,
      maxResponseBytes: 10 * 1024 * 1024,
    }
  );

  if (!resp.success) {
    console.log('  Error:', resp.error);
    return null;
  }

  const data = resp.data;
  console.log(`  Response keys: ${Object.keys(data).join(', ')}`);
  console.log(`  task_id: ${data.task_id}`);
  console.log(`  data[0].url: ${data.data?.[0]?.url?.slice(0, 80)}...`);
  console.log(`  data[0].b64_json length: ${data.data?.[0]?.b64_json?.length || 0}`);

  return data;
}

async function downloadImage(url) {
  console.log(`\n[2] Downloading from: ${url.slice(0, 60)}...`);
  const resp = await providerFetch(url, {
    method: 'GET',
    provider: 'agnes',
    stage: 'download',
    timeout: 60000,
    maxResponseBytes: 20 * 1024 * 1024,
  });

  if (!resp.success) {
    console.log('  Download error:', resp.error);
    return null;
  }

  console.log(`  Downloaded: ${resp.data?.length || 0} bytes`);
  return resp.data;
}

async function main() {
  console.log('=== Agnes Async Task Test ===\n');

  const result = await generateImage('a simple red square icon', 128, 128);
  if (!result || !result.data?.[0]?.url) {
    console.log('No image URL in response');
    return;
  }

  const imageData = await downloadImage(result.data[0].url);
  if (imageData) {
    console.log('\n✅ Success! Image downloaded.');
    // Save to file
    import('fs').then(fs => {
      fs.default.writeFileSync('output/test_async_agnes.png', Buffer.from(imageData));
      console.log('Saved to: output/test_async_agnes.png');
    });
  } else {
    console.log('\n❌ Failed to download image');
  }
}

main().catch(console.error);
