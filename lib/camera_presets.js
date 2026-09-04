export const CAMERA_PRESETS = Object.freeze({
  end_profile: {
    label: '短边端面侧视',
    description: '从物体窄端看过去；长边向屏幕内部延伸。',
  },
  long_elevation: {
    label: '长边正立面',
    description: '展示物体最长、最宽的正立面，不显示顶面。',
  },
  front: {
    label: '正面正交',
    description: '正对物体主要正面，完全无透视。',
  },
  rear: {
    label: '背面正交',
    description: '正对物体背面，完全无透视。',
  },
  top_down: {
    label: '正交俯视',
    description: '相机垂直向下，只展示顶部轮廓。',
  },
  three_quarter: {
    label: '3/4 展示视角',
    description: '同时展示正面、侧面和少量顶面。',
  },
  isometric: {
    label: '等距视角',
    description: '固定等距投影，适合等距游戏资产。',
  },
});

export const CAMERA_PRESET_IDS = Object.freeze(Object.keys(CAMERA_PRESETS));
