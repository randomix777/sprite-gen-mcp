"""
Post-process AGNES-generated sprites: add transparency, remove white/colored backgrounds,
ensure 4-corner transparency for Godot sprite rendering.
"""
import os
from PIL import Image
import numpy as np

BASE = r'D:\Projects\CodeChronoBullet\assets'

# Files to process
files = [
    # Player sprites
    ('sprites/player/player_idle.png', 'rgba'),
    ('sprites/player/player_run.png', 'rgba'),
    ('sprites/player/player_jump.png', 'rgba'),
    ('sprites/player/player_shoot.png', 'rgba'),
    ('sprites/player/player_hurt.png', 'rgba'),
    ('sprites/player/player_death.png', 'rgba'),
    # Enemy sprites
    ('sprites/enemies/enemy_raider.png', 'rgba'),
    ('sprites/enemies/enemy_warlord.png', 'rgba'),
    # Weapons
    ('weapons/pistol_9mm.png', 'rgba'),
    ('weapons/assault_rifle.png', 'rgba'),
    ('weapons/bolt_action_rifle.png', 'rgba'),
    ('weapons/pump_shotgun.png', 'rgba'),
    ('weapons/desert_eagle.png', 'rgba'),
    ('weapons/m1911_pistol.png', 'rgba'),
    ('weapons/m1_garand.png', 'rgba'),
    ('weapons/mp5_smg.png', 'rgba'),
    ('weapons/sks_rifle.png', 'rgba'),
    # Equipment
    ('equipment/heads/steel_helmet.png', 'rgba'),
    ('equipment/chests/light_ballistic_vest.png', 'rgba'),
    ('equipment/backpacks/medium_assault_pack.png', 'rgba'),
    # Doors
    ('cover/metal_door_closed.png', 'rgba'),
    ('cover/metal_door_open.png', 'rgba'),
    ('cover/wooden_door_closed.png', 'rgba'),
    ('cover/wooden_door_open.png', 'rgba'),
    ('cover/wooden_door_breached.png', 'rgba'),
    ('cover/chain_lock_door.png', 'rgba'),
    # Containers
    ('containers/wooden_crate_closed.png', 'rgba'),
    ('containers/wooden_crate_empty.png', 'rgba'),
    ('containers/refrigerator_closed.png', 'rgba'),
    ('containers/refrigerator_open.png', 'rgba'),
    ('containers/refrigerator_empty.png', 'rgba'),
    # Furniture
    ('furniture/wooden_cabinet.png', 'rgba'),
    ('furniture/metal_shelf_empty.png', 'rgba'),
    ('furniture/bed_frame.png', 'rgba'),
    # Covers
    ('cover/barrier_concrete.png', 'rgba'),
    ('cover/sandbag_wall.png', 'rgba'),
    ('cover/burnt_car.png', 'rgba'),
    ('cover/broken_window.png', 'rgba'),
    ('cover/concrete_wall_broken.png', 'rgba'),
    ('cover/ladder_section.png', 'rgba'),
    ('cover/metal_shelf.png', 'rgba'),
    ('cover/metal_shelving_full.png', 'rgba'),
    ('cover/wooden_crate.png', 'rgba'),
]

def process_image(filepath, target_mode='rgba'):
    """Remove background and add transparency."""
    img = Image.open(filepath)
    orig_mode = img.mode
    orig_size = img.size

    # Convert to RGBA if needed
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Get pixel data
    data = np.array(img)
    h, w, c = data.shape

    # Detect background color from corner pixels
    corner_pixels = []
    corners = [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]
    for x, y in corners:
        corner_pixels.append(tuple(data[y, x][:3]))

    # Use most common corner color as background
    bg_color = max(set(corner_pixels), key=corner_pixels.count)

    # Create alpha mask: pixels close to background become transparent
    # Tolerance: allow some variation for anti-aliased edges
    tolerance = 30  # per-channel RGB tolerance

    r, g, b = bg_color
    # Calculate distance for each pixel
    dr = np.abs(data[:,:,0].astype(int) - r)
    dg = np.abs(data[:,:,1].astype(int) - g)
    db = np.abs(data[:,:,2].astype(int) - b)

    # Background threshold: all channels within tolerance
    is_bg = (dr <= tolerance) & (dg <= tolerance) & (db <= tolerance)

    # Also make very bright pixels transparent (white/light backgrounds)
    luminance = 0.299 * data[:,:,0] + 0.587 * data[:,:,1] + 0.114 * data[:,:,2]
    is_light = luminance > 230

    # Combine: background or very light = transparent
    transparent = is_bg | is_light

    # Apply alpha
    data[:,:,3] = np.where(transparent, 0, 255)

    # Ensure 4 corners are transparent
    for x, y in corners:
        data[y, x, 3] = 0

    # Reconstruct image
    result = Image.fromarray(data, 'RGBA')
    result.save(filepath, 'PNG', optimize=True)

    # Count statistics
    total = w * h
    trans_count = int(transparent.sum())
    trans_pct = trans_count / total * 100

    # Check corners
    corners_opaque = 0
    for x, y in corners:
        if result.getpixel((x, y))[3] > 12:
            corners_opaque += 1

    status = "OK" if (trans_pct > 35 and corners_opaque == 0) else "NEEDS_REPROCESS"
    print(f"  {status}: {filepath} ({w}x{h}, {trans_pct:.1f}% trans, {corners_opaque}/4 corners opaque)")
    return status == "OK"

def main():
    print("Post-processing AGNES-generated sprites...")
    passed = 0
    failed = 0
    for filepath, mode in files:
        full_path = os.path.join(BASE, filepath)
        if os.path.exists(full_path):
            if process_image(full_path, mode):
                passed += 1
            else:
                failed += 1
        else:
            print(f"  MISSING: {filepath}")
            failed += 1

    print(f"\nDone: {passed} passed, {failed} failed out of {len(files)} files")

if __name__ == '__main__':
    main()
