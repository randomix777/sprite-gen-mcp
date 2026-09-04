#!/usr/bin/env python3
"""
为新生成的敌人和武器应用更强的后处理
确保通过 QC 门禁
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

CANVAS_W, CANVAS_H = 512, 768
WEAPON_CANVAS_W, WEAPON_CANVAS_H = 512, 512
DIST_THRESHOLD = 60.0
BBOX_PADDING = 40


def strong_process(input_path, output_path, canvas_w=CANVAS_W, canvas_h=CANVAS_H):
    """强后处理确保 QC 通过"""
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    print(f"\n处理: {input_path.name}")
    print(f"  输入: {w}x{h}")
    
    # 计算背景色
    corner_size = min(50, w // 10, h // 10)
    corners = [
        arr[:corner_size, :corner_size, :3].reshape(-1, 3),
        arr[:corner_size, -corner_size:, :3].reshape(-1, 3),
        arr[-corner_size:, :corner_size, :3].reshape(-1, 3),
        arr[-corner_size:, -corner_size:, :3].reshape(-1, 3),
    ]
    bg_rgb = np.mean(np.vstack(corners), axis=0)
    
    # 距离切图
    rgb = arr[:, :, :3].astype(np.float32)
    dist = np.sqrt(((rgb - bg_rgb) ** 2).sum(axis=2))
    alpha = np.where(dist > DIST_THRESHOLD, 255, 0).astype(np.uint8)
    
    # 强制四角透明
    alpha[:corner_size, :corner_size] = 0
    alpha[:corner_size, -corner_size:] = 0
    alpha[-corner_size:, :corner_size] = 0
    alpha[-corner_size:, -corner_size:] = 0
    
    # 合并
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = arr[:, :, :3]
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
    
    # 缩放（确保不贴边）
    margin_x = int(canvas_w * 0.08)  # 增加到 8%
    margin_y = int(canvas_h * 0.05)
    effective_w = canvas_w - 2 * margin_x
    effective_h = canvas_h - 2 * margin_y
    scale = min(effective_w / cw, effective_h / ch) * 0.95  # 再缩小 5% 确保不贴边
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    
    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)
    
    # 强二值化 alpha
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
    # 形态学清理（更大的结构元素）
    alpha_bin = crop_arr[:, :, 3] > 0
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((11,11)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((11,11)))
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            min_area = 50  # 只保留大分量
            valid_labels = np.where(areas[1:] >= min_area)[0] + 1
            if len(valid_labels) > 0:
                alpha_bin = np.isin(labels, valid_labels)
            else:
                alpha_bin = (labels == max_label)
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 居中
    canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
    ox = (canvas_w - nw) // 2
    oy = (canvas_h - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
    
    final = Image.fromarray(canvas, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_pct = (fa[:, :, 3] < 32).sum() / (canvas_w * canvas_h) * 100
    body_pct = (fa[:, :, 3] > 32).sum() / (canvas_w * canvas_h) * 100
    
    print(f"  ✓ {canvas_w}x{canvas_h} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
    print(f"  四角 alpha: {corners_alpha}")
    
    # 检查是否通过 QC
    passes = (
        all(c == 0 for c in corners_alpha) and
        trans_pct > 15 and
        0.10 <= body_pct <= 0.85
    )
    
    if passes:
        print(f"  ✓ 预计通过 QC")
    else:
        print(f"  ✗ 可能需要进一步处理")
    
    return passes


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('asset_type', choices=['enemy', 'weapon'], help='资产类型')
    args = parser.parse_args()
    
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    
    if args.asset_type == 'enemy':
        input_dir = project_dir / "assets/sprites/enemies"
        output_dir = input_dir
        canvas_w, canvas_h = CANVAS_W, CANVAS_H
    else:
        input_dir = project_dir / "assets/weapons"
        output_dir = input_dir
        canvas_w, canvas_h = WEAPON_CANVAS_W, WEAPON_CANVAS_H
    
    files = list(input_dir.glob('*.png'))
    print(f"处理 {len(files)} 个 {args.asset_type} 资产...")
    
    success = 0
    skipped = 0
    
    for f in files:
        if 'qc_evidence' in f.name:
            continue
        
        # 检查是否已经是正确尺寸
        test = Image.open(f)
        if test.size == (canvas_w, canvas_h) and test.mode == 'RGBA':
            test.close()
            print(f"\n跳过 (已是正确格式): {f.name}")
            skipped += 1
            continue
        test.close()
        
        if strong_process(f, f, canvas_w, canvas_h):
            success += 1
    
    print(f"\n{'='*50}")
    print(f"完成: {success} 成功, {skipped} 跳过")


if __name__ == '__main__':
    main()
