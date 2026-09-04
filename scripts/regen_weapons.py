#!/usr/bin/env python3
"""批量生成武器资产 - 完整武器库"""
import subprocess
import sys
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path
import urllib.request
import json

PROJECT_DIR = Path(r"D:/Projects/CodeChronoBullet")
API_KEY = os.environ.get("HERMES_CUSTOM_AGNES_API_KEY", "")
API_URL = "https://apihub.agnes-ai.com/v1/images/generations"
MODEL = "agnes-image-2.1-flash"

CANVAS_W, CANVAS_H = 512, 512  # 武器画布（正方形）
DIST_THRESHOLD = 60.0
BBOX_PADDING = 30


def call_agnes_api(prompt, output_path):
    """调用 Agnes API"""
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "size": "1K",
        "extra_body": {
            "response_format": "url",
            "ratio": "1:1"  # 武器用正方形
        }
    }
    
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
            items = data.get("data") or []
            if not items:
                print(f"ERROR: no data in response")
                return False
            url = items[0].get("url")
            if url:
                return download_image(url, output_path)
            else:
                print(f"ERROR: no url in response")
                return False
    except Exception as e:
        print(f"ERROR calling API: {e}")
        return False


def download_image(url, dest_path):
    """下载图片"""
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, dest_path)
        return True
    except Exception as e:
        print(f"ERROR downloading: {e}")
        return False


def process_to_rgba(input_path, output_path, canvas_w=CANVAS_W, canvas_h=CANVAS_H):
    """处理图像为 RGBA"""
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    
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
    
    # 合并
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
    
    # 缩放
    margin_x = int(canvas_w * 0.05)
    margin_y = int(canvas_h * 0.03)
    effective_w = canvas_w - 2 * margin_x
    effective_h = canvas_h - 2 * margin_y
    scale = min(effective_w / cw, effective_h / ch)
    nw = max(1, int(cw * scale))
    nh = max(1, int(ch * scale))
    
    crop_img = Image.fromarray(crop, 'RGBA').resize((nw, nh), Image.LANCZOS)
    crop_arr = np.array(crop_img)
    
    # 二值化 alpha
    crop_arr[:, :, 3] = np.where(crop_arr[:, :, 3] >= 128, 255, 0).astype(np.uint8)
    
    # 形态学清理
    alpha_bin = crop_arr[:, :, 3] > 0
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            alpha_bin = (labels == max_label)
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 居中
    canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
    ox = (canvas_w - nw) // 2
    oy = (canvas_h - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
    
    final = Image.fromarray(canvas, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_pct = (fa[:, :, 3] < 32).sum() / (canvas_w * canvas_h) * 100
    body_pct = (fa[:, :, 3] > 32).sum() / (canvas_w * canvas_h) * 100
    
    print(f"  ✓ {canvas_w}x{canvas_h} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
    return all(c == 0 for c in corners_alpha) and trans_pct > 15


# ========== 武器生成 ==========

WEAPON_STYLE = """《Code Chrono Bullet》横版末日战争生存游戏武器素材。手绘战争漫画与图像小说质感，粗黑墨线，低饱和冷灰、金属锈褐色配色，写实比例，侧面正视图。

严格正交侧视，枪口朝右，枪身水平。透明背景，无握把锚点（武器层单独输出）。"""

# 武器清单（文件名: 描述）
WEAPONS = {
    "bolt_action_rifle": "老式栓动步枪，木制枪托、长枪管，战场磨损，无瞄具",
    "desert_eagle": "大口径左轮手枪，长枪管、深色氧化钢，战场使用痕迹",
    "double_barrel_shotgun": "双管霰弹枪，短护木、战场磨损，泵动式",
    "glock_17": "紧凑型9mm半自动手枪，黑色聚合物，磨损明显",
    "m1_garand": "半自动战斗步枪，木质与钢制结构，经典美械",
    "m1911_pistol": ".45口径手枪，钢制枪身，复古设计",
    "mp5_smg": "紧凑冲锋枪，折叠枪托，现代战术风格",
    "sks_rifle": "半自动步枪，木质枪托，弧形弹匣，不带瞄具",
    "ak47": "突击步枪，弯曲弹匣，木质枪托，经典苏械",
    "colt_saa": "转轮左轮手枪，银色枪身，西部风格",
    "flintlock_musket": "燧发滑膛枪，长管木制，前装式",
    "mauser_c96": "半自动手枪，木制枪套（可选），德械风格",
}

print("="*60)
print("批量生成武器资产")
print("="*60)

for filename, desc in WEAPONS.items():
    output_path = PROJECT_DIR / "assets/weapons" / f"{filename}.png"
    temp_path = PROJECT_DIR / "assets/.temp_weapon.png"
    
    if output_path.exists() and not os.environ.get('FORCE_REGEN'):
        print(f"\n跳过已存在: {filename}.png")
        continue
    
    print(f"\n生成: {filename}")
    
    prompt = f"""{WEAPON_STYLE}

{desc}

生成一件模块化武器层：只画武器本体，不画人物、手、背带、枪焰、弹壳或环境。枪口朝右，枪身水平放置。透明背景，所有未绘制区域 alpha=0。

输出文件名: {filename}.png
画布: 512×512 RGBA PNG"""
    
    if call_agnes_api(prompt, temp_path):
        if process_to_rgba(temp_path, output_path, canvas_w=512, canvas_h=512):
            temp_path.unlink(missing_ok=True)
            print(f"✓ {filename} 完成")
        else:
            temp_path.unlink(missing_ok=True)
            print(f"✗ {filename} 失败")
    else:
        temp_path.unlink(missing_ok=True)


print("\n" + "="*60)
print("武器生成完成")
print("="*60)
