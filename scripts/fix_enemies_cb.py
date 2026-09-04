#!/usr/bin/env python3
"""
敌人角色后处理 - 修复 CHECKERBOARD 误报
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import os

TARGET_W, TARGET_H = 512, 768
DIST_THRESHOLD = 50.0
BBOX_PADDING = 40


def process_enemy(filepath, output_path=None):
    """处理敌人角色，修复 CHECKERBOARD 误报"""
    input_path = Path(filepath).resolve()
    if output_path is None:
        output_path = input_path
    
    print(f"\n处理: {input_path.name}")
    
    try:
        # 读取图像
        img = Image.open(str(input_path)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
        print(f"  输入: {w}x{h}, mode={img.mode}")
        
        # 计算背景色
        corner_size = min(30, w // 10, h // 10)
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
        
        print(f"  裁剪后: {cw}x{ch}")
        
        # 缩放适配 512x768
        margin_x = int(TARGET_W * 0.10)
        margin_y = int(TARGET_H * 0.08)
        effective_w = TARGET_W - 2 * margin_x
        effective_h = TARGET_H - 2 * margin_y
        scale = min(effective_w / cw, effective_h / ch)
        nw = max(1, int(cw * scale))
        nh = max(1, int(ch * scale))
        
        crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
        crop_arr = np.array(crop_img)
        
        # 关键修复：alpha 二值化 + 形态学清理
        # 这是解决 CHECKERBOARD 误报的关键
        crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理 - 连接分散部分，消除小噪点
        alpha_bin = crop_arr[:, :, 3] > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((5,5)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((5,5)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 只保留最大的连通分量（主体）
        if num > 0:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                max_label = areas[1:].argmax() + 1
                min_area = 100  # 最小主体面积
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    alpha_bin = np.isin(labels, valid_labels)
                else:
                    alpha_bin = (labels == max_label)
        
        crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
        
        # 重新计算连通分量
        final_mask = crop_arr[:, :, 3] > 0
        labels, num = ndimage.label(final_mask)
        
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
        
        # 计算 checkerboard score
        alpha_bin_final = fa[:, :, 3] > 128
        cb_score = compute_checkerboard_score(alpha_bin_final)
        
        print(f"  ✓ {TARGET_W}x{TARGET_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
        print(f"  连通分量: {num}")
        print(f"  Checkerboard score: {cb_score:.4f}")
        print(f"  四角 alpha: {corners_alpha}")
        
        # 保存
        output_str = str(output_path)
        final.save(output_str, 'PNG')
        
        # 验证保存成功
        verify = Image.open(output_str)
        result = verify.size == (TARGET_W, TARGET_H) and verify.mode == 'RGBA'
        verify.close()
        
        if result and all(c == 0 for c in corners_alpha) and num >= 1 and cb_score < 0.01:
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


def compute_checkerboard_score(alpha_bin):
    """计算多尺度棋盘格分数"""
    h, w = alpha_bin.shape
    scores = []
    
    # 检查不同尺度的棋盘模式
    for scale in [2, 4, 8, 16]:
        if w < scale * 2 or h < scale * 2:
            continue
        
        # 创建棋盘模式并比较
        pattern = np.indices((h, w))
        checker = ((pattern[0] // scale) + (pattern[1] // scale)) % 2
        
        # 计算相关系数
        alpha_normalized = alpha_bin.astype(float)
        alpha_normalized = (alpha_normalized - alpha_normalized.mean()) / (alpha_normalized.std() + 1e-10)
        checker_normalized = (checker.astype(float) - 0.5) * 2
        corr = np.abs(np.sum(alpha_normalized * checker_normalized) / (h * w))
        scores.append(corr)
    
    return max(scores) if scores else 0


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dir', default='assets/sprites/enemies', help='目录')
    args = parser.parse_args()
    
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    enemy_dir = project_dir / args.dir
    
    print(f"处理 {enemy_dir} 下的敌人角色...")
    print(f"目标格式: {TARGET_W}x{TARGET_H}\n")
    
    success = 0
    skipped = 0
    failed = 0
    
    for f in enemy_dir.glob('enemy_*.png'):
        if 'qc_evidence' in f.name or f.name.startswith('.tmp_'):
            continue
        
        img = Image.open(str(f))
        if img.size == (TARGET_W, TARGET_H) and img.mode == 'RGBA':
            img.close()
            print(f"\n跳过 (已是正确格式): {f.name}")
            skipped += 1
            continue
        img.close()
        
        if process_enemy(f):
            success += 1
        else:
            failed += 1
    
    print(f"\n{'='*50}")
    print(f"完成: {success} 成功, {failed} 失败, {skipped} 跳过")


if __name__ == '__main__':
    main()
