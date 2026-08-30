"""
Enhanced post-processing: more aggressive background removal with multiple strategies.
"""
import os
import numpy as np
from PIL import Image

BASE = r'D:\Projects\CodeChronoBullet\assets'

# Files that need reprocessing
files = [
    ('sprites/enemies/enemy_raider.png', 832, 1248),
    ('cover/wooden_door_closed.png', 832, 1248),
    ('cover/wooden_door_open.png', 832, 1248),
    ('cover/wooden_door_breached.png', 832, 1248),
    ('containers/wooden_crate_closed.png', 1024, 1024),
    ('containers/refrigerator_closed.png', 832, 1248),
    ('containers/refrigerator_open.png', 832, 1248),
    ('containers/refrigerator_empty.png', 832, 1248),
    ('furniture/metal_shelf_empty.png', 832, 1248),
    ('cover/sandbag_wall.png', 1024, 1024),
    ('cover/burnt_car.png', 1024, 1024),
    ('cover/broken_window.png', 1024, 1024),
    ('cover/concrete_wall_broken.png', 832, 1248),
    ('cover/ladder_section.png', 832, 1248),
    ('cover/metal_shelf.png', 832, 1248),
    ('cover/metal_shelving_full.png', 832, 1248),
    ('cover/wooden_crate.png', 832, 1248),
]

def process_aggressive(filepath, target_w, target_h):
    """Multi-strategy background removal."""
    img = Image.open(filepath)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    data = np.array(img)
    h, w, _ = data.shape
    corners = [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]

    # Strategy 1: Corner-based background detection
    corner_colors = [tuple(data[y, x][:3]) for x, y in corners]
    bg_color = max(set(corner_colors), key=corner_colors.count)

    # Strategy 2: Flood fill from corners (most common bg)
    r, g, b = bg_color
    # Calculate distance
    dr = np.abs(data[:,:,0].astype(int) - r)
    dg = np.abs(data[:,:,1].astype(int) - g)
    db = np.abs(data[:,:,2].astype(int) - b)
    dist = np.sqrt(dr**2 + dg**2 + db**2)

    # Use multiple thresholds
    threshold1 = 45  # More aggressive
    threshold2 = 60  # Even more for tricky cases
    is_bg = (dist <= threshold1) | (dist <= threshold2)

    # Also remove very bright pixels
    luminance = 0.299 * data[:,:,0] + 0.587 * data[:,:,1] + 0.114 * data[:,:,2]
    is_light = luminance > 220

    # Remove very dark pixels (shadows that might be bg)
    is_dark = luminance < 25

    # Combine
    transparent = is_bg | is_light | is_dark

    # Apply alpha
    data[:,:,3] = np.where(transparent, 0, 255)

    # Ensure corners are transparent
    for x, y in corners:
        data[y, x, 3] = 0

    # Resize to target dimensions if needed
    if (w, h) != (target_w, target_h):
        result = Image.fromarray(data, 'RGBA')
        result = result.resize((target_w, target_h), Image.LANCZOS)
    else:
        result = Image.fromarray(data, 'RGBA')

    result.save(filepath, 'PNG', optimize=True)

    total = target_w * target_h
    # Recount on result
    rd = np.array(result)
    trans_count = int((rd[:,:,3] == 0).sum())
    trans_pct = trans_count / total * 100

    # Check corners
    corners_opaque = 0
    for x, y in corners:
        if result.getpixel((x, y))[3] > 12:
            corners_opaque += 1

    status = "OK" if (trans_pct > 35 and corners_opaque == 0) else "FAIL"
    print(f"  {status}: {filepath} ({target_w}x{target_h}, {trans_pct:.1f}% trans, {corners_opaque}/4 corners)")
    return status == "OK"

def main():
    print("Aggressive post-processing...")
    passed = 0
    failed = 0
    for filepath, tw, th in files:
        full_path = os.path.join(BASE, filepath)
        if os.path.exists(full_path):
            if process_aggressive(full_path, tw, th):
                passed += 1
            else:
                failed += 1
        else:
            print(f"  MISSING: {filepath}")
            failed += 1

    print(f"\nDone: {passed} passed, {failed} failed out of {len(files)} files")

if __name__ == '__main__':
    main()
