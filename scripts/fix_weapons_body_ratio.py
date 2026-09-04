#!/usr/bin/env python3
"""
重新处理失败的武器 - 增强主体可见性
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import os
import shutil

TARGET_W, TARGET_H = 512, 768
DIST_THRESHOLD = 40.0  # 降低阈值以保留更多细节
BBOX_PADDING = 40


def process_weapon(filepath, output_path=None):
    """处理单个武器"""
    input_path = Path(filepath).resolve()
    if output_path is None:
        output_path = input_path
    else:
        output_path = Path(output_path).resolve()
    
    filename = input_path.name
    print(f"\n处理: {filename}")
    
    try:
        # 读取图像
        img = Image.open(str(input_path)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
        print(f"  输入: {w}x{h}")
        
        # 计算背景色
        corner_size = min(30, w // 10, h // 10)
        corners = [
            arr[:corner_size, :corner_size, :3].reshape(-1, 3),
            arr[:corner_size, -corner_size:, :3].reshape(-1, 3),
            arr[-corner_size:, :corner_size, :3].reshape(-1, 3),
            arr[-corner_size:, -corner_size:, :3].reshape(-1, 3),
        ]
        bg_rgb = np.mean(np.vstack(corners), axis=0)
        
        # 距离切图（使用较低阈值保留更多细节）
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
        
        print(f"  裁剪后: {cw}x{ch}")
        
        # 缩放适配 512x768（使用更大填充）
        margin_x = int(TARGET_W * 0.08)
        margin_y = int(TARGET_H * 0.06)
        effective_w = TARGET_W - 2 * margin_x
        effective_h = TARGET_H - 2 * margin_y
        scale = min(effective_w / cw, effective_h / ch)
        nw = max(1, int(cw * scale))
        nh = max(1, int(ch * scale))
        
        crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
        crop_arr = np.array(crop_img)
        
        # Alpha 二值化
        crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理 - 使用较小的结构元素以保持细节
        alpha_bin = crop_arr[:, :, 3] > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((5,5)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((5,5)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 合并小的连通分量到主体
        if num > 1:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                max_label = areas[1:].argmax() + 1
                min_area = 20  # 更小的最小面积
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    # 将小分量合并到最近的大分量
                    main_mask = np.isin(labels, valid_labels)
                    # 对主掩码进行膨胀连接
                    main_mask = ndimage.binary_dilation(main_mask, structure=np.ones((3,3)))
                    alpha_bin = main_mask
                else:
                    alpha_bin = (labels == max_label)
        
        crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
        
        # 边缘平滑
        from scipy.ndimage import gaussian_filter
        alpha_smooth = gaussian_filter(crop_arr[:, :, 3].astype(float) / 255.0, sigma=0.3)
        crop_arr[:, :, 3] = (alpha_smooth * 255).astype(np.uint8)
        crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        # 重新计算连通分量
        final_mask = crop_arr[:, :, 3] > 0
        labels, num = ndimage.label(final_mask)
        
        # 居中到画布（底部对齐）
        canvas = np.zeros((TARGET_H, TARGET_W, 4), dtype=np.uint8)
        ox = (TARGET_W - nw) // 2
        oy = TARGET_H - nh - int(TARGET_H * 0.03)
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
        temp_path = input_path.parent / f'.tmp_{input_path.stem}.png'
        final.save(str(temp_path), 'PNG')
        input_path.unlink()
        shutil.move(str(temp_path), str(output_path))
        
        # 验证保存成功
        verify = Image.open(str(output_path))
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
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--files', nargs='+', help='要处理的文件列表')
    args = parser.parse_args()
    
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    weapon_dir = project_dir / 'assets/weapons'
    
    # 需要处理的武器
    weapons_to_fix = [
        'ak47.png', 'bolt_action_rifle.png', 'colt_saa.png', 
        'double_barrel_shotgun.png', 'flintlock_musket.png', 
        'mp5_smg.png', 'pump_shotgun.png'
    ]
    
    if args.files:
        weapons_to_fix = args.files
    
    print(f"处理 {len(weapons_to_fix)} 个武器资产...\n")
    
    success = 0
    failed = 0
    
    for weapon_file in weapons_to_fix:
        filepath = weapon_dir / weapon_file
        if not filepath.exists():
            print(f"\n跳过（不存在）: {weapon_file}")
            continue
        
        if process_weapon(filepath):
            success += 1
        else:
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"完成: {success} 成功, {failed} 失败")


if __name__ == '__main__':
    main()
