/** Generic asset and visual-style presets shared by the workflow and UI. */
export const ASSET_PROFILES = Object.freeze({
  prop: { label: '场景道具', description: '可放置在场景中的物件', defaultViews: ['three_quarter', 'front', 'end_profile'], defaultStates: ['intact', 'damaged', 'rubble'] },
  character: { label: '角色', description: '可动画角色或生物', defaultViews: ['front', 'rear', 'three_quarter'], defaultStates: ['idle', 'walk', 'attack'] },
  weapon: { label: '武器', description: '装备、枪械或近战武器', defaultViews: ['three_quarter', 'front', 'rear'], defaultStates: ['intact', 'equipped', 'damaged'] },
  vehicle: { label: '载具', description: '车辆、飞行器或其他载具', defaultViews: ['three_quarter', 'front', 'rear'], defaultStates: ['intact', 'damaged', 'destroyed'] },
  tile: { label: '地块 / 瓦片', description: '可平铺的环境图块', defaultViews: ['front', 'top_down'], defaultStates: ['base', 'variant_a', 'variant_b'] },
  background: { label: '背景', description: '场景背景或远景图', defaultViews: ['front', 'three_quarter'], defaultStates: ['day', 'night', 'weather'] },
  ui: { label: 'UI 元素', description: '图标、按钮和界面装饰', defaultViews: ['front'], defaultStates: ['normal', 'hover', 'pressed'] },
  effect: { label: '特效', description: '粒子、爆炸或魔法效果', defaultViews: ['front', 'three_quarter'], defaultStates: ['start', 'active', 'end'] }
});

export const ASSET_TYPE_IDS = Object.freeze(Object.keys(ASSET_PROFILES));

export const STYLE_PROFILES = Object.freeze({
  clean_game: { label: '清晰游戏资产', description: '干净轮廓、统一光照、透明背景' },
  pixel_art: { label: '像素风', description: '硬边缘、有限色板、无抗锯齿' },
  painted: { label: '手绘插画', description: '可见笔触、丰富材质和柔和光影' },
  concept: { label: '概念设计', description: '设计稿质感，强调形体和材质' }
});

export const STYLE_PROFILE_IDS = Object.freeze(Object.keys(STYLE_PROFILES));

export function getAssetProfile(assetType = 'prop') {
  return ASSET_PROFILES[assetType] || ASSET_PROFILES.prop;
}
