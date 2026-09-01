import fs from 'fs'
import path from 'path'
const ROOT = process.cwd()
const candRoot = path.join(ROOT, 'output', 'cover_props', 'candidates')
const dirs = fs.readdirSync(candRoot).filter(d=>d.startsWith('cover_')).sort()
const latest = dirs.slice(-6) // last 6
let cards=''
for(const d of latest){
  const dir = path.join(candRoot,d)
  const mfPath = path.join(dir,'manifest.json')
  if(!fs.existsSync(mfPath)) continue
  const mf = JSON.parse(fs.readFileSync(mfPath,'utf8'))
  const files = fs.readdirSync(dir)
  const intact = files.find(f=>f.includes('intact') && f.endsWith('.png') && !f.includes('evidence'))
  const rubble = files.find(f=>f.includes('rubble') && f.endsWith('.png') && !f.includes('evidence'))
  const ok = mf.qc_status==='APPROVED'
  const intactSrc = intact ? `cover_props/candidates/${d}/${intact}` : ''
  const rubbleSrc = rubble ? `cover_props/candidates/${d}/${rubble}` : ''
  cards+=`<div class="card"><div class="hd"><div><div class="title">${mf.prop_id}</div><div class="prompt">${mf.material_type} · ${mf.cover_height} · ${mf.prop_id}</div></div><span class="badge ${ok?'ok':'fail'}">${mf.qc_status}</span></div><div class="imgs"><div><img src="${intactSrc}"><span>intact</span></div><div><img src="${rubbleSrc}"><span>rubble</span></div></div><div class="meta">QC <code>${mf.qc_status}</code> · <code>${d}</code></div></div>`
}
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>批量美术资产 — Cover Props</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;padding:24px;background:#0a0f1a;color:#e6eaf2}h1{font-size:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:#131a29;border:1px solid #23304a;border-radius:12px;overflow:hidden}.hd{padding:10px 12px;display:flex;justify-content:space-between;border-bottom:1px solid #23304a;background:#11182a}.badge{padding:3px 8px;border-radius:999px;font-size:11px;border:1px solid #2a3d5e;background:#162548;color:#7fb8ff}.badge.ok{background:#0f2e1c;color:#7ee8a6}.badge.fail{background:#3a1414;color:#ffb0b0}.imgs{display:flex;background:#0b1220}.imgs div{flex:1;padding:10px;text-align:center}.imgs img{width:128px;height:128px;image-rendering:pixelated;border-radius:8px;border:1px solid #23304a;background:repeating-conic-gradient(#1a2333 0 25%,#121a2a 0 50%) 0 0/20px 20px}</style></head><body><h1>🎨 批量美术资产 — 6× Cover Props（本地 Mock 合成演示）</h1><div class="grid">${cards}</div></body></html>`
fs.writeFileSync(path.join(ROOT,'output','batch_demo_fixed.html'), html)
console.log('wrote fixed html', latest)
