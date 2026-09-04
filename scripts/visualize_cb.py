#!/usr/bin/env python3
"""Visualize checkerboard pattern in regenerated images"""
from PIL import Image
import numpy as np

def find_checkerboard_regions(img_path):
    img = Image.open(img_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    alpha = arr[:,:,3]
    rgb = arr[:,:,:3]
    
    # Find all 2x2 regions that look like checkerboard
    flagged = []
    for y in range(h - 1):
        for x in range(w - 1):
            a00 = alpha[y, x]
            a10 = alpha[y, x+1]
            a01 = alpha[y+1, x]
            a11 = alpha[y+1, x+1]
            
            # Checkerboard: alternating opaque/transparent
            if ((a00 > 128 and a10 < 128 and a01 < 128 and a11 > 128) or
                (a00 < 128 and a10 > 128 and a01 > 128 and a11 < 128)):
                flagged.append((x, y))
    
    print(f'{img_path.split("/")[-1]}: {len(flagged)} flagged 2x2 regions')
    
    # Show some examples
    if flagged:
        print(f'  First 10: {flagged[:10]}')
        
        # Show pattern around first flagged region
        x, y = flagged[0]
        print(f'\n  Pattern around ({x},{y}):')
        for dy in range(-1, 3):
            row = []
            for dx in range(-1, 3):
                py, px = y + dy, x + dx
                if 0 <= py < h and 0 <= px < w:
                    a = alpha[py, px]
                    row.append(f'{a:3d}' if a > 0 else ' ---')
                else:
                    row.append(' ---')
            print(f'    {" ".join(row)}')

# Check all regenerated assets
files = [
    'D:/Projects/CodeChronoBullet/assets/sprites/player/player_base_female.png',
    'D:/Projects/CodeChronoBullet/assets/weapons/assault_rifle.png',
    'D:/Projects/CodeChronoBullet/assets/weapons/pistol_9mm.png',
    'D:/Projects/CodeChronoBullet/assets/weapons/shotgun_pump.png',
]

for f in files:
    find_checkerboard_regions(f)
    print()
