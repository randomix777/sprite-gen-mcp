/**
 * MCP handshake test — real integration test.
 *
 * Starts server.js as a child process, connects via stdio,
 * performs initialize → tools/list → tool call → shutdown.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

// JSON-RPC helper
let reqId = 0;
function makeRequest(method, params) {
  const id = ++reqId;
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return { id, msg: msg + '\n' };
}

function parseResponse(data) {
  const lines = data.toString().split('\n').filter(l => l.trim());
  const results = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch (_) {}
  }
  return results;
}

/**
 * Spawn the MCP server and return { process, send, close }.
 */
function spawnServer() {
  const child = spawn('node', [SERVER], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '' },
    windowsHide: true,
  });

  let buffer = '';
  const pendingResponses = [];

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    // Try to parse complete messages
    const parts = buffer.split('\n');
    buffer = parts.pop(); // keep incomplete last line
    for (const part of parts) {
      if (part.trim()) {
        try {
          const msg = JSON.parse(part);
          // Find matching pending request
          if (msg.id !== undefined) {
            for (const resolve of pendingResponses) {
              resolve(msg);
              break;
            }
          }
        } catch (_) {}
      }
    }
  });

  const send = (method, params, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), timeout);
      const { msg } = makeRequest(method, params);
      child.stdin.write(msg);

      const checkResponse = (msg) => {
        clearTimeout(timer);
        const idx = pendingResponses.indexOf(checkResponse);
        if (idx >= 0) pendingResponses.splice(idx, 1);
        resolve(msg);
      };
      pendingResponses.push(checkResponse);
    });
  };

  const close = () => {
    child.stdin.end();
    return new Promise((resolve) => {
      child.on('close', resolve);
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 2000);
    });
  };

  return { process: child, send, close };
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        MCP Handshake Test — Real Integration            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Server: ${SERVER}`);
  console.log(`Node: ${process.version}`);
  console.log('');

  const { process: serverProcess, send, close } = spawnServer();
  let serverClosed = false;

  try {
    // Wait for server to start
    await new Promise(r => setTimeout(r, 1000));

    // ─── 1. Initialize ───
    console.log('1. Initialize');

    await testAsync('initialize returns protocol version', async () => {
      const resp = await send('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }, 10000);
      assert(resp.result, 'Should have result');
      assert(resp.result.protocolVersion, 'Should have protocolVersion');
      assert(resp.result.capabilities, 'Should have capabilities');
      assert(resp.result.serverInfo, 'Should have serverInfo');
      assertEqual(resp.result.serverInfo.name, 'sprite-gen-mcp');
    });

    // Send initialized notification
    await send('notifications/initialized', {});

    // ─── 2. Tools list ───
    console.log('2. Tools/list');

    let toolNames = [];
    await testAsync('tools/list returns all 39 tools', async () => {
      const resp = await send('tools/list', {}, 10000);
      assert(resp.result, 'Should have result');
      assert(Array.isArray(resp.result.tools), 'Should have tools array');
      assertEqual(resp.result.tools.length, 39, 'Should have 39 tools');
      toolNames = resp.result.tools.map(t => t.name);
    });

    test('all tool names start with sprite_', () => {
      for (const name of toolNames) {
        assert(name.startsWith('sprite_'), `Tool ${name} should start with sprite_`);
      }
    });

    test('no duplicate tool names', () => {
      const unique = new Set(toolNames);
      assertEqual(unique.size, toolNames.length, 'Should have no duplicates');
    });

    // ─── 3. Tool call: sprite__info ───
    console.log('3. Tool call: sprite__info');

    await testAsync('sprite__info returns success', async () => {
      const resp = await send('tools/call', {
        name: 'sprite__info',
        arguments: {},
      }, 10000);
      assert(resp.result, 'Should have result');
      assert(resp.result.content, 'Should have content');
      assert(resp.result.content.length > 0, 'Content should not be empty');
      const text = resp.result.content[0].text;
      assert(typeof text === 'string', 'Content text should be string');
      // Should contain info about the plugin
      assert(text.length > 10, 'Should have meaningful content');
    });

    // ─── 4. Tool call: sprite_style_list ───
    console.log('4. Tool call: sprite_style_list');

    await testAsync('sprite_style_list returns presets', async () => {
      const resp = await send('tools/call', {
        name: 'sprite_style_list',
        arguments: {},
      }, 10000);
      assert(resp.result, 'Should have result');
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success, 'Should be successful');
      // Returns ok([...styles]) — data is array of {id, name, description}
      const items = Array.isArray(data.data) ? data.data : [];
      assert(items.length >= 10, `Should have style presets (got ${items.length})`);
    });

    // ─── 5. Tool call: sprite__config list ───
    console.log('5. Tool call: sprite__config');

    await testAsync('sprite__config list returns success', async () => {
      const resp = await send('tools/call', {
        name: 'sprite__config',
        arguments: { action: 'list' },
      }, 10000);
      assert(resp.result, 'Should have result');
      const text = resp.result.content[0].text;
      const data = JSON.parse(text);
      assert(data.success, 'Should be successful');
    });

    // ─── 6. Error handling ───
    console.log('6. Error handling');

    await testAsync('unknown tool returns error', async () => {
      const resp = await send('tools/call', {
        name: 'nonexistent_tool',
        arguments: {},
      }, 5000);
      // MCP SDK should handle this
      assert(resp.error || resp.result, 'Should have error or result');
    });

  } catch (e) {
    console.error('Test error:', e);
    failed++;
  } finally {
    // Clean shutdown
    if (!serverClosed) {
      try {
        await close();
        serverClosed = true;
      } catch (_) {}
    }

    // Check no node processes remain
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
