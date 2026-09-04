import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  approveConceptStage,
  approveViewStage,
  approveStateStage,
  createCoverPropWorkflow,
  generateConcept,
  generateViewsBatch,
  generateSingleViewStage,
  generateAllStatesBatch,
  generateStateVariantsStage,
  getCoverPropWorkflow,
  listPendingReviews,
  publishWorkflowStage,
  regenerateViewStage,
  rejectViewStage,
  rejectStateStage,
  reviseConcept,
  restartConcept,
  selectViewsStage,
  performQCStage,
  restorePendingTasksStage,
} from '../lib/cover_prop_phased.js';
import { CAMERA_PRESETS } from '../lib/camera_presets.js';
import { resolveGodot, getGodotStatus } from '../lib/godot.js';
import { getGodotConfig, setGodotConfig, validateGodotConfig } from '../lib/config.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'web', 'public');
const outputDir = path.join(rootDir, 'output');
const requestedPort = Number(process.env.SPRITE_REVIEW_PORT || 4317);
const maxPortAttempts = 20;

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    
    // ─── GET endpoints ───────────────────────────────────────────────────────
    if (url.pathname === '/api/reviews' && request.method === 'GET') {
      return sendResult(response, await listPendingReviews());
    }
    if (url.pathname === '/api/camera-presets' && request.method === 'GET') {
      return sendJson(response, 200, { success: true, data: CAMERA_PRESETS });
    }
    if (url.pathname === '/api/workflows' && request.method === 'GET') {
      return sendResult(response, listPendingReviews());
    }
    if (url.pathname === '/api/pending-tasks' && request.method === 'GET') {
      return sendResult(response, restorePendingTasksStage());
    }
    if (url.pathname === '/api/image' && request.method === 'GET') {
      return sendImage(response, url.searchParams.get('path'));
    }
    
    // ─── Workflow CRUD ───────────────────────────────────────────────────────
    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)(?:\/(.*))?$/);
    if (workflowMatch) {
      const workflowId = decodeURIComponent(workflowMatch[1]);
      const action = workflowMatch[2];
      const record = findWorkflow(workflowId);
      if (!record) {
        return sendJson(response, 404, { success: false, error: { message: 'Workflow not found' } });
      }
      
      if (!action) {
        // GET /api/workflows/{id} - get workflow info
        return sendResult(response, getCoverPropWorkflow({ workflow_id: workflowId }));
      }
      
      const args = { workflow_id: workflowId, ...(request.method === 'POST' ? await readJson(request) : {}) };
      
      // ─── Concept stage actions ─────────────────────────────────────────────
      if (action === 'concept/generate') {
        return sendResult(response, await runGeneration(request, signal => generateConcept({ ...args, signal })));
      }
      if (action === 'concept/revise') {
        return sendResult(response, await runGeneration(request, signal => reviseConcept({ ...args, signal })));
      }
      if (action === 'concept/restart') {
        return sendResult(response, await runGeneration(request, signal => restartConcept({ ...args, signal })));
      }
      if (action === 'concept/approve') {
        return sendResult(response, approveConceptStage(args));
      }
      
      // ─── View selection actions ────────────────────────────────────────────
      if (action === 'views/select') {
        return sendResult(response, selectViewsStage(args));
      }
      if (action === 'views/batch') {
        return sendResult(response, await runGeneration(request, signal => generateViewsBatch({ ...args, signal })));
      }
      if (action === 'views/generate') {
        return sendResult(response, await runGeneration(request, signal => generateSingleViewStage({ ...args, signal })));
      }
      if (action === 'views/approve') {
        return sendResult(response, approveViewStage(args));
      }
      if (action === 'views/reject') {
        return sendResult(response, rejectViewStage(args));
      }
      if (action === 'views/regenerate') {
        return sendResult(response, await runGeneration(request, signal => regenerateViewStage({ ...args, signal })));
      }
      
      // ─── State variant actions ─────────────────────────────────────────────
      if (action === 'states/generate') {
        return sendResult(response, await runGeneration(request, signal => generateStateVariantsStage({ ...args, signal })));
      }
      if (action === 'states/batch') {
        return sendResult(response, await runGeneration(request, signal => generateAllStatesBatch({ ...args, signal })));
      }
      if (action === 'states/approve') {
        return sendResult(response, approveStateStage(args));
      }
      if (action === 'states/reject') {
        return sendResult(response, rejectStateStage(args));
      }
      
      // ─── QC and publish ────────────────────────────────────────────────────
      if (action === 'qc/perform') {
        return sendResult(response, await performQCStage(args));
      }
      if (action === 'publish') {
        return sendResult(response, publishWorkflowStage(args));
      }
      
      return sendJson(response, 400, { success: false, error: { message: `Unknown action: ${action}` } });
    }
    
    // ─── Create new workflow ─────────────────────────────────────────────────
    if (url.pathname === '/api/workflows' && request.method === 'POST') {
      const args = await readJson(request);
      return sendResult(response, await runGeneration(request, signal => createCoverPropWorkflow({ ...args, signal })));
    }
    
    // ─── Godot configuration ─────────────────────────────────────────────────
    if (url.pathname === '/api/godot-config' && request.method === 'GET') {
      const config = getGodotConfig();
      const status = getGodotStatus();
      return sendJson(response, 200, { success: true, data: { config, status } });
    }
    if (url.pathname === '/api/godot-config' && request.method === 'POST') {
      const body = await readJson(request);
      const validation = validateGodotConfig(body);
      if (!validation.valid) {
        return sendJson(response, 400, { success: false, error: { message: 'Invalid config', errors: validation.errors } });
      }
      const saveResult = setGodotConfig(body);
      if (!saveResult.success) {
        return sendResult(response, saveResult);
      }
      const newStatus = getGodotStatus();
      return sendJson(response, 200, { success: true, data: { config: getGodotConfig(), status: newStatus } });
    }
    if (url.pathname === '/api/godot/detect' && request.method === 'GET') {
      const status = getGodotStatus();
      return sendJson(response, 200, { success: true, data: status });
    }
    
    // ─── Serve static files ──────────────────────────────────────────────────
    return serveStatic(response, url.pathname);
  } catch (error) {
    return sendJson(response, 500, { success: false, error: { message: error instanceof Error ? error.message : 'Internal error' } });
  }
}

