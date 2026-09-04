#!/usr/bin/env python3
"""批量处理 assets 目录下的 RGB 图像为 RGBA"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

# 切图参数
DIST_THRESHOLD = 60.0
BBOX_PADDING = 20
CANVAS_W, CANVAS_H = 512, 768

def process_image(input_path, output_path=None):
    """处理单个图像：RGB → RGBA + resize + 去噪"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像
    img = Image.open(input_path)
    if img.mode == 'RGBA':
        print("  已经是 RGBA，跳过")
        return True
    
    img = img.convert('RGB')
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
    
    # 欧氏距离切图
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
    
    # 缩放（保持宽高比，留边距）
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
    
    # 二值化 alpha（去除抗锯齿中间值）
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
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_px = (fa[:, :, 3] < 32).sum()
    trans_pct = trans_px / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  输出: {CANVAS_W}x{CANVAS_H}, RGBA")
    print(f"  四角 alpha: {corners_alpha}")
    print(f"  透明率: {trans_pct:.1f}%")
    print(f"  保存: {output_path}")
    
    return all(c == 0 for c in corners_alpha) and trans_pct > 30


def main():
    """处理指定目录下的所有 PNG"""
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='文件或目录路径')
    parser.add_argument('--dry-run', action='store_true', help='只显示不处理')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if path.is_file():
        if path.suffix == '.png':
            process_image(path)
        return
    
    if path.is_dir():
        files = list(path.glob('*.png'))
        print(f"找到 {len(files)} 个 PNG 文件")
        
        success = 0
        failed = 0
        skipped = 0
        
        for f in files:
            # 跳过已经处理过的（RGBA 模式）
            test_img = Image.open(f)
            if test_img.mode == 'RGBA':
                print(f"\n跳过 (已是 RGBA): {f.name}")
                test_img.close()
                skipped += 1
                continue
            test_img.close()
            
            if args.dry_run:
                print(f"\n[DRY RUN] 将处理: {f.name}")
                success += 1
            else:
                if process_image(f):
                    success += 1
                else:
                    failed += 1
        
        print(f"\n{'='*50}")
        print(f"完成: {success} 成功, {failed} 失败, {skipped} 跳过")


if __name__ == '__main__':
    main()
