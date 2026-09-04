import { auditAssets } from '../lib/audit.js';

const results = {};

// 1. UI
const ur = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/ui', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'ui'
});
results.ui = { total: 0, approved: 0, rejected: 0 };
for (const a of ur.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.ui.total++;
    if (a.status === 'APPROVED') results.ui.approved++;
    else results.ui.rejected++;
  }
}

// 2. Weapons
const wr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/weapons', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'weapon'
});
results.weapons = { total: 0, approved: 0, rejected: 0 };
for (const a of wr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.weapons.total++;
    if (a.status === 'APPROVED') results.weapons.approved++;
    else results.weapons.rejected++;
  }
}

// 3. Enemies
const er = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/sprites/enemies', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'character'
});
results.enemies = { total: 0, approved: 0, rejected: 0 };
for (const a of er.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.enemies.total++;
    if (a.status === 'APPROVED') results.enemies.approved++;
    else results.enemies.rejected++;
  }
}

// 4. Containers
const cr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/containers', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'container'
});
results.containers = { total: 0, approved: 0, rejected: 0 };
for (const a of cr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.containers.total++;
    if (a.status === 'APPROVED') results.containers.approved++;
    else results.containers.rejected++;
  }
}

// 5. Equipment
const eqr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/equipment', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'character'
});
results.equipment = { total: 0, approved: 0, rejected: 0 };
for (const a of eqr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.equipment.total++;
    if (a.status === 'APPROVED') results.equipment.approved++;
    else results.equipment.rejected++;
  }
}

// 6. Cover
const covr = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/cover', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'container'
});
results.cover = { total: 0, approved: 0, rejected: 0 };
for (const a of covr.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.cover.total++;
    if (a.status === 'APPROVED') results.cover.approved++;
    else results.cover.rejected++;
  }
}

// 7. Buildings
const br = await auditAssets({ 
  input_path: 'D:/Projects/CodeChronoBullet/assets/buildings', 
  strict: true, 
  asset_type: 'cover_prop',
  style_profile: 'building'
});
results.buildings = { total: 0, approved: 0, rejected: 0 };
for (const a of br.data.assets) {
  if (!a.asset_path.includes('qc_evidence')) {
    results.buildings.total++;
    if (a.status === 'APPROVED') results.buildings.approved++;
    else results.buildings.rejected++;
  }
}

// Summary
console.log('=== FINAL ASSET QC SUMMARY ===\n');
console.log('Category       | Total | Approved | Rejected | Rate');
console.log('---------------|-------|----------|----------|------');
for (const [name, data] of Object.entries(results)) {
  const rate = data.total > 0 ? Math.round(data.approved / data.total * 100) : 0;
  console.log(`${name.padEnd(14)} | ${String(data.total).padStart(5)} | ${String(data.approved).padStart(8)} | ${String(data.rejected).padStart(8)} | ${rate}%`);
}
console.log('---------------|-------|----------|----------|------');

const total = Object.values(results).reduce((s, r) => s + r.total, 0);
const approved = Object.values(results).reduce((s, r) => s + r.approved, 0);
console.log(`TOTAL         | ${String(total).padStart(5)} | ${String(approved).padStart(8)} | ${String(total - approved).padStart(8)} | ${Math.round(approved/total*100)}%`);
