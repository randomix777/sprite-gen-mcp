#!/usr/bin/env node
import { auditAssets } from '../lib/audit.js';

const r = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets', 
  strict: true, 
  asset_type: 'cover_prop' 
});

const rejected = r.data.assets.filter(a => a.status === 'REJECTED' && !a.asset_path.includes('qc_evidence'));
const approved = r.data.assets.filter(a => a.status === 'APPROVED' && !a.asset_path.includes('qc_evidence'));

// Group by category
const groups = {};
for (const a of rejected) {
  const parts = a.asset_path.split(/[/\\]/);
  const idx = parts.findIndex(p => p === 'assets');
  const cat = idx >= 0 ? parts[idx + 1] : 'other';
  if (!groups[cat]) groups[cat] = [];
  groups[cat].push(a);
}

console.log('=== REJECTED ASSETS BY CATEGORY ===');
for (const [cat, assets] of Object.entries(groups).sort()) {
  console.log(`\n【${cat.toUpperCase()}】${assets.length}个失败:`);
  for (const a of assets) {
    const relPath = a.asset_path.split('assets/')[1];
    console.log(`  ${relPath}`);
    console.log(`    失败: ${a.hard_failures?.join(', ')}`);
  }
}

console.log(`\n总计: APPROVED=${approved.length}, REJECTED=${rejected.length}`);
