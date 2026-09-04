#!/usr/bin/env python3
"""
处理玩家动画帧资产
"""
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import shutil

TARGET_W, TARGET_H = 512, 768
DIST_THRESHOLD = 45.0
BBOX_PADDING = 40


def process_player_frame(filepath):
    """处理玩家动画帧"""
    filename = filepath.name
    print(f"\n处理: {filename}")
    
    try:
        img = Image.open(str(filepath)).convert('RGBA')
        arr = np.array(img)
        h, w = arr.shape[:2]
        
        print(f"  输入: {w}x{h}")
        
        # 计算背景色
        corner_size = min(50, w // 10, h // 10)
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
        
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, :3] = arr[:, :, :3]
        rgba[:, :, 3] = alpha
        
        # Alpha 二值化
        alpha = np.where(alpha >= 128, 255, 0).astype(np.uint8)
        
        # 形态学清理
        alpha_bin = alpha > 0
        alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((9,9)))
        alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((9,9)))
        
        # 连通分量分析
        labels, num = ndimage.label(alpha_bin)
        
        # 合并小分量
        if num > 1:
            areas = np.bincount(labels.ravel())
            if len(areas) > 1:
                min_area = 15
                valid_labels = np.where(areas[1:] >= min_area)[0] + 1
                if len(valid_labels) > 0:
                    main_mask = np.isin(labels, valid_labels)
                    for _ in range(3):
                        main_mask = ndimage.binary_dilation(main_mask, structure=np.ones((7,7)))
                    alpha_bin = main_mask
                    num = 1
        
        alpha = (alpha_bin * 255).astype(np.uint8)
        
        # 边缘平滑
        from scipy.ndimage import gaussian_filter
        alpha_smooth = gaussian_filter(alpha.astype(float) / 255.0, sigma=0.8)
        alpha = np.where(alpha_smooth >= 0.5, 255, 0).astype(np.uint8)
        
        # 重建 RGBA
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
        
        # 缩放适配到画布
        effective_w = TARGET_W - 2 * int(TARGET_W * 0.03)
        effective_h = TARGET_H - 2 * int(TARGET_H * 0.03)
        scale = min(effective_w / cw, effective_h / ch)
        nw = max(1, int(cw * scale))
        nh = max(1, int(ch * scale))
        
        crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
        crop_arr = np.array(crop_img)
        
        # 居中到画布底部
        canvas = np.zeros((TARGET_H, TARGET_W, 4), dtype=np.uint8)
        ox = (TARGET_W - nw) // 2
        oy = TARGET_H - nh - int(TARGET_H * 0.03)
        canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
        
        final = Image.fromarray(canvas, 'RGBA')
        
        # 验证
        fa = np.array(final)
        corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
        trans_pct = (fa[:, :, 3] < 32).sum() / (TARGET_W * TARGET_H) * 100
        body_pct = (fa[:, :, 3] > 32).sum() / (TARGET_W * TARGET_H) * 100
        
        print(f"  ✓ {TARGET_W}x{TARGET_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
        print(f"  连通分量: {num}")
        print(f"  四角 alpha: {corners_alpha}")
        
        # 保存
        temp_path = filepath.parent / f'.tmp_{filepath.stem}.png'
        final.save(str(temp_path), 'PNG')
        filepath.unlink()
        shutil.move(str(temp_path), str(filepath))
        
        verify = Image.open(str(filepath))
        result = verify.size == (TARGET_W, TARGET_H) and verify.mode == 'RGBA'
        verify.close()
        
        if result and all(c == 0 for c in corners_alpha):
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


def main():
    project_dir = Path(r"D:/Projects/CodeChronoBullet")
    player_dir = project_dir / 'assets/sprites/player'
    
    # 需要处理的文件
    files_to_fix = [
        'player_base_female.png',
        'player_idle.png',
        'player_run.png',
        'player_shoot.png',
        'player_hurt.png',
        'player_death.png',
    ]
    
    print(f"处理 {len(files_to_fix)} 个玩家动画帧...\n")
    
    success = 0
    for f in files_to_fix:
        filepath = player_dir / f
        if not filepath.exists():
            print(f"\n跳过（不存在）: {f}")
            continue
        if process_player_frame(filepath):
            success += 1
    
    print(f"\n完成: {success}/{len(files_to_fix)}")


if __name__ == '__main__':
    main()
