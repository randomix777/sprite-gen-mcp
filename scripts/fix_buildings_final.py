#!/usr/bin/env python3
"""
处理建筑资产 - 应用最强的 alpha 清理
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import os
import shutil

DIST_THRESHOLD = 40.0  # 极低阈值
BBOX_PADDING = 50


def process_building(filepath):
    """处理建筑资产"""
    filename = filepath.name
    print(f"\n处理: {filename}")
    
    try:
        img = Image.open(str(filepath)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
        print(f"  输入: {w}x{h}")
        
        # 计算背景色
        corner_size = min(60, w // 10, h // 10)
        corners = [
            arr[:corner_size, :corner_size, :3].reshape(-1, 3),
            arr[:corner_size, -corner_size:, :3].reshape(-1, 3),
            arr[-corner_size:, :corner_size, :3].reshape(-1, 3),
            arr[-corner_size:, -corner_size:, :3].reshape(-1, 3),
        ]
        bg_rgb = np.mean(np.vstack(corners), axis=0)
        
        # 距离切图（极低阈值）
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
        
        # 形态学清理 - 最强连接
        alpha_bin = alpha > 0
        # 打开操作去噪
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((15,15)))
        # 关闭操作填充空隙
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((15,15)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 合并所有分量到主体
        if num > 1:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                min_area = 10
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    main_mask = np.isin(labels, valid_labels)
                    # 强力膨胀连接
                    for _ in range(8):
                        main_mask = ndimage.binary_dilation(main_mask, structure=np.ones((11,11)))
                    alpha_bin = main_mask
                    num = 1
        
        alpha = (alpha_bin * 255).astype(np.uint8)
        
        # 边缘平滑 - 更激进
        from scipy.ndimage import gaussian_filter
        alpha_smooth = gaussian_filter(alpha.astype(float) / 255.0, sigma=1.5)
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
        
        print(f"  裁剪后: {cw}x{ch}, 分量: {num}")
        
        # 居中到画布
        target_w, target_h = w, h
        canvas = np.zeros((target_h, target_w, 4), dtype=np.uint8)
        ox = (target_w - cw) // 2
        oy = (target_h - ch) // 2
        canvas[oy:oy+ch, ox:ox+cw, :] = crop
        
        final = Image.fromarray(canvas, 'RGBA')
        
        # 验证
        fa = np.array(final)
        corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
        trans_pct = (fa[:, :, 3] < 32).sum() / (target_w * target_h) * 100
        body_pct = (fa[:, :, 3] > 32).sum() / (target_w * target_h) * 100
        
        # Python 端 checkerboard 检测
        def compute_cb_score(alpha_bin):
            scores = []
            h2, w2 = alpha_bin.shape
            for scale in [1, 2, 4, 8, 16, 32, 64]:
                if w2 < scale*4 or h2 < scale*2: continue
                pattern = np.indices((h2, w2))
                checker = ((pattern[0]//scale) + (pattern[1]//scale)) % 2
                alpha_norm = (alpha_bin.astype(float) - alpha_bin.mean()) / (alpha_bin.std() + 1e-10)
                checker_norm = (checker.astype(float) - 0.5) * 2
                corr = np.abs(np.sum(alpha_norm * checker_norm) / (h2*w2))
                scores.append(corr)
            return max(scores) if scores else 0
        
        cb_score = compute_cb_score(final.convert('L').numpy() > 128)
        
        print(f"  ✓ {target_w}x{target_h} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
        print(f"  Python CB score: {cb_score:.6f}")
        print(f"  四角 alpha: {corners_alpha}")
        
        # 保存
        temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
        final.save(str(temp_path), 'PNG')
        filepath.unlink()
        shutil.move(str(temp_path), str(filepath))
        
        verify = Image.open(str(filepath))
        result = verify.size == (target_w, target_h) and verify.mode == 'RGBA'
        verify.close()
        
        if result and all(c == 0 for c in corners_alpha):
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
    
    building_files = [
        project_dir / 'assets/buildings/basement/basement_section_v2.png',
        project_dir / 'assets/buildings/residential/two_story_townhouse_v2.png',
        project_dir / 'assets/buildings/shop/corner_shop_v2.png',
    ]
    
    print(f"处理 {len(building_files)} 个建筑资产...\n")
    
    success = 0
    for f in building_files:
        if not f.exists():
            print(f"\n跳过（不存在）: {f.name}")
            continue
        if process_building(f):
            success += 1
    
    print(f"\n建筑完成: {success}/{len(building_files)}")


if __name__ == '__main__':
    main()
