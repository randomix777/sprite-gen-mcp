#!/usr/bin/env python3
"""
对容器资产进行 QC 达标后处理：
1. 强制二值化 alpha（去除抗锯齿中间值）
2. 形态学清理（去除孤立噪点）
3. 保持最大连通分量
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

def qc_fix_image(input_path, output_path=None):
    """对图像进行 QC 达标处理"""
    if output_path is None:
        output_path = input_path
    
    input_path = Path(input_path)
    output_path = Path(output_path)
    
    print(f"\n处理: {input_path.name}")
    
    # 读取图像
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    # 分离 RGBA
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    
    # 1. 强二值化：将 alpha < 128 的设为 0，>= 128 的设为 255
    alpha_bin = (alpha >= 128).astype(np.uint8) * 255
    
    # 2. 形态学清理：使用大核
    # Opening: 去除孤立噪点
    alpha_bin = ndimage.binary_opening(alpha_bin > 0, structure=np.ones((9,9)))
    # Closing: 填充小空洞
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((9,9)))
    
    # 3. 只保留最大连通分量（去除所有噪点）
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            # 如果最大分量太小，保留所有大于阈值的分量
            min_area = 100  # 最小像素数
            valid_labels = np.where(areas[1:] >= min_area)[0] + 1
            if len(valid_labels) > 0:
                alpha_bin = np.isin(labels, valid_labels)
            else:
                alpha_bin = (labels == max_label)
    
    # 4. 应用处理后的 alpha
    result = np.zeros((h, w, 4), dtype=np.uint8)
    result[:, :, :3] = rgb
    result[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 5. 保存
    final = Image.fromarray(result, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_pct = (fa[:, :, 3] < 32).sum() / (w * h) * 100
    body_ratio = (fa[:, :, 3] > 32).sum() / (w * h) * 100
    
    print(f"  输出: {w}x{h} RGBA")
    print(f"  四角 alpha: {corners_alpha}")
    print(f"  透明率: {trans_pct:.1f}%")
    print(f"  主体比例: {body_ratio:.1f}%")
    
    return all(c == 0 for c in corners_alpha)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path', help='文件或目录路径')
    args = parser.parse_args()
    
    path = Path(args.path)
    
    if path.is_file():
        if path.suffix == '.png':
            qc_fix_image(path)
        return
    
    if path.is_dir():
        files = list(path.glob('*.png'))
        print(f"找到 {len(files)} 个 PNG 文件")
        
        success = 0
        failed = 0
        
        for f in files:
            # 跳过已经是 RGBA 且四角透明的
            test = Image.open(f)
            if test.mode != 'RGBA':
                test.close()
                print(f"\n跳过 (非 RGBA): {f.name}")
                failed += 1
                continue
            test.close()
            
            if qc_fix_image(f):
                success += 1
            else:
                failed += 1
        
        print(f"\n{'='*50}")
        print(f"完成: {success} 成功, {failed} 失败")


if __name__ == '__main__':
    main()
