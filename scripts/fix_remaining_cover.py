#!/usr/bin/env python3
"""
处理剩余的掩体资产
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import os
import shutil

DIST_THRESHOLD = 45.0
BBOX_PADDING = 40


def process_cover(filepath):
    """处理掩体资产"""
    filename = filepath.name
    print(f"\n处理: {filename}")
    
    try:
        img = Image.open(str(filepath)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
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
        
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, :3] = arr[:, :, :3]
        rgba[:, :, 3] = alpha
        
        # Alpha 二值化
        alpha = np.where(alpha >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理
        alpha_bin = alpha > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((9,9)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((9,9)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 合并小分量
        if num > 1:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                min_area = 20
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    main_mask = np.isin(labels, valid_labels)
                    for _ in range(3):
                        main_mask = ndimage.binary_dilation(main_mask, structure=np.ones((7,7)))
                    alpha_bin = main_mask
                    num = 1
        
        alpha = (alpha_bin * 255).astype(np.uint8)
        
        # 边缘平滑
        from scipy.ndimage import gaussian_filter
        alpha_smooth = gaussian_filter(alpha.astype(float) / 255.0, sigma=0.8)
        alpha = np.where(alpha_smooth >= 0.5, 255, 0).astype(np.uint8)
        
        # 重建 RGBA
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
        
        print(f"  ✓ {w}x{h} RGBA, 分量: {num}")
        
        # 保存
        temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
        final = Image.fromarray(np.zeros((h, w, 4), dtype=np.uint8), 'RGBA')
        final.paste(Image.fromarray(crop, 'RGBA'), (0, 0))
        final.save(str(temp_path), 'PNG')
        filepath.unlink()
        shutil.move(str(temp_path), str(filepath))
        
        verify = Image.open(str(filepath))
        result = verify.size == (w, h) and verify.mode == 'RGBA'
        verify.close()
        
        if result and num >= 1:
            print(f"  ✓ 保存成功")
            return True
        else:
            print(f"  ✗ 保存验证失败")
            return False
        
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


def main():
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    cover_dir = project_dir / 'assets/cover'
    
    # 需要处理的文件
    files_to_fix = [
        'barrier_concrete.png',
        'burnt_car.png',
        'chain_lock_door.png',
        'wooden_crate.png',
    ]
    
    print(f"处理 {len(files_to_fix)} 个掩体资产...\n")
    
    success = 0
    for f in files_to_fix:
        filepath = cover_dir / f
        if not filepath.exists():
            print(f"\n跳过（不存在）: {f}")
            continue
        if process_cover(filepath):
            success += 1
    
    print(f"\n完成: {success}/{len(files_to_fix)}")


if __name__ == '__main__':
    main()
