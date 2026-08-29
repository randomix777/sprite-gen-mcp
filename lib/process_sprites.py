import json
import sys
import base64
from PIL import Image
import numpy as np
import os

def auto_crop(img, threshold=1):
    """Crop transparent edges from an image."""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    bbox = img.getbbox()
    if bbox is None:
        return img.crop((0, 0, img.width, img.height))
    return img.crop(bbox)

def cutout_and_validate(img, dist_threshold=60, corner_region=30, target_w=512, target_h=768):
    """
    Cutout post-processing with validation:
    1. Sample corners for background color
    2. Euclidean distance threshold → transparency mask
    3. Bbox crop
    4. Scale to target size and center
    5. Validate: corners transparent, transparency >= 35%, border clear
    """
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb_u8 = arr[:, :, :3].astype(np.uint8)

    # 1. Corner sampling
    corner = min(corner_region, w, h)
    samples = np.concatenate([
        arr[0:corner, 0:corner, :3].reshape(-1, 3),
        arr[0:corner, w-corner:w, :3].reshape(-1, 3),
        arr[h-corner:h, 0:corner, :3].reshape(-1, 3),
        arr[h-corner:h, w-corner:w, :3].reshape(-1, 3),
    ], axis=0)
    bg_rgb = samples.mean(axis=0)

    # 2. Distance calculation
    rgb_f = arr[:, :, :3].astype(np.float32)
    bg_f = bg_rgb.astype(np.float32)
    dist = np.sqrt(((rgb_f - bg_f) ** 2).sum(axis=2))
    alpha_u8 = np.where(dist <= dist_threshold, 0, 255).astype(np.uint8)
    trans_ratio = (alpha_u8 == 0).sum() / alpha_u8.size * 100

    # 3. Bbox crop
    mask = alpha_u8 > 0
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not (rows.any() and cols.any()):
        return None, {"error": "no content after cutout"}

    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    crop = np.zeros((ymax-ymin+1, xmax-xmin+1, 4), dtype=np.uint8)
    crop[:, :, :3] = rgb_u8[ymin:ymax+1, xmin:xmax+1, :]
    crop[:, :, 3] = alpha_u8[ymin:ymax+1, xmin:xmax+1]
    ch, cw = crop.shape[:2]

    # 4. Scale to target and center
    margin_x = int(target_w * 0.05)
    effective_w = target_w - 2 * margin_x
    scale = min(effective_w / cw, target_h / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    crop_img = Image.fromarray(crop, "RGBA").resize((nw, nh), Image.LANCZOS)
    canvas = np.zeros((target_h, target_w, 4), dtype=np.uint8)
    ox = (target_w - nw) // 2
    oy = (target_h - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = np.array(crop_img)
    result = Image.fromarray(canvas, "RGBA")

    # 5. Validate
    fa = np.array(result)
    tf = 0.05 * 255

    def corner_mean(y, x, r=5):
        ys = max(0, y-r); ye = min(target_h, y+r+1)
        xs = max(0, x-r); xe = min(target_w, x+r+1)
        return fa[ys:ye, xs:xe, 3].mean()

    corners = [
        corner_mean(0, 0),
        corner_mean(0, target_w-1),
        corner_mean(target_h-1, 0),
        corner_mean(target_h-1, target_w-1),
    ]
    corners_ok = all(c < tf for c in corners)
    trans_px = (fa[:, :, 3] < tf).sum()
    tr = trans_px / (target_w * target_h)
    tr_ok = tr >= 0.35

    bp = ob = 0
    for x in range(target_w):
        bp += 2
        ob += int(fa[0, x, 3] >= tf) + int(fa[target_h-1, x, 3] >= tf)
    for y in range(1, target_h-1):
        bp += 2
        ob += int(fa[y, 0, 3] >= tf) + int(fa[y, target_w-1, 3] >= tf)
    br = ob / bp if bp else 0
    br_ok = br <= 0.02

    validation = {
        "size_ok": result.size == (target_w, target_h),
        "mode_ok": result.mode == "RGBA",
        "corners_ok": corners_ok,
        "transparent_ratio_ok": tr_ok,
        "border_ok": br_ok,
        "corner_alphas": [int(c) for c in corners],
        "transparent_ratio": round(tr * 100, 1),
        "border_ratio": round(br * 100, 1),
    }
    all_ok = all([validation['size_ok'], validation['mode_ok'],
                  validation['corners_ok'], validation['transparent_ratio_ok'],
                  validation['border_ok']])

    return result, {
        **validation,
        "all_ok": all_ok,
        "bbox": [int(xmin), int(ymin), int(cw), int(ch)]
    }

def generate_sprite_sheet(args):
    # Normalize paths (handle Windows backslashes)
    for key in ['image_path', 'output_path']:
        if key in args:
            args[key] = args[key].replace('\\', '/')

    input_path = args.get('image_path', '')
    grid_cols = args.get('grid_cols', 4)
    grid_rows = args.get('grid_rows', 4)
    crop_mode = args.get('crop_mode', 'auto')
    spacing = args.get('spacing', 0)
    cell_width = args.get('cell_width', 32)
    cell_height = args.get('cell_height', 32)
    transparent_threshold = args.get('transparent_threshold', 1)
    output_path = args.get('output_path', './output/sprite_sheet.png')
    padding = args.get('padding', 0)

    # Open input image
    img = Image.open(input_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    src_w, src_h = img.size

    if crop_mode == 'auto':
        cell_w = src_w // grid_cols
        cell_h = src_h // grid_rows

        cropped_cells = []
        for row in range(grid_rows):
            for col in range(grid_cols):
                x = col * cell_w
                y = row * cell_h
                cell = img.crop((x, y, x + cell_w, y + cell_h))
                cell = auto_crop(cell, transparent_threshold)
                if padding > 0:
                    new_cell = Image.new('RGBA', (cell.width + padding*2, cell.height + padding*2), (0, 0, 0, 0))
                    new_cell.paste(cell, (padding, padding))
                    cell = new_cell
                cropped_cells.append(cell)

        max_w = max(c.width for c in cropped_cells) if cropped_cells else cell_w
        max_h = max(c.height for c in cropped_cells) if cropped_cells else cell_h

        padded_cells = []
        for c in cropped_cells:
            if c.width < max_w or c.height < max_h:
                padded = Image.new('RGBA', (max_w, max_h), (0, 0, 0, 0))
                padded.paste(c, (0, 0))
                padded_cells.append(padded)
            else:
                padded_cells.append(c)

        output_w = max_w * grid_cols + spacing * (grid_cols - 1)
        output_h = max_h * grid_rows + spacing * (grid_rows - 1)
        result = Image.new('RGBA', (output_w, output_h), (0, 0, 0, 0))

        for idx, cell in enumerate(padded_cells):
            row = idx // grid_cols
            col = idx % grid_cols
            x = col * (max_w + spacing)
            y = row * (max_h + spacing)
            result.paste(cell, (x, y))

    elif crop_mode == 'fixed':
        total_w = cell_width * grid_cols + spacing * (grid_cols - 1)
        total_h = cell_height * grid_rows + spacing * (grid_rows - 1)
        result = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

        scale_w = cell_width / src_w
        scale_h = cell_height / src_h
        scale = min(scale_w, scale_h)
        new_w = int(src_w * scale)
        new_h = int(src_h * scale)
        scaled = img.resize((new_w, new_h), Image.LANCZOS)

        cx = (cell_width - new_w) // 2
        cy = (cell_height - new_h) // 2

        for row in range(grid_rows):
            for col in range(grid_cols):
                x = col * (cell_width + spacing) + cx
                y = row * (cell_height + spacing) + cy
                result.paste(scaled, (x, y))

    else:  # none
        cell_w = src_w // grid_cols
        cell_h = src_h // grid_rows

        output_w = cell_w * grid_cols + spacing * (grid_cols - 1)
        output_h = cell_h * grid_rows + spacing * (grid_rows - 1)
        result = Image.new('RGBA', (output_w, output_h), (0, 0, 0, 0))

        for row in range(grid_rows):
            for col in range(grid_cols):
                x = col * cell_w + col * spacing
                y = row * cell_h + row * spacing
                cell = img.crop((col * cell_w, row * cell_h,
                                 min((col + 1) * cell_w, src_w),
                                 min((row + 1) * cell_h, src_h)))
                result.paste(cell, (x, y))

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    result.save(output_path, 'PNG')

    return {
        'success': True,
        'output_path': output_path,
        'output_size': list(result.size),
        'grid_cols': grid_cols,
        'grid_rows': grid_rows,
        'crop_mode': crop_mode
    }

def run_cutout(args):
    """Full cutout + validation pipeline."""
    input_path = args.get('image_path', '')
    output_path = args.get('output_path', './output/cutout.png')
    dist_threshold = args.get('dist_threshold', 60)
    corner_region = args.get('corner_region', 30)
    target_w = args.get('target_width', 512)
    target_h = args.get('target_height', 768)

    img = Image.open(input_path)
    result, validation = cutout_and_validate(
        img, dist_threshold, corner_region, target_w, target_h
    )

    if result is None:
        return {'success': False, 'error': validation.get('error', 'cutout failed'), 'validation': validation}

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    result.save(output_path, 'PNG')

    return {
        'success': True,
        'output_path': output_path,
        'output_size': result.size,
        'validation': validation
    }

if __name__ == '__main__':
    encoded = sys.argv[1]
    args = json.loads(base64.b64decode(encoded).decode())
    cmd = args.pop('command', 'sprite_sheet')
    if cmd == 'cutout':
        result = run_cutout(args)
    else:
        result = generate_sprite_sheet(args)
    print(json.dumps(result))


# ─── Autotile generation ─────────────────────────────────────────────────────

def generate_autotile(image_path, tile_size, output_dir):
    """Generate 16 autotile variants from a single tile image.

    Each variant darkens the edges that are exposed (not touching another tile)
    and adds an outline on those edges. Corner edges get rounded corners.

    The 16 variants correspond to the 4 cardinal directions having neighbors:
      00 = no neighbors (isolated)
      01 = top
      02 = top+right
      03 = right
      ...
      15 = all four (interior)
    """
    img = Image.open(image_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    w, h = tile_size, tile_size
    img = img.resize((w, h), Image.LANCZOS)
    arr = np.array(img)

    # Precompute edge color for darkening
    # Sample the border pixels to get the tile's edge color
    top_edge = arr[0:4, :, :3].mean(axis=(0, 1))
    bottom_edge = arr[-4:, :, :3].mean(axis=(0, 1))
    left_edge = arr[:, 0:4, :3].mean(axis=(0, 1))
    right_edge = arr[:, -4:, :3].mean(axis=(0, 1))
    avg_edge = (top_edge + bottom_edge + left_edge + right_edge) / 4

    variants = []
    for mask in range(16):  # 0b0000 to 0b1111
        has_top    = bool(mask & 8)
        has_right  = bool(mask & 4)
        has_bottom = bool(mask & 2)
        has_left   = bool(mask & 1)

        result = arr.copy()
        exposed = [
            (not has_top,    0),
            (not has_bottom, h - 1),
            (not has_left,   0),
            (not has_right,  w - 1),
        ]

        # Darken exposed edges
        darken_amount = 40  # RGB value to subtract
        for is_exposed, coord in exposed:
            if not is_exposed:
                continue
            if coord == 0:  # top or left
                region = result[:6, :] if coord == 0 else result[:, :6]
            else:  # bottom or right
                region = result[-6:, :] if coord == h - 1 else result[:, -6:]

            # Darken the edge region
            dark_factor = np.clip(avg_edge - darken_amount, 0, 255).astype(np.uint8)
            light_factor = np.clip(avg_edge + 20, 0, 255).astype(np.uint8)

            for y in range(region.shape[0]):
                for x in range(region.shape[1]):
                    alpha = result[
                        (0 if coord == 0 else h - 6 + y),
                        (0 if coord == 0 else w - 6 + x),
                        3
                    ]
                    if alpha > 128:
                        rgb = result[
                            (0 if coord == 0 else h - 6 + y),
                            (0 if coord == 0 else w - 6 + x),
                            :3
                        ].astype(np.float32)
                        # Mix between dark and light based on distance from edge
                        dist = min(y + 1, x + 1, 6) / 6.0
                        blended = dark_factor * (1 - dist) + light_factor * dist
                        result[
                            (0 if coord == 0 else h - 6 + y),
                            (0 if coord == 0 else w - 6 + x),
                            :3
                        ] = blended.astype(np.uint8)

        # Add outline on exposed edges
        outline_color = np.array([0, 0, 0, 200], dtype=np.uint8)
        for is_exposed, coord in exposed:
            if not is_exposed:
                continue
            if coord == 0:
                result[0, :, :3] = np.maximum(result[0, :3], outline_color[:3])
            elif coord == h - 1:
                result[-1, :, :3] = np.maximum(result[-1, :3], outline_color[:3])
            elif coord == 0:
                result[:, 0, :3] = np.maximum(result[:, 0, :3], outline_color[:3])
            elif coord == w - 1:
                result[:, -1, :3] = np.makedirs(result[:, -1, :3], outline_color[:3])

        # Corner rounding: where two exposed edges meet, add a slight curve
        corners = [
            (not has_top and not has_left, 0, 0),
            (not has_top and not has_right, 0, w - 1),
            (not has_bottom and not has_left, h - 1, 0),
            (not has_bottom and not has_right, h - 1, w - 1),
        ]
        for is_corner, cy, cx in corners:
            if not is_corner:
                continue
            # Simple corner darkening
            for dy in range(4):
                for dx in range(4):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w:
                        dist_from_corner = dy + dx
                        if dist_from_corner < 4:
                            factor = 1.0 - (dist_from_corner / 4.0)
                            result[ny, nx, :3] = (
                                result[ny, nx, :3].astype(np.float32) * (1 - factor * 0.3)
                            ).astype(np.uint8)

        out_img = Image.fromarray(result, 'RGBA')
        variants.append(out_img)

    os.makedirs(output_dir, exist_ok=True)
    paths = []
    for i, var in enumerate(variants):
        out_path = os.path.join(output_dir, f'autotile_{i:02d}.png')
        var.save(out_path, 'PNG')
        paths.append(out_path)

    return {
        'success': True,
        'output_dir': output_dir,
        'variant_paths': paths,
        'tile_size': (w, h),
    }


if __name__ == '__main__':
    encoded = sys.argv[1]
    args = json.loads(base64.b64decode(encoded).decode())
    cmd = args.pop('command', 'sprite_sheet')
    if cmd == 'cutout':
        result = run_cutout(args)
    elif cmd == 'autotile':
        result = generate_autotile(
            args.get('image_path'),
            tuple(args.get('tile_size', [64, 64])),
            args.get('output_dir', './output/autotile'),
        )
    else:
        result = generate_sprite_sheet(args)
    print(json.dumps(result))
