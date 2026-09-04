#!/usr/bin/env python3
"""
快速诊断：直接分析文件并打印详细 QC 结果
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import sys

def analyze_enemy(filepath):
    """分析单个敌人角色"""
    input_path = Path(filepath)
    
    print(f"\n{'='*50}")
    print(f"文件: {input_path.name}")
    
    # 读取图像
    img = Image.open(str(input_path)).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    print(f"尺寸: {w}x{h}, mode={img.mode}")
    
    # Alpha 通道
    alpha = arr[:, :, 3]
    print(f"Alpha 范围: {alpha.min()} - {alpha.max()}")
    print(f"Alpha 唯一值数量: {len(np.unique(alpha))}")
    
    # 透明率
    trans_pct = (alpha < 32).sum() / (w * h) * 100
    body_pct = (alpha > 128).sum() / (w * h) * 100
    print(f"透明率 (<32): {trans_pct:.2f}%")
    print(f"主体率 (>128): {body_pct:.2f}%")
    
    # 连通分量
    mask = alpha > 128
    labels, num = ndimage.label(mask)
    areas = ndimage.sum(mask, labels, range(1))
    
    print(f"连通分量: {num}")
    for i, area in enumerate(areas[:5]):
        print(f"  Component {i+1}: {area:.0f} pixels ({area/(w*h)*100:.2f}%)")
    
    # Checkerboard score（多尺度）
    print("\nCheckerboard 分析:")
    for scale in [2, 4, 8, 16]:
        if w < scale * 2 or h < scale * 2:
            continue
        
        pattern = np.indices((h, w))
        checker = ((pattern[0] // scale) + (pattern[1] // scale)) % 2
        
        alpha_normalized = mask.astype(float)
        alpha_normalized = (alpha_normalized - alpha_normalized.mean()) / (alpha_normalized.std() + 1e-10)
        checker_normalized = (checker.astype(float) - 0.5) * 2
        corr = np.abs(np.sum(alpha_normalized * checker_normalized) / (h * w))
        
        print(f"  Scale {scale}: score={corr:.4f}")
    
    # Edge margin
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if rows.any() and cols.any():
        ymin, ymax = np.where(rows)[0][[0, -1]]
        xmin, xmax = np.where(cols)[0][[0, -1]]
        top_margin = ymin / h
        bottom_margin = (h - ymax - 1) / h
        left_margin = xmin / w
        right_margin = (w - xmax - 1) / w
        min_margin = min(top_margin, bottom_margin, left_margin, right_margin)
        print(f"\nEdge margins:")
        print(f"  top={top_margin:.4f}, bottom={bottom_margin:.4f}, left={left_margin:.4f}, right={right_margin:.4f}")
        print(f"  min={min_margin:.4f}")
    
    img.close()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('file', help='敌人角色文件路径')
    args = parser.parse_args()
    
    analyze_enemy(args.file)


if __name__ == '__main__':
    main()
