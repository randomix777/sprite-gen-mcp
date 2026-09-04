import { auditAssets } from '../lib/audit.js';

const r = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets', 
  strict: true, 
  asset_type: 'cover_prop', 
  recursive: true 
});

const approved = r.data.assets.filter(a => a.status === 'APPROVED' && !a.asset_path.includes('qc_evidence'));
const rejected = r.data.assets.filter(a => a.status === 'REJECTED' && !a.asset_path.includes('qc_evidence'));

console.log('Total:', r.data.assets.length, '| APPROVED:', approved.length, '| REJECTED:', rejected.length);
console.log();

// 按目录分组
const groups = {};
for (const a of rejected) {
  const parts = a.asset_path.split(/[/\\]/);
  const idx = parts.findIndex(p => p === 'assets');
  const dir = idx >= 0 ? parts[idx + 1] : 'unknown';
  if (!groups[dir]) groups[dir] = [];
  groups[dir].push(a);
}

console.log('=== REJECTED BY DIRECTORY ===');
for (const [dir, assets] of Object.entries(groups).sort()) {
  console.log(dir + ':', assets.length);
  for (const a of assets.slice(0, 5)) {
    const name = a.asset_path.split(/[/\\]/).pop();
    console.log('  -', name, '-', a.hard_failures?.join(','));
  }
  if (assets.length > 5) {
    console.log('  ... and', assets.length - 5, 'more');
  }
}
