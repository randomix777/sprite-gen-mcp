#!/usr/bin/env python3
"""QC 检查 - 使用 Python 重新实现 checkerboard 检测"""
from PIL import Image
import numpy as np

def calc_checkerboard_score(img_path):
    """计算 checkerboard 分数"""
    img = Image.open(img_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    alpha = arr[:,:,3]
    rgb = arr[:,:,:3]
    
    total_checks = 0
    flagged_checks = 0
    scales = [1, 2, 4, 8, 16, 32, 64]
    
    for scale in scales:
        if w < scale * 4 or h < scale * 2: continue
        xStep = scale * 2 if scale >= 4 else 1
        rowStep = max(1, h // 16)
        for row in range(0, h, rowStep):
            for x in range(0, w - scale * 2, xStep):
                b1Opaque = b2Opaque = b1Total = b2Total = 0
                b1SumR = b1SumG = b1SumB = b2SumR = b2SumG = b2SumB = 0
                for dy in range(scale):
                    for dx in range(scale):
                        py1, px1 = row + dy, x + dx
                        py2, px2 = row + dy, x + scale + dx
                        if py1 >= h or px1 >= w or py2 >= h or px2 >= w: continue
                        
                        a1 = alpha[py1, px1]
                        a2 = alpha[py2, px2]
                        b1Total += 1
                        b2Total += 1
                        
                        if a1 > 32:
                            b1Opaque += 1
                            r, g, b = rgb[py1, px1]
                            b1SumR += int(r)
                            b1SumG += int(g)
                            b1SumB += int(b)
                        if a2 > 32:
                            b2Opaque += 1
                            r, g, b = rgb[py2, px2]
                            b2SumR += int(r)
                            b2SumG += int(g)
                            b2SumB += int(b)
                
                if b1Total < scale * scale * 0.3 or b2Total < scale * scale * 0.3: continue
                if b1Opaque > 0 and b2Opaque > 0:
                    total_checks += 1
                    avg1r = b1SumR / b1Opaque
                    avg1g = b1SumG / b1Opaque
                    avg1b = b1SumB / b1Opaque
                    avg2r = b2SumR / b2Opaque
                    avg2g = b2SumG / b2Opaque
                    avg2b = b2SumB / b2Opaque
                    
                    dr = abs(avg1r - avg2r)
                    dg = abs(avg1g - avg2g)
                    db = abs(avg1b - avg2b)
                    
                    if dr > 80 and dg > 80 and db > 80:
                        flagged_checks += 1
    
    score = flagged_checks / total_checks if total_checks > 0 else 0
    return score, flagged_checks, total_checks


def main():
    files = [
        'D:/Projects/CodeChronoBullet/assets/containers/refrigerator_closed.png',
        'D:/Projects/CodeChronoBullet/assets/containers/refrigerator_open.png',
        'D:/Projects/CodeChronoBullet/assets/containers/refrigerator_empty.png',
        'D:/Projects/CodeChronoBullet/assets/containers/wooden_crate_closed.png',
        'D:/Projects/CodeChronoBullet/assets/containers/wooden_crate_open.png',
        'D:/Projects/CodeChronoBullet/assets/containers/wooden_crate_empty.png',
    ]
    
    threshold = 0.01
    
    print("Checkerboard 检测结果:")
    print("="*60)
    
    for f in files:
        name = f.split('/')[-1]
        try:
            score, flagged, total = calc_checkerboard_score(f)
            status = "PASS" if score <= threshold else "FAIL"
            print(f"{name}: cb_score={score:.4f} ({flagged}/{total}) [{status}]")
        except Exception as e:
            print(f"{name}: ERROR {e}")
    
    # 对比 v2 成功资产
    print("\n对比参考（v2 已成功资产）:")
    ref_files = [
        'D:/Projects/CodeChronoBullet/assets/cover/burnt_car_wreck_intact.png',
        'D:/Projects/CodeChronoBullet/assets/sprites/player/player_base_female.png',
    ]
    for f in ref_files:
        try:
            score, flagged, total = calc_checkerboard_score(f)
            print(f"{f.split('/')[-1]}: cb_score={score:.4f} ({flagged}/{total})")
        except Exception as e:
            print(f"{f.split('/')[-1]}: ERROR {e}")


if __name__ == '__main__':
    main()
