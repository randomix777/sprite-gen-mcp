#!/usr/bin/env python3
"""
为武器资产应用后处理（保持 512x768 画布）
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

CANVAS_W, CANVAS_H = 512, 768
DIST_THRESHOLD = 60.0
BBOX_PADDING = 40


def postprocess_weapon(input_path, output_path=None):
    """后处理武器资产"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    print(f"  输入: {w}x{h}")
    
    # 如果已经是正确格式，直接保存
    if w == CANVAS_W and h == CANVAS_H and arr[:,:,3].max() > 0:
        # 确保四角透明
        corner_size = 10
        arr[:corner_size, :corner_size, 3] = 0
        arr[:corner_size, -corner_size:, 3] = 0
        arr[-corner_size:, :corner_size, 3] = 0
        arr[-corner_size:, -corner_size:, 3] = 0
        
        # 二值化 alpha
        arr[:, :, 3] = np.where(arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        Image.fromarray(arr, 'RGBA').save(output_path)
        print(f"  ✓ 已保持 512x768 格式")
        return True
    
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
    
    # 缩放到 512x768
    margin_x = int(CANVAS_W * 0.08)
    margin_y = int(CANVAS_H * 0.05)
    effective_w = CANVAS_W - 2 * margin_x
    effective_h = CANVAS_H - 2 * margin_y
    scale = min(effective_w / cw, effective_h / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    
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
            min_area = 20
            valid_labels = np.where(areas[1:] >= min_area)[0] + 1
            if len(valid_labels) > 0:
                alpha_bin = np.isin(labels, valid_labels)
            else:
                alpha_bin = (labels == max_label)
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
    trans_pct = (fa[:, :, 3] < 32).sum() / (CANVAS_W * CANVAS_H) * 100
    body_pct = (fa[:, :, 3] > 32).sum() / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
    print(f"  四角 alpha: {corners_alpha}")
    
    return all(c == 0 for c in corners_alpha)


def main():
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    weapon_dir = project_dir / "assets/weapons"
    
    files = list(weapon_dir.glob('*.png'))
    print(f"处理 {len(files)} 个武器资产...")
    
    success = 0
    skipped = 0
    
    for f in files:
        if 'qc_evidence' in f.name:
            continue
        
        test = Image.open(f)
        if test.mode == 'RGBA' and test.size == (512, 768):
            test.close()
            print(f"\n跳过 (已是 512x768): {f.name}")
            skipped += 1
            continue
        test.close()
        
        if postprocess_weapon(f):
            success += 1
    
    print(f"\n{'='*50}")
    print(f"完成: {success} 成功, {skipped} 跳过")


if __name__ == '__main__':
    main()