async function runGeneration(request, operation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for batch ops
  const cancel = () => controller.abort();
  request.once('aborted', cancel);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
    request.off('aborted', cancel);
  }
}

function findWorkflow(workflowId) {
  const queuePath = path.join(outputDir, 'workflow_db.json');
  try {
    const db = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    return Array.isArray(db.workflows) ? db.workflows.find(item => item.workflow_id === workflowId) : null;
  } catch {
    return null;
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendResult(response, result) {
  return sendJson(response, result.success ? 200 : 400, result);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function sendImage(response, requestedPath) {
  if (!requestedPath) return sendJson(response, 400, { success: false, error: { message: 'Missing path' } });
  const absolutePath = path.resolve(requestedPath);
  const relativePath = path.relative(outputDir, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(absolutePath)) {
    return sendJson(response, 404, { success: false, error: { message: 'Image not found' } });
  }
  response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  fs.createReadStream(absolutePath).pipe(response);
}

function serveStatic(response, pathname) {
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  const absolutePath = path.resolve(publicDir, filename);
  if (!absolutePath.startsWith(`${publicDir}${path.sep}`) && absolutePath !== path.join(publicDir, 'index.html')) {
    return sendJson(response, 404, { success: false, error: { message: 'Not found' } });
  }
  if (!fs.existsSync(absolutePath)) return sendJson(response, 404, { success: false, error: { message: 'Not found' } });
  const contentType = absolutePath.endsWith('.css') ? 'text/css' : absolutePath.endsWith('.js') ? 'text/javascript' : 'text/html';
  response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
  fs.createReadStream(absolutePath).pipe(response);
}

startServer(requestedPort, 0);

function startServer(port, attempt) {
  const candidateServer = http.createServer(handleRequest);
  const handleError = error => {
    candidateServer.off('error', handleError);
    if (error?.code === 'EADDRINUSE' && attempt < maxPortAttempts - 1) {
      const nextPort = port + 1;
      console.warn(`[sprite-review] Port ${port} is occupied; trying ${nextPort}.`);
      startServer(nextPort, attempt + 1);
      return;
    }
    console.error(`[sprite-review] Unable to start: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  };
  candidateServer.once('error', handleError);
  candidateServer.listen(port, '127.0.0.1', () => {
    candidateServer.off('error', handleError);
    const address = `http://127.0.0.1:${port}`;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'review-ui.json'), JSON.stringify({ port, address, pid: process.pid }, null, 2), 'utf8');
    console.log(`Sprite review UI: ${address}`);
  });
}
