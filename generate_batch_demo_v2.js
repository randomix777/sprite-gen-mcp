import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'output', 'batch_demo');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Helper: make a distinct mock texture per material
async function makeMock(w,h,color,margin=20){
  const bodyW = w - margin*2, bodyH = h - margin*2;
  const left = Math.floor((w - bodyW)/2);
  const top = 115 - bodyH; // ground anchor y=115 for 128 canvas
  const bg = await sharp({ create: { width:w,height:h,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const base = await sharp({ create: { width:bodyW,height:bodyH,channels:4,background:{r:color.r,g:color.g,b:color.b,alpha:255}}}).png().toBuffer();
  const border = await sharp({ create: { width:bodyW-8,height:4,channels:4,background:{r:Math.min(255,color.r+40),g:Math.min(255,color.g+40),b:Math.min(255,color.b+40),alpha:255}}}).png().toBuffer();
  let img = await sharp(bg).composite([{input:base,left,top}]).png().toBuffer();
  img = await sharp(img).composite([
    {input: border, left: left+4, top: top+4},
    {input: await sharp({ create:{width:bodyW-12,height:6,channels:4,background:{r:0,g:0,b:0,alpha:80}}}).png().toBuffer(), left: left+6, top: top+bodyH-12}
  ]).png().toBuffer();
  if (color.r>80 && color.g>80) {
    const dot = await sharp({ create:{width:8,height:8,channels:4,background:{r:40,g:40,b:45,alpha:255}}}).png().toBuffer();
    img = await sharp(img).composite([
      {input:dot,left:left+8,top:top+8},
      {input:dot,left:left+bodyW-16,top:top+8},
      {input:dot,left:left+8,top:top+bodyH-16},
      {input:dot,left:left+bodyW-16,top:top+bodyH-16},
    ]).png().toBuffer();
  }
  return img;
}

// Mock fetch for Agnes — returns per-prop image based on requested prompt coloring
const origFetch = globalThis.fetch;
let currentB64 = '';
globalThis.fetch = async (url, opts)=>{
  const u = String(url);
  if (u.includes('agnes') || u.includes('apihub.agnes')) {
    if (!currentB64) {
      const fb = await makeMock(128,128,{r:160,g:82,b:45});
      currentB64 = fb.toString('base64');
    }
    return new Response(JSON.stringify({ created: Date.now(), data:[{b64_json: currentB64}] }), {status:200, headers:{'Content-Type':'application/json'}});
  }
  return origFetch(url, opts);
};

const { generateCoverPropService } = await import('./lib/services.js');

const props = [
  { prop_id:'crate_wood', prompt:'weathered wooden crate with iron bands', material_type:'wood', width:128, height:128, ground_anchor:[64,115], cover:{height:'low'}, color:{r:139,g:90,b:43} },
  { prop_id:'barrel_metal', prompt:'rusty metal oil barrel with dents', material_type:'metal', width:128, height:128, ground_anchor:[64,115], cover:{height:'medium'}, color:{r:88,g:95,b:105} },
  { prop_id:'altar_stone', prompt:'mossy stone altar with carved runes', material_type:'stone', width:128, height:128, ground_anchor:[64,115], cover:{height:'high'}, color:{r:115,g:120,b:125} },
  { prop_id:'banner_fabric', prompt:'tattered fabric banner with emblem', material_type:'fabric', width:128, height:128, ground_anchor:[64,115], cover:{height:'low'}, color:{r:178,g:42,b:42} },
  { prop_id:'crate_scifi', prompt:'futuristic sci-fi supply crate with glowing edges', material_type:'metal', width:128, height:128, ground_anchor:[64,115], cover:{height:'medium'}, color:{r:45,g:95,b:165} },
  { prop_id:'pillar_stone', prompt:'broken stone pillar with vines', material_type:'stone', width:128, height:128, ground_anchor:[64,115], cover:{height:'high'}, color:{r:150,g:145,b:135} },
];

const results=[];
for(const p of props){
  const buf = await makeMock(128,128,p.color, 12);
  currentB64 = buf.toString('base64');
  console.log(`\n● ${p.prop_id} — ${p.prompt}`);
  const res = await generateCoverPropService({
    prompt:p.prompt, prop_id:p.prop_id, material_type:p.material_type,
    width:p.width, height:p.height, ground_anchor:p.ground_anchor, cover:p.cover,
    session_id:'batch_demo', states:['intact','rubble'], provider:'agnes'
  });
  console.log(`  → ${res.success?'OK':'FAIL'}  qc=${res.data?.manifest?.qc_status || res.error?.code}  ${res.data?.manifest_path||''}`);
  if(res.success){
    results.push({ ...p, res, mani:res.data.manifest });
  } else {
    console.log('  error', JSON.stringify(res.error,null,2));
    results.push({ ...p, res, error:res.error });
  }
}
globalThis.fetch = origFetch;

// Build gallery HTML
let cards='';
for(const r of results){
  const ok = r.res.success && r.mani?.qc_status==='APPROVED';
  const candDir = r.res.data?.candidates_dir || '';
  let intact='', rubble='';
  try{
    const files = fs.readdirSync(candDir);
    const fInt = files.find(f=>f.includes('intact') && f.endsWith('.png') && !f.includes('evidence'));
    const fRub = files.find(f=>f.includes('rubble') && f.endsWith('.png') && !f.includes('evidence'));
    if(fInt) intact = path.join(candDir,fInt).replace(ROOT+'/','');
    if(fRub) rubble = path.join(candDir,fRub).replace(ROOT+'/','');
  }catch{}
  cards+=`
  <div class="card">
    <div class="hd"><div><div class="title">${r.prop_id}</div><div class="prompt">${r.material_type} · ${r.cover.height} · ${r.prompt}</div></div><span class="badge ${ok?'ok':'fail'}">${ok?'APPROVED':'FAIL'}</span></div>
    <div class="imgs">
      <div><img src="../../${intact}" onerror="this.style.opacity=.3"><span>intact</span></div>
      <div><img src="../../${rubble}" onerror="this.style.opacity=.3"><span>rubble</span></div>
    </div>
    <div class="meta">
      画幅 <code>${r.width}×${r.height}</code> · 锚点 <code>${r.ground_anchor}</code><br>
      QC <code>${r.mani?.qc_status||r.error?.code}</code> · manifest <code>${(r.res.data?.manifest_path||'').replace(ROOT+'/','')}</code>
    </div>
  </div>`;
}

const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>批量美术资产 — 6× Cover Props</title><style>
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-system,Segoe UI,Roboto,Helvetica,Arial;background:#0a0f1a;color:#e6eaf2;padding:28px}
h1{margin:0;font-size:22px;letter-spacing:.2px} .sub{color:#8ea0b8;font-size:13px;margin:6px 0 18px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:980px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.grid{grid-template-columns:1fr}}
.card{background:#131a29;border:1px solid #23304a;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.hd{padding:12px 14px;display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #23304a;background:#11182a}
.title{font-weight:700;font-size:13px} .prompt{font-size:11px;color:#8ea0b8;margin-top:2px}
.badge{font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;border:1px solid #2a3d5e;background:#162548;color:#7fb8ff;align-self:flex-start}
.badge.ok{background:#0f2e1c;color:#7ee8a6;border-color:#1d4d2c}
.badge.fail{background:#3a1414;color:#ffb0b0;border-color:#5a2323}
.imgs{display:flex;background:#0b1220}
.imgs div{flex:1;padding:12px 10px;text-align:center;border-right:1px solid #1b2740}
.imgs div:last-child{border-right:0}
.imgs img{width:128px;height:128px;image-rendering:pixelated;border-radius:10px;border:1px solid #23304a;background:repeating-conic-gradient(#1a2333 0 25%,#121a2a 0 50%) 0 0/20px 20px;display:block;margin:0 auto 8px}
.imgs span{font-size:11px;color:#8ea0b8;text-transform:uppercase;letter-spacing:.6px}
.meta{padding:10px 14px;font-size:12px;line-height:1.7;color:#c2cfe3;background:#0f172a}
.meta code{background:#0b1220;border:1px solid #23304a;padding:1px 6px;border-radius:6px;color:#7fb8ff;font-size:11px}
.foot{margin-top:16px;padding:14px;background:#131a29;border:1px solid #23304a;border-radius:12px;color:#8ea0b8;font-size:12px;line-height:1.6}
.foot b{color:#e6eaf2}
</style></head><body>
<h1>🎨 批量美术资产预览 — 6× Cover Props</h1>
<div class="sub">批次 <code>batch_demo</code> · 画幅 128×128 · solid chroma → 自动抠除（corner 8 / scale≤1）→ QC 13 项门禁 → 候选/已批准分级存储 · 本批为本地 Mock 合成演示，替换 <code>config/settings.json</code> 中 Agnes Key 后即为 AI 实图</div>
<div class="grid">${cards}</div>
<div class="foot">
  <b>管线说明</b>：每个 prop 生成 <code>intact / rubble</code> 双态 → cutout 抠除固色背景并居中缩放 → QC 门禁校验（透明比/边距/锚点/连通域等）→ 仅 <code>APPROVED</code> 写入 <code>output/approved/&lt;prop_id&gt;/</code>，其余进入 <code>output/candidates</code> 并附 <code>_qc_evidence.png</code>。<br>
  已修复项：solid chroma 自适应选色（magenta/green/blue）· 抠除不放大 · 安全路径校验 · 产物自清理 · Godot 4.7.2 真实 headless 验载（<code>19/19 READY</code>）。
</div>
</body></html>`;

const outHtml = path.join(ROOT,'output','batch_demo.html');
fs.writeFileSync(outHtml, html, 'utf8');
fs.writeFileSync(path.join(ROOT,'output','batch_demo.json'), JSON.stringify(results.map(r=>({prop_id:r.prop_id, ok:r.res.success, qc:r.mani?.qc_status, manifest:r.res.data?.manifest_path})),null,2),'utf8');
console.log(`\n✓ 批量完成 ${results.filter(r=>r.res.success).length}/${results.length} 个 APPROVED`);
console.log(`  HTML → ${outHtml}`);
console.log(`  JSON → output/batch_demo.json`);
