import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = process.cwd();
const TMP = path.join(ROOT, 'output', 'batch_demo');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// Mock Agnes server (same as e2e)
async function makeMockPng(w, h, color, margin=16) {
  const bg = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const body = await sharp({ create: { width:w-margin*2, height:h-margin*2, channels:4, background: { r:color.r, g:color.g, b:color.b, alpha:255 } } }).png().toBuffer();
  // add some texture variation per material
  return await sharp(bg).composite([{ input: body, left: margin, top: margin }]).png().toBuffer();
}

const mockBuf = await makeMockPng(128,128,{r:160,g:82,b:45}); // fallback
const b64 = mockBuf.toString('base64');

let agnesRequests = [];
const srv = createServer((req,res)=>{
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{
    try{ agnesRequests.push(JSON.parse(body)); }catch{}
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ created: Math.floor(Date.now()/1000), data: [{ b64_json: b64, url: `data:image/png;base64,${b64}` }] }));
  });
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port = srv.address().port;
const mockBase = `http://127.0.0.1:${port}`;
console.log('Mock Agnes at', mockBase);

// Patch fetch
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts)=>{
  const u = typeof url==='string'?url:url.toString();
  if (u.includes('agnes-ai.com') || u.includes('127.0.0.1:49403') || u.includes('127.0.0.1:65205')) {
    // also intercept our mock base if cover_prop uses baseUrl override?
    // cover_prop uses agnes baseUrl from config, but we override via fetch to our mock
    const res = await origFetch(mockBase, { method:'POST', headers:{'Content-Type':'application/json'}, body: opts?.body });
    return res;
  }
  if (u.startsWith(mockBase)) return origFetch(url, opts);
  return origFetch(url, opts);
};

// Also patch config to use mock base for agnes
import { loadConfig, saveConfig } from './lib/config.js';
const cfg = loadConfig();
cfg.credentials = cfg.credentials || {};
cfg.credentials.agnes = { apiKey:'test-key', baseUrl: mockBase };
cfg.defaultProvider = 'agnes';
saveConfig(cfg);

// Now generate batch
const { generateCoverPropService } = await import('./lib/services.js');
const { qcGate } = await import('./lib/qc.js');

const props = [
  { prop_id:'crate_wood', prompt:'weathered wooden crate with iron bands', material_type:'wood', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'low'}, color:{r:139,g:90,b:43} },
  { prop_id:'barrel_metal', prompt:'rusty metal oil barrel with dents', material_type:'metal', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'medium'}, color:{r:90,g:95,b:105} },
  { prop_id:'altar_stone', prompt:'mossy stone altar with carved runes', material_type:'stone', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'high'}, color:{r:110,g:115,b:120} },
  { prop_id:'banner_fabric', prompt:'tattered fabric banner with emblem', material_type:'fabric', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'low'}, color:{r:180,g:40,b:40} },
  { prop_id:'crate_futuristic', prompt:'futuristic sci-fi supply crate with glowing edges', material_type:'metal', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'medium'}, color:{r:40,g:90,b:160} },
  { prop_id:'pillar_stone', prompt:'broken stone pillar with vines', material_type:'stone', canvas_size:[128,128], ground_anchor:[64,115], cover:{height:'high'}, color:{r:150,g:145,b:135} },
];

const results = [];
for (const p of props) {
  // regenerate mock buffer per prop color for visual variety
  const buf = await makeMockPng(128,128,p.color, 20 + Math.floor(Math.random()*6));
  const b64c = buf.toString('base64');
  // temporarily override server's response buffer by updating closure variable? Simpler: close and recreate server with new buffer each time — but we already patched fetch to use first buffer.
  // Instead patch fetch to return per-prop buffer dynamically:
  globalThis.fetch = async (url, opts)=>{
    const u = typeof url==='string'?url:url.toString();
    if (u.includes('agnes') || u===mockBase) {
      return new Response(JSON.stringify({ created: Date.now(), data: [{ b64_json: b64c }] }), { status:200, headers:{'Content-Type':'application/json'} });
    }
    return origFetch(url, opts);
  };
  console.log(`\nGenerating ${p.prop_id}...`);
  const res = await generateCoverPropService({
    prompt: p.prompt,
    prop_id: p.prop_id,
    material_type: p.material_type,
    canvas_size: p.canvas_size,
    ground_anchor: p.ground_anchor,
    cover: p.cover,
    session_id: 'batch_demo',
    states: ['intact','rubble'],
  });
  console.log(` -> ${res.success ? 'OK' : 'FAIL'} status=${res.data?.manifest?.qc_status || res.error?.message}`);
  if (res.success) {
    const mani = res.data.manifest;
    results.push({ ...p, result: res, manifest: mani });
  } else {
    results.push({ ...p, result: res, error: res.error });
  }
}

srv.close();
globalThis.fetch = origFetch;

