import { auditAssets } from '../lib/audit.js';

// Run multiple audits with different style profiles
const results = {};

// 1. Weapons
const wr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/weapons', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'weapon'
});
results.weapons = { total: wr.data.assets.length, approved: 0, rejected: 0 };
for (const a of wr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    if (a.status === 'APPROVED') results.weapons.approved++;
    else results.weapons.rejected++;
  }
}

// 2. Enemies
const er = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/sprites/enemies', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'character'
});
results.enemies = { total: er.data.assets.length, approved: 0, rejected: 0 };
for (const a of er.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    if (a.status === 'APPROVED') results.enemies.approved++;
    else results.enemies.rejected++;
  }
}

// 3. Containers
const cr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/containers', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'container'
});
results.containers = { total: cr.data.assets.length, approved: 0, rejected: 0 };
for (const a of cr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    if (a.status === 'APPROVED') results.containers.approved++;
    else results.containers.rejected++;
  }
}

// 4. UI
const ur = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/ui', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'ui'
});
results.ui = { total: ur.data.assets.length, approved: 0, rejected: 0 };
for (const a of ur.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    if (a.status === 'APPROVED') results.ui.approved++;
    else results.ui.rejected++;
  }
}

// 5. Icons
const ir = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/icons', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'icon'
});
results.icons = { total: ir.data.assets.length, approved: 0, rejected: 0 };
for (const a of ir.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    if (a.status === 'APPROVED') results.icons.approved++;
    else results.icons.rejected++;
  }
}

// Summary
console.log('=== ASSET QC SUMMARY ===');
console.log();
for (const [name, data] of Object.entries(results)) {
  const pct = data.total > 0 ? Math.round(data.approved / data.total * 100) : 0;
  console.log(`${name}: ${data.approved}/${data.total} (${pct}%)`);
}
console.log();

// Total
const total = Object.values(results).reduce((s, r) => s + r.total, 0);
const approved = Object.values(results).reduce((s, r) => s + r.approved, 0);
console.log(`TOTAL: ${approved}/${total}`);
