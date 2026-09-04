#!/usr/bin/env python3
"""Analyze checkerboard score - final fix"""
from PIL import Image
import numpy as np

def calc_checkerboard_score(img_path):
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
                        py1 = row + dy
                        px1 = x + dx
                        py2 = row + dy
                        px2 = x + scale + dx
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
    return score

# Check regenerated assets
files = {
    'player_base_female': 'D:/Projects/CodeChronoBullet/assets/sprites/player/player_base_female.png',
    'assault_rifle': 'D:/Projects/CodeChronoBullet/assets/weapons/assault_rifle.png',
    'pistol_9mm': 'D:/Projects/CodeChronoBullet/assets/weapons/pistol_9mm.png',
    'shotgun_pump': 'D:/Projects/CodeChronoBullet/assets/weapons/shotgun_pump.png',
}

for name, path in files.items():
    try:
        score = calc_checkerboard_score(path)
        print(f'{name}: cb_score={score:.4f} {"PASS" if score <= 0.01 else "FAIL"}')
    except Exception as e:
        print(f'{name}: ERROR {e}')

print()
good = calc_checkerboard_score('D:/Projects/CodeChronoBullet/assets/cover/burnt_car_wreck_intact.png')
print(f'burnt_car_wreck_intact_v2: cb_score={good:.4f} (reference good asset)')