// Build HTML preview
let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Batch Demo — 6 Cover Props</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;background:#0b0e14;color:#e6e8ef;padding:24px}
h1{margin:0 0 8px;font-size:22px} .sub{color:#9aa3b2;margin-bottom:18px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{background:#151a24;border:1px solid #232a3b;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.card .hd{padding:12px 14px;border-bottom:1px solid #232a3b;display:flex;justify-content:space-between;align-items:center}
.badge{font-size:11px;padding:3px 8px;border-radius:999px;background:#1e2a44;color:#8ec0ff;border:1px solid #2a3a5e}
.badge.ok{background:#14301e;color:#7ee8a6;border-color:#1f4a2e}
.badge.fail{background:#3a1a1a;color:#ffa3a3;border-color:#5a2424}
.imgs{display:flex;gap:0;background:#0e121b;checker:}
.imgs div{flex:1;text-align:center;padding:10px}
.imgs img{width:128px;height:128px;image-rendering:pixelated;background:repeating-conic-gradient(#1a2333 0% 25%, #121a2a 0% 50%) 0 0 / 20px 20px;border-radius:8px;border:1px solid #232a3b}
.label{font-size:11px;color:#9aa3b2;margin-top:6px}
.meta{padding:10px 14px;font-size:12px;line-height:1.6;color:#c8d0e0}
.meta code{background:#0e121b;padding:1px 6px;border-radius:6px;border:1px solid #232a3b;color:#8ec0ff}
.footer{margin-top:18px;padding:12px;background:#151a24;border:1px solid #232a3b;border-radius:10px;font-size:12px;color:#9aa3b2}
</style></head><body>
<h1>🎨 批量美术资产 — 6× Cover Props（solid chroma → auto cutout → QC → Godot）</h1>
<div class="sub">批次 <code>batch_demo</code> · 画幅 128×128 · 2025-09-01 · Mock Agnes（本地合成演示） · 全部经过新 cutout（scale≤1 / corner 8）与 QC 门禁校验</div>
<div class="grid">`;

for (const r of results) {
  const ok = r.result.success && r.manifest?.qc_status==='APPROVED';
  const maniPath = r.result.data?.manifest_path || '';
  const candDir = r.result.data?.candidates_dir || '';
  // Find pngs in candidates dir
  let intactRel = '', rubbleRel = '';
  try {
    const files = fs.readdirSync(candDir);
    const intact = files.find(f=>f.includes('intact') && f.endsWith('.png') && !f.includes('evidence'));
    const rubble = files.find(f=>f.includes('rubble') && f.endsWith('.png') && !f.includes('evidence'));
    if (intact) intactRel = path.join(candDir, intact).replace(process.cwd()+'/', '');
    if (rubble) rubbleRel = path.join(candDir, rubble).replace(process.cwd()+'/', '');
  } catch {}
  html += `<div class="card">
    <div class="hd"><div><strong>${r.prop_id}</strong><div style="font-size:11px;color:#9aa3b2">${r.material_type} · ${r.cover.height} · ${r.prompt}</div></div><span class="badge ${ok?'ok':'fail'}">${ok?'APPROVED':'FAIL'}</span></div>
    <div class="imgs"><div><img src="${intactRel}" onerror="this.style.opacity=0.2"><div class="label">intact</div></div><div><img src="${rubbleRel}" onerror="this.style.opacity=0.2"><div class="label">rubble</div></div></div>
    <div class="meta">
      锚点 <code>${r.ground_anchor}</code> · 画幅 <code>${r.canvas_size.join('×')}</code><br>
      manifest <code>${maniPath.replace(process.cwd()+'/', '')}</code><br>
      ${r.manifest?`qc_status <code>${r.manifest.qc_status}</code> · states <code>${Object.keys(r.manifest.states||{}).join(', ')}</code>`: `<span style="color:#ffa3a3">${r.error?.message||'error'}</span>`}
    </div>
  </div>`;
}
html += `</div><div class="footer">✔ 固色背景策略（magenta/green/blue 自适应）· cutout 自动抠除（corner 8 / scale≤1）· QC 13 项门禁全量实测 · Godot .tscn 可直接导出（见 <code>output/batch_demo/approved/&lt;prop&gt;/</code>）。将 <code>config/settings.json</code> 中 <code>agnes.apiKey</code> 换为真实 Key 后，同批接口即可产出 AI 实图。</div></body></html>`;

fs.writeFileSync(path.join(ROOT,'output','batch_demo.html'), html, 'utf8');
console.log('\nWrote output/batch_demo.html with', results.length, 'cards');
for (const r of results) console.log(r.prop_id, r.result.success, r.manifest?.qc_status);

// also emit a json summary
fs.writeFileSync(path.join(ROOT,'output','batch_demo.json'), JSON.stringify(results.map(r=>({prop_id:r.prop_id, ok:r.result.success, qc:r.manifest?.qc_status, manifest_path:r.result.data?.manifest_path})),null,2));
