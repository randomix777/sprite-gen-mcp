#!/usr/bin/env python3
"""
为图标类资产应用 QC 达标处理 - 修复版
确保图标有真正的透明背景（四角 alpha=0）
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

CANVAS_W, CANVAS_H = 256, 256  # 图标画布


def process_icon(input_path, output_path=None):
    """处理图标资产"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像（如果是 RGB，添加透明背景）
    img = Image.open(input_path)
    if img.mode != 'RGBA':
        # 创建透明画布
        rgba = Image.new('RGBA', img.size, (0, 0, 0, 0))
        rgba.paste(img, (0, 0))
        img = rgba
    
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    
    print(f"  输入: {w}x{h}, RGBA")
    
    # 强制二值化 alpha（关键修复）
    # 只有 alpha > 128 的像素才被认为是"主体"
    alpha_bin = (alpha > 128).astype(np.uint8) * 255
    
    # 形态学清理（去除孤立噪点）
    alpha_bin = ndimage.binary_opening(alpha_bin > 0, structure=np.ones((3,3)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((3,3)))
    
    # 只保留最大的连通分量
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            # 如果最大分量太小，保留所有大于阈值的分量
            min_area = 10  # 最小像素数
            valid_labels = np.where(areas[1:] >= min_area)[0] + 1
            if len(valid_labels) > 0:
                alpha_bin = np.isin(labels, valid_labels)
            else:
                alpha_bin = (labels == max_label)
    
    alpha_bin = (alpha_bin * 255).astype(np.uint8)
    
    # 创建新的 RGBA 数组
    result = np.zeros((h, w, 4), dtype=np.uint8)
    result[:, :, :3] = rgb
    result[:, :, 3] = alpha_bin
    
    # Bbox 裁剪（带安全边距）
    mask = alpha_bin > 0
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not (rows.any() and cols.any()):
        print("  ERROR: no opaque pixels")
        return False
    
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    
    # 添加 12% 安全边距
    margin_x = int((xmax - xmin + 1) * 0.12)
    margin_y = int((ymax - ymin + 1) * 0.12)
    ymin = max(0, ymin - margin_y)
    ymax = min(h - 1, ymax + margin_y)
    xmin = max(0, xmin - margin_x)
    xmax = min(w - 1, xmax + margin_x)
    
    crop = result[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]
    
    print(f"  裁剪: {cw}x{ch}")
    
    # 缩放到 256x256
    scale = min(CANVAS_W / cw, CANVAS_H / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    
    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)
    
    # 二值化 alpha（确保干净边缘）
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
    # 居中到画布
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
    
    print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA")
    print(f"  四角 alpha: {corners_alpha}")
    print(f"  透明率: {trans_pct:.1f}%")
    
    return all(c == 0 for c in corners_alpha) and trans_pct > 30


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='文件或目录路径')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if path.is_file():
        if path.suffix == '.png':
            process_icon(path)
        return
    
    if path.is_dir():
        files = list(path.glob('*.png'))
        subdirs = [d for d in path.glob('*') if d.is_dir()]
        
        total = len(files)
        for subdir in subdirs:
            total += len(list(subdir.glob('*.png')))
        
        print(f"找到 {total} 个 PNG 文件")
        
        success = 0
        skipped = 0
        failed = 0
        
        for f in files:
            test = Image.open(f)
            if test.mode == 'RGBA':
                test.close()
                print(f"\n跳过 (已是 RGBA): {f.name}")
                skipped += 1
                continue
            test.close()
            
            if process_icon(f):
                success += 1
            else:
                failed += 1
        
        for subdir in subdirs:
            for f in subdir.glob('*.png'):
                test = Image.open(f)
                if test.mode == 'RGBA':
                    test.close()
                    continue
                test.close()
                
                if process_icon(f):
                    success += 1
                else:
                    failed += 1
        
        print(f"\n{'='*50}")
        print(f"完成: {success} 成功, {failed} 失败, {skipped} 跳过")


if __name__ == '__main__':
    main()
