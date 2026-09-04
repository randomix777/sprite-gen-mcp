#!/usr/bin/env python3
"""批量处理 cover 资产：从 RGB 转换为 RGBA 并添加透明背景"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

# 切图参数
DIST_THRESHOLD = 60.0
BBOX_PADDING = 20
CANVAS_W, CANVAS_H = 512, 768

def process_cover_asset(input_path, output_path):
    """处理单个 cover 资产"""
    print(f"\nProcessing: {input_path.split('/')[-1]}")
    
    # 读取图像
    img = Image.open(input_path)
    if img.mode == 'RGBA':
        print("  Already RGBA, skipping")
        return True
    
    # 转为 RGBA
    img = img.convert('RGB')
    rgb = np.array(img)
    h, w = rgb.shape[:2]
    print(f"  Input: {w}x{h}, RGB mode")
    
    # 计算背景色（四角均值）
    corner_size = min(50, w // 10, h // 10)
    corners = [
        rgb[:corner_size, :corner_size].reshape(-1, 3),
        rgb[:corner_size, -corner_size:].reshape(-1, 3),
        rgb[-corner_size:, :corner_size].reshape(-1, 3),
        rgb[-corner_size:, -corner_size:].reshape(-1, 3),
    ]
    bg_rgb = np.mean(np.vstack(corners), axis=0)
    print(f"  Background RGB: {bg_rgb}")
    
    # 欧氏距离切图
    rgb_f = rgb.astype(np.float32)
    dist = np.sqrt(((rgb_f - bg_rgb) ** 2).sum(axis=2))
    alpha = np.where(dist > DIST_THRESHOLD, 255, 0).astype(np.uint8)
    trans_ratio = (alpha == 0).sum() / alpha.size * 100
    print(f"  Cutout: transparent={trans_ratio:.1f}%")
    
    # 合并为 RGBA
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = alpha
    
    # Bbox 裁剪
    mask = alpha > 0
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not (rows.any() and cols.any()):
        print("  ERROR: no opaque pixels")
        return False
    
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    ymin = max(0, ymin - BBOX_PADDING)
    ymax = min(h - 1, ymax + BBOX_PADDING)
    xmin = max(0, xmin - BBOX_PADDING)
    xmax = min(w - 1, xmax + BBOX_PADDING)
    
    crop = rgba[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]
    print(f"  Crop: {cw}x{ch}")
    
    # 缩放
    scale = min(CANVAS_W / cw, CANVAS_H / ch) * 0.9  # 留 10% margin
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    print(f"  Scale: {cw}x{ch} -> {nw}x{nh}")

    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)

    # 二值化 alpha（去除抗锯齿中间值）
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)

    # 形态学清理（去除噪点和小空洞）
    from scipy import ndimage
    alpha_bin = crop_arr[:, :, 3] > 0
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((3,3)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((3,3)))
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 二值化 alpha
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
    # 形态学清理
    alpha_bin = crop_arr[:, :, 3] > 0
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((3,3)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((3,3)))
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 居中到画布
    canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
    ox = (CANVAS_W - nw) // 2
    oy = (CANVAS_H - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
    
    final = Image.fromarray(canvas, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [
        fa[0, 0, 3], fa[0, -1, 3],
        fa[-1, 0, 3], fa[-1, -1, 3]
    ]
    trans_px = (fa[:, :, 3] < 32).sum()
    trans_pct = trans_px / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  Output: {CANVAS_W}x{CANVAS_H}, RGBA")
    print(f"  Corners: {corners_alpha} (all should be 0)")
    print(f"  Transparency: {trans_pct:.1f}%")
    print(f"  Saved: {output_path}")
    
    return all(c == 0 for c in corners_alpha) and trans_pct > 35

# 主流程
COVER_DIR = 'D:/Projects/CodeChronoBullet/assets/cover'
IMPORTS = [
    'barrier_concrete',
    'broken_window',
    'burnt_car',
    'chain_lock_door',
    'concrete_wall_broken',
    'ladder_section',
    'metal_door_closed',
    'metal_door_open',
    'metal_shelf',
    'metal_shelving_full',
    'sandbag_wall',
    'wooden_crate',
    'wooden_door_breached',
    'wooden_door_closed',
    'wooden_door_open',
]

if __name__ == '__main__':
    success = 0
    failed = 0
    
    for name in IMPORTS:
        input_path = f'{COVER_DIR}/{name}.png'
        output_path = f'{COVER_DIR}/{name}.png'
        
        try:
            if process_cover_asset(input_path, output_path):
                success += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"Summary: {success} passed, {failed} failed")
