#!/usr/bin/env python3
"""批量修复 RGB 图像的 RGBA 转换问题"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

CANVAS_W, CANVAS_H = 512, 768
DIST_THRESHOLD = 60.0
BBOX_PADDING = 30


def fix_rgba(input_path, output_path=None):
    """将 RGB 图像转换为 RGBA 并处理"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像
    img = Image.open(input_path).convert('RGB')
    rgb = np.array(img)
    h, w = rgb.shape[:2]
    print(f"  输入: {w}x{h}, RGB")
    
    # 计算背景色（四角均值）
    corner_size = min(50, w // 10, h // 10)
    corners = [
        rgb[:corner_size, :corner_size].reshape(-1, 3),
        rgb[:corner_size, -corner_size:].reshape(-1, 3),
        rgb[-corner_size:, :corner_size].reshape(-1, 3),
        rgb[-corner_size:, -corner_size:].reshape(-1, 3),
    ]
    bg_rgb = np.mean(np.vstack(corners), axis=0)
    print(f"  背景色: {bg_rgb.astype(int)}")
    
    # 距离切图
    rgb_f = rgb.astype(np.float32)
    dist = np.sqrt(((rgb_f - bg_rgb) ** 2).sum(axis=2))
    alpha = np.where(dist > DIST_THRESHOLD, 255, 0).astype(np.uint8)
    trans_ratio = (alpha == 0).sum() / alpha.size * 100
    print(f"  透明率: {trans_ratio:.1f}%")
    
    # 合并为 RGBA
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = alpha
    
    # Bbox 裁剪
    mask = alpha > 0
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not (rows.any() and cols.any()):
        print("  ERROR: 无可识别物体")
        return False
    
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    ymin = max(0, ymin - BBOX_PADDING)
    ymax = min(h - 1, ymax + BBOX_PADDING)
    xmin = max(0, xmin - BBOX_PADDING)
    xmax = min(w - 1, xmax + BBOX_PADDING)
    
    crop = rgba[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]
    print(f"  裁剪: {cw}x{ch}")
    
    # 缩放
    margin_x = int(CANVAS_W * 0.05)
    margin_y = int(CANVAS_H * 0.03)
    effective_w = CANVAS_W - 2 * margin_x
    effective_h = CANVAS_H - 2 * margin_y
    scale = min(effective_w / cw, effective_h / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    print(f"  缩放: {cw}x{ch} -> {nw}x{nh}")
    
    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)
    
    # 二值化 alpha
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
    # 形态学清理
    alpha_bin = crop_arr[:, :, 3] > 0
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            alpha_bin = (labels == max_label)
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 居中
    canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
    ox = (CANVAS_W - nw) // 2
    oy = (CANVAS_H - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
    
    final = Image.fromarray(canvas, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_pct = (fa[:, :, 3] < 32).sum() / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  输出: {CANVAS_W}x{CANVAS_H} RGBA")
    print(f"  四角 alpha: {corners_alpha}")
    print(f"  透明率: {trans_pct:.1f}%")
    
    return all(c == 0 for c in corners_alpha) and trans_pct > 20


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='文件或目录路径')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if path.is_file():
        if path.suffix == '.png':
            fix_rgba(path)
        return
    
    if path.is_dir():
        files = list(path.glob('*.png'))
        print(f"找到 {len(files)} 个 PNG 文件")
        
        success = 0
        skipped = 0
        failed = 0
        
        for f in files:
            # 跳过已经是 RGBA 的
            test = Image.open(f)
            if test.mode == 'RGBA':
                print(f"\n跳过 (已是 RGBA): {f.name}")
                test.close()
                skipped += 1
                continue
            test.close()
            
            if fix_rgba(f):
                success += 1
            else:
                failed += 1
        
        print(f"\n{'='*50}")
        print(f"完成: {success} 成功, {failed} 失败, {skipped} 跳过")


if __name__ == '__main__':
    main()
