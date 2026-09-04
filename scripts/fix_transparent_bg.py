#!/usr/bin/env python3
"""批量修复有背景的图标资产 - 移除背景，确保透明"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

CANVAS_W, CANVAS_H = 256, 256


def fix_transparent_bg(input_path, output_path=None):
    """修复有背景的资产，移除背景色"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    
    print(f"  输入: {w}x{h}, RGBA")
    
    # 检测背景色（取四角像素）
    corner_size = min(10, w // 4, h // 4)
    corners = [
        rgb[:corner_size, :corner_size].reshape(-1, 3),
        rgb[:corner_size, -corner_size:].reshape(-1, 3),
        rgb[-corner_size:, :corner_size].reshape(-1, 3),
        rgb[-corner_size:, -corner_size:].reshape(-1, 3),
    ]
    bg_rgb = np.mean(np.vstack(corners), axis=0)
    print(f"  背景色: {bg_rgb.astype(int)}")
    
    # 计算每个像素与背景色的距离
    rgb_f = rgb.astype(np.float32)
    dist = np.sqrt(((rgb_f - bg_rgb) ** 2).sum(axis=2))
    
    # 使用距离阈值创建新的 alpha
    new_alpha = np.where(dist > 40, 255, 0).astype(np.uint8)
    
    # 确保四角是透明的
    corner_pixels = corner_size
    new_alpha[:corner_pixels, :corner_pixels] = 0
    new_alpha[:corner_pixels, -corner_pixels:] = 0
    new_alpha[-corner_pixels:, :corner_pixels] = 0
    new_alpha[-corner_pixels:, -corner_pixels:] = 0
    
    # 形态学清理
    new_alpha = ndimage.binary_opening(new_alpha > 0, structure=np.ones((3,3)))
    new_alpha = ndimage.binary_closing(new_alpha, structure=np.ones((3,3)))
    
    # 只保留最大的连通分量（去除噪点）
    labels, num = ndimage.label(new_alpha)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            # 如果最大分量太小，保留所有大于阈值的分量
            min_area = 20
            valid_labels = np.where(areas[1:] >= min_area)[0] + 1
            if len(valid_labels) > 0:
                new_alpha = np.isin(labels, valid_labels)
            else:
                new_alpha = (labels == max_label)
    
    new_alpha = (new_alpha * 255).astype(np.uint8)
    
    # 合并
    result = np.zeros((h, w, 4), dtype=np.uint8)
    result[:, :, :3] = rgb
    result[:, :, 3] = new_alpha
    
    # 检查是否有内容
    if (new_alpha > 0).sum() == 0:
        print("  ERROR: 无内容，保持原图")
        return False
    
    # 裁剪
    mask = new_alpha > 0
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    
    crop = result[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]
    
    # 添加边距（15%）
    margin_x = int(cw * 0.15)
    margin_y = int(ch * 0.15)
    ymin = max(0, ymin - margin_y)
    ymax = min(h - 1, ymax + margin_y)
    xmin = max(0, xmin - margin_x)
    xmax = min(w - 1, xmax + margin_x)
    crop = result[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]
    
    print(f"  裁剪后: {cw}x{ch}")
    
    # 缩放到 256x256
    scale = min(CANVAS_W / cw, CANVAS_H / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    
    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)
    
    # 二值化 alpha
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
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
    body_pct = (fa[:, :, 3] > 32).sum() / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA")
    print(f"  四角 alpha: {corners_alpha}")
    print(f"  透明率: {trans_pct:.1f}%, 主体: {body_pct:.1f}%")
    
    # 检查是否通过 QC
    if corners_alpha == [0, 0, 0, 0] and 0.15 <= body_pct <= 0.85:
        print(f"  ✓ 通过 QC")
        return True
    else:
        print(f"  ✗ 未通过 QC")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='文件或目录路径')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if path.is_file():
        if path.suffix == '.png':
            fix_transparent_bg(path)
        return
    
    if path.is_dir():
        files = list(path.rglob('*.png'))
        # 排除 qc_evidence 文件
        files = [f for f in files if 'qc_evidence' not in f.name]
        
        print(f"找到 {len(files)} 个 PNG 文件")
        
        success = 0
        skipped = 0
        failed = 0
        
        for f in files:
            test = Image.open(f)
            # 检查是否已经是透明背景
            arr = np.array(test)
            if test.mode == 'RGBA' and arr[:,:,3].max() < 255:
                test.close()
                print(f"\n跳过 (已有透明背景): {f.name}")
                skipped += 1
                continue
            test.close()
            
            if fix_transparent_bg(f):
                success += 1
            else:
                failed += 1
        
        print(f"\n{'='*50}")
        print(f"完成: {success} 成功, {failed} 失败, {skipped} 跳过")


if __name__ == '__main__':
    main()
