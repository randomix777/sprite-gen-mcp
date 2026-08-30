/**
 * Mock HTTP server for provider contract tests.
 *
 * Simulates AI image generation API responses without
 * calling real paid services.
 *
 * Usage:
 *   import { MockProviderServer } from './mock_server.js';
 *   const server = new MockProviderServer();
 *   await server.start();
 *   // server.baseUrl → 'http://127.0.0.1:PORT'
 *   await server.stop();
 */

import { createServer } from 'http';

// Minimal valid 1x1 red PNG (base64)
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export class MockProviderServer {
  constructor(options = {}) {
    this.port = 0; // auto-assign
    this.baseUrl = '';
    this._server = null;
    this._handlers = new Map();
    this._requestLog = [];

    // Default handlers
    this._handlers.set('gemini', this._handleGemini.bind(this));
    this._handlers.set('stable_diffusion', this._handleSD.bind(this));
    this._handlers.set('agnes', this._handleAgnes.bind(this));
    this._handlers.set('comfy', this._handleComfy.bind(this));

    // Override behavior
    this._behavior = {
      failRate: 0,          // 0-1, probability of returning error
      failStatus: 500,      // HTTP status on failure
      failMessage: 'Server error',
      latencyMs: 0,         // artificial delay
      returnEmpty: false,   // return empty images
      returnInvalidJson: false, // return garbage JSON
    };

    if (options.behavior) {
      Object.assign(this._behavior, options.behavior);
    }
  }

  /**
   * Set mock behavior for the next requests.
   */
  setBehavior(behavior) {
    Object.assign(this._behavior, behavior);
  }

  /**
   * Start the mock server.
   */
  async start() {
    return new Promise((resolve) => {
      this._server = createServer(async (req, res) => {
        // Log request
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        this._requestLog.push({
          method: req.method,
          url: req.url,
          body: body ? JSON.parse(body) : null,
          headers: { ...req.headers },
        });

        // Artificial delay
        if (this._behavior.latencyMs > 0) {
          await new Promise(r => setTimeout(r, this._behavior.latencyMs));
        }

        // Check if should fail
        if (this._behavior.failRate > 0 && Math.random() < this._behavior.failRate) {
          res.writeHead(this._behavior.failStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: this._behavior.failMessage }));
          return;
        }

        // Check invalid JSON
        if (this._behavior.returnInvalidJson) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('THIS IS NOT VALID JSON {{{');
          return;
        }

        // Route to provider handler
        try {
          if (req.url.includes('gemini') || req.url.includes('v1beta')) {
            await this._handlers.get('gemini')(req, res);
          } else if (req.url.includes('/prompt') && req.method === 'POST') {
            // ComfyUI queue prompt
            await this._handlers.get('comfy')(req, res);
          } else if (req.url.includes('/history/')) {
            // ComfyUI history
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
          } else if (req.url.includes('/view')) {
            // ComfyUI view image
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(Buffer.from(TINY_PNG_BASE64, 'base64'));
          } else if (req.url.includes('agnes')) {
            await this._handlers.get('agnes')(req, res);
          } else {
            await this._handlers.get('stable_diffusion')(req, res);
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      this._server.listen(0, '127.0.0.1', () => {
        this.port = this._server.address().port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve();
      });
    });
  }

  /**
   * Stop the mock server.
   */
  async stop() {
    if (this._server) {
      return new Promise((resolve) => {
        this._server.close(() => resolve());
        this._server = null;
      });
    }
  }

  /**
   * Get request log for assertions.
   */
  getRequestLog() {
    return [...this._requestLog];
  }

  clearRequestLog() {
    this._requestLog = [];
  }

  // ─── Provider-specific handlers ─────────────────────────────────────────

  async _handleGemini(req, res) {
    if (this._behavior.returnEmpty) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/png',
              data: TINY_PNG_BASE64,
            },
          }],
        },
      }],
    }));
  }

  async _handleSD(req, res) {
    if (this._behavior.returnEmpty) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ images: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      images: [TINY_PNG_BASE64],
    }));
  }

  async _handleAgnes(req, res) {
    if (this._behavior.returnEmpty) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [{ b64_json: TINY_PNG_BASE64 }],
    }));
  }

  async _handleComfy(req, res) {
    // Queue prompt response
    const promptId = 'mock-prompt-' + Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prompt_id: promptId }));
  }
}
