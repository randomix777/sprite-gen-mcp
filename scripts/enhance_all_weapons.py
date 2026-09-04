#!/usr/bin/env python3
"""
生成缺失的武器资产
根据 AGNES_ART_PROMPTS.md 设计文档
"""
import subprocess
import sys
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import urllib.request
import json

PROJECT_DIR = Path(r"D:/Projects/CodeChronoBullet")
WEAPON_DIR = PROJECT_DIR / "assets/weapons"
CANVAS_W, CANVAS_H = 512, 768


def generate_weapon_simple(weapon_name, prompt, output_filename):
    """生成单个武器（简化版，使用 Agnes API）"""
    output_path = WEAPON_DIR / output_filename
    
    print(f"\n{'='*50}")
    print(f"武器: {weapon_name}")
    print(f"输出: {output_filename}")
    
    # 如果文件已存在且是正确格式，跳过
    if output_path.exists():
        img = Image.open(str(output_path))
        if img.size == (CANVAS_W, CANVAS_H) and img.mode == 'RGBA':
            img.close()
            print(f"  ✓ 已存在且格式正确，跳过")
            return True
        img.close()
    
    # 生成武器（使用 Agnes API）
    print(f"  生成中...")
    
    # 这里应该调用 Agnes API，但为了快速测试，我们先用后处理修复现有武器
    # 或者重新生成缺失的武器
    pass
    
    return False


def enhance_existing_weapons():
    """增强现有武器，修复 QC 问题"""
    weapons_to_fix = [
        'ak47.png', 'bolt_action_rifle.png', 'colt_saa.png', 'desert_eagle.png',
        'double_barrel_shotgun.png', 'flintlock_musket.png', 'mauser_c96.png',
        'mp5_smg.png', 'pump_shotgun.png', 'shotgun_pump.png'
    ]
    
    for weapon_file in weapons_to_fix:
        filepath = WEAPON_DIR / weapon_file
        if not filepath.exists():
            print(f"\n跳过（不存在）: {weapon_file}")
            continue
        
        print(f"\n{'='*50}")
        print(f"处理: {weapon_file}")
        
        try:
            # 读取图像
            img = Image.open(str(filepath)).convert('RGBA')
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
            
            # 距离切图（使用较高阈值减少过渡像素）
            rgb = arr[:, :, :3].astype(np.float32)
            dist = np.sqrt(((rgb - bg_rgb) ** 2).sum(axis=2))
            alpha = np.where(dist > 50.0, 255, 0).astype(np.uint8)
            
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
                continue
            
            ymin, ymax = np.where(rows)[0][[0, -1]]
            xmin, xmax = np.where(cols)[0][[0, -1]]
            ymin = max(0, ymin - 30)
            ymax = min(h - 1, ymax + 30)
            xmin = max(0, xmin - 30)
            xmax = min(w - 1, xmax + 30)
            
            crop = rgba[ymin:ymax+1, xmin:xmax+1]
            ch, cw = crop.shape[:2]
            
            print(f"  裁剪后: {cw}x{ch}")
            
            # 缩放适配 512x768（使用更大填充以增大主体比例）
            margin_x = int(CANVAS_W * 0.08)
            margin_y = int(CANVAS_H * 0.06)
            effective_w = CANVAS_W - 2 * margin_x
            effective_h = CANVAS_H - 2 * margin_y
            scale = min(effective_w / cw, effective_h / ch)
            nw = max(1, int(cw * scale))
            nh = max(1, int(ch * scale))
            
            crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
            crop_arr = np.array(crop_img)
            
            # 二值化 alpha
            crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
            
            # 形态学清理 - 连接分散部分
            alpha_bin = crop_arr[:, :, 3] > 0
            alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
            alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
            
            # 连通分量分析 - 只保留最大的
            labels, num = ndimage.label(alpha_bin)
            if num > 0:
                areas = np.bincount(labels.ravel())
                if len(areas) > 1:
                    max_label = areas[1:].argmax() + 1
                    min_area = 50
                    valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                    if len(valid_labels) > 0:
                        alpha_bin = np.isin(labels, valid_labels)
                    else:
                        alpha_bin = (labels == max_label)
            
            crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
            
            # 边缘平滑
            from scipy.ndimage import gaussian_filter
            alpha_smooth = gaussian_filter(crop_arr[:, :, 3].astype(float) / 255.0, sigma=0.5)
            crop_arr[:, :, 3] = (alpha_smooth * 255).astype(np.uint8)
            crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
            
            # 居中到画布
            canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
            ox = (CANVAS_W - nw) // 2
            oy = CANVAS_H - nh - int(CANVAS_H * 0.05)
            canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
            
            final = Image.fromarray(canvas, 'RGBA')
            
            # 验证
            fa = np.array(final)
            corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
            trans_pct = (fa[:, :, 3] < 32).sum() / (CANVAS_W * CANVAS_H) * 100
            body_pct = (fa[:, :, 3] > 32).sum() / (CANVAS_W * CANVAS_H) * 100
            
            print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
            print(f"  连通分量: {num}")
            print(f"  四角 alpha: {corners_alpha}")
            
            # 保存
            temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
            final.save(str(temp_path), 'PNG')
            filepath.unlink()
            
            import shutil
            shutil.move(str(temp_path), str(filepath))
            
            # 验证保存成功
            verify = Image.open(str(filepath))
            result = verify.size == (CANVAS_W, CANVAS_H) and verify.mode == 'RGBA'
            verify.close()
            
            if result and all(c == 0 for c in corners_alpha) and num >= 1:
                print(f"  ✓ 保存成功")
            else:
                print(f"  ✗ 保存验证失败")
                
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()


def main():
    print("增强现有武器资产...")
    enhance_existing_weapons()
    print("\n完成！")


if __name__ == '__main__':
    main()
