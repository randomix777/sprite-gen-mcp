#!/usr/bin/env python3
"""
处理 UI 和装备资产 - 增强主体可见性
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import os
import shutil

TARGET_W, TARGET_H = 512, 768
DIST_THRESHOLD = 50.0
BBOX_PADDING = 30


def process_ui_asset(filepath):
    """处理 UI 资产"""
    filename = filepath.name
    print(f"\n处理: {filename}")
    
    try:
        img = Image.open(str(filepath)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
        print(f"  输入: {w}x{h}")
        
        # 计算背景色
        corner_size = min(40, w // 10, h // 10)
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
        
        print(f"  裁剪后: {cw}x{ch}")
        
        # 缩放适配 512x768
        margin_x = int(TARGET_W * 0.05)
        margin_y = int(TARGET_H * 0.05)
        effective_w = TARGET_W - 2 * margin_x
        effective_h = TARGET_H - 2 * margin_y
        scale = min(effective_w / cw, effective_h / ch)
        nw = max(1, int(cw * scale))
        nh = max(1, int(ch * scale))
        
        crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
        crop_arr = np.array(crop_img)
        
        # Alpha 二值化
        crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理
        alpha_bin = crop_arr[:, :, 3] > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 合并小分量
        if num > 1:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                max_label = areas[1:].argmax() + 1
                min_area = 30
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    main_mask = np.isin(labels, valid_labels)
                    main_mask = ndimage.binary_dilation(main_mask, structure=np.ones((5,5)))
                    alpha_bin = main_mask
                else:
                    alpha_bin = (labels == max_label)
        
        crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
        
        # 边缘平滑
        from scipy.ndimage import gaussian_filter
        alpha_smooth = gaussian_filter(crop_arr[:, :, 3].astype(float) / 255.0, sigma=0.5)
        crop_arr[:, :, 3] = (alpha_smooth * 255).astype(np.uint8)
        crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        # 居中到画布
        canvas = np.zeros((TARGET_H, TARGET_W, 4), dtype=np.uint8)
        ox = (TARGET_W - nw) // 2
        oy = TARGET_H - nh - int(TARGET_H * 0.05)
        canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
        
        final = Image.fromarray(canvas, 'RGBA')
        
        # 验证
        fa = np.array(final)
        corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
        trans_pct = (fa[:, :, 3] < 32).sum() / (TARGET_W * TARGET_H) * 100
        body_pct = (fa[:, :, 3] > 32).sum() / (TARGET_W * TARGET_H) * 100
        
        print(f"  ✓ {TARGET_W}x{TARGET_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
        print(f"  连通分量: {num}")
        print(f"  四角 alpha: {corners_alpha}")
        
        # 保存
        temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
        final.save(str(temp_path), 'PNG')
        filepath.unlink()
        shutil.move(str(temp_path), str(filepath))
        
        verify = Image.open(str(filepath))
        result = verify.size == (TARGET_W, TARGET_H) and verify.mode == 'RGBA'
        verify.close()
        
        if result and all(c == 0 for c in corners_alpha) and num >= 1:
            print(f"  ✓ 保存成功")
            return True
        else:
            print(f"  ✗ 保存验证失败")
            return False
        
    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    
    # UI 资产
    ui_dir = project_dir / 'assets/ui'
    ui_files = list(ui_dir.glob('*.png'))
    
    print(f"处理 {len(ui_files)} 个 UI 资产...\n")
    
    success = 0
    for f in ui_files:
        if 'qc_evidence' in f.name or f.name.startswith('.tmp_'):
            continue
        if process_ui_asset(f):
            success += 1
    
    print(f"\nUI 完成: {success}/{len(ui_files)}")
    
    # 装备资产
    equip_dir = project_dir / 'assets/equipment'
    equip_files = []
    for root, dirs, files in os.walk(equip_dir):
        for f in files:
            if f.endswith('.png') and 'qc_evidence' not in f:
                equip_files.append(Path(root) / f)
    
    print(f"\n处理 {len(equip_files)} 个装备资产...\n")
    
    eq_success = 0
    for f in equip_files:
        if process_ui_asset(f):
            eq_success += 1
    
    print(f"\n装备完成: {eq_success}/{len(equip_files)}")
    print(f"\n总计: {success + eq_success} 成功")


if __name__ == '__main__':
    main()
