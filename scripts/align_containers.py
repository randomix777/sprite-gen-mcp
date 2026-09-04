#!/usr/bin/env python3
"""后处理：强制统一容器资产的外形、尺寸、位置"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

PROJECT_DIR = Path(r"D:/Projects/CodeChronoBullet")
CANVAS_W, CANVAS_H = 512, 768
MARGIN_X = int(CANVAS_W * 0.05)  # 5% 水平边距
MARGIN_Y = int(CANVAS_H * 0.03)  # 3% 垂直边距


def process_for_consistency(closed_path, variant_paths):
    """用 closed 状态的外轮廓锁定其他状态"""
    closed_img = Image.open(closed_path).convert('RGBA')
    closed_arr = np.array(closed_img)
    
    # 提取 closed 状态的 bbox
    alpha_closed = closed_arr[:,:,3]
    mask = alpha_closed > 32
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    
    if not (rows.any() and cols.any()):
        print(f"  ERROR: closed asset has no content")
        return False
    
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    
    # 计算中心位置和高度
    closed_center_x = (xmin + xmax) // 2
    closed_bottom = ymax  # 底部对齐
    closed_height = ymax - ymin + 1
    
    print(f"  Closed bbox: ({xmin},{ymin})-({xmax},{ymax}), center_x={closed_center_x}, height={closed_height}")
    
    # 处理每个 variant
    for variant_path in variant_paths:
        if not variant_path.exists():
            print(f"  SKIP: {variant_path.name} not found")
            continue
        
        print(f"\n  Processing: {variant_path.name}")
        img = Image.open(variant_path).convert('RGBA')
        arr = np.array(img)
        
        # 提取当前主体
        alpha = arr[:,:,3]
        rgb = arr[:,:,:3]
        
        # 二值化 alpha
        alpha = np.where(alpha >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理
        alpha_bin = alpha > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
        labels, num = ndimage.label(alpha_bin)
        if num > 0:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                max_label = areas[1:].argmax() + 1
                alpha_bin = (labels == max_label)
        alpha = (alpha_bin * 255).astype(np.uint8)
        
        # 找到当前 bbox
        mask = alpha > 0
        rows = np.any(mask, axis=1)
        cols = np.any(mask, axis=0)
        
        if not (rows.any() and cols.any()):
            print(f"    ERROR: no content in variant")
            continue
        
        vymin, vymax = np.where(rows)[0][[0, -1]]
        vxmin, vxmax = np.where(cols)[0][[0, -1]]
        var_height = vymax - vymin + 1
        
        # 计算需要的缩放比例（保持宽高比）
        scale = closed_height / var_height if var_height > 0 else 1.0
        scale = min(scale, 1.5)  # 最大放大 1.5 倍
        
        # 重新缩放
        if scale != 1.0:
            new_w = max(1, int((vxmax - vxmin + 1) * scale))
            new_h = max(1, int(var_height * scale))
            
            # 裁剪主体区域
            crop = arr[vymin:vymax+1, vxmin:vxmax+1]
            crop_img = Image.fromarray(crop, 'RGBA').resize((new_w, new_h), Image.LANCZOS)
            crop_arr = np.array(crop_img)
            
            # 重新二值化
            crop_arr[:,:,3] = np.where(crop_arr[:,:,3] >= 128, 255, 0).astype(np.uint8)
        else:
            crop_arr = arr[vymin:vymax+1, vxmin:vxmax+1]
        
        # 居中到画布（水平对齐 closed 的中心，垂直底部对齐）
        cw = crop_arr.shape[1]
        ch = crop_arr.shape[0]
        ox = closed_center_x - cw // 2
        oy = closed_bottom - ch + 20  # 留一点底部余量
        
        # 确保不超出边界
        ox = max(MARGIN_X, min(CANVAS_W - cw - MARGIN_X, ox))
        oy = max(MARGIN_Y, min(CANVAS_H - ch - MARGIN_Y, oy))
        
        # 创建画布
        canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
        canvas[oy:oy+ch, ox:ox+cw] = crop_arr
        
        # 保存
        final = Image.fromarray(canvas, 'RGBA')
        final.save(variant_path, 'PNG')
        
        # 验证
        fa = np.array(final)
        corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
        trans_pct = (fa[:,:,3] < 32).sum() / (CANVAS_W * CANVAS_H) * 100
        print(f"    ✓ {CANVAS_W}x{CANVAS_H}, pos=({ox},{oy}), corners={corners_alpha}, transparent={trans_pct:.1f}%")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('asset', choices=['refrigerator', 'wooden_crate'])
    args = parser.parse_args()
    
    asset = args.asset
    
    # 定义文件路径
    closed_path = PROJECT_DIR / f"assets/containers/{asset}_closed.png"
    variant_paths = [
        PROJECT_DIR / f"assets/containers/{asset}_open.png",
        PROJECT_DIR / f"assets/containers/{asset}_empty.png",
    ]
    
    if not closed_path.exists():
        print(f"ERROR: {closed_path.name} not found")
        return
    
    print(f"\n{'='*60}")
    print(f"后处理: {asset}")
    print(f"{'='*60}")
    print(f"\nClosed asset: {closed_path.name}")
    
    process_for_consistency(closed_path, variant_paths)
    
    print(f"\n{'='*60}")
    print("完成")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
