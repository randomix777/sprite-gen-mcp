#!/usr/bin/env python3
"""
批量生成缺失的敌人角色和动画序列
按照 AGNES_ART_PROMPTS.md 的顺序执行
"""
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

CANVAS_W, CANVAS_H = 512, 768
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
            "ratio": "2:3"
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


def process_to_rgba(input_path, output_path):
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
    margin_x = int(CANVAS_W * 0.05)
    margin_y = int(CANVAS_H * 0.03)
    effective_w = CANVAS_W - 2 * margin_x
    effective_h = CANVAS_H - 2 * margin_y
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
    canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
    ox = (CANVAS_W - nw) // 2
    oy = (CANVAS_H - nh) // 2
    canvas[oy:oy+nh, ox:ox+nw, :] = crop_arr
    
    final = Image.fromarray(canvas, 'RGBA')
    final.save(output_path, 'PNG')
    
    # 验证
    fa = np.array(final)
    corners_alpha = [fa[0, 0, 3], fa[0, -1, 3], fa[-1, 0, 3], fa[-1, -1, 3]]
    trans_pct = (fa[:, :, 3] < 32).sum() / (CANVAS_W * CANVAS_H) * 100
    body_pct = (fa[:, :, 3] > 32).sum() / (CANVAS_W * CANVAS_H) * 100
    
    print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA, body={body_pct:.1f}%, transparent={trans_pct:.1f}%")
    return all(c == 0 for c in corners_alpha) and trans_pct > 25


# ========== 敌人角色生成 ==========

ENEMY_STYLE = """《Code Chrono Bullet》横版末日战争生存游戏角色素材。手绘战争漫画与图像小说质感，粗黑墨线，低饱和冷灰、泥褐、锈红配色，写实人体比例，侧面正视图。

严格正交侧视，角色面朝右，完整身体（头、躯干、双臂、双腿、靴子）全部可见。人物姿态具有威胁感但不过度夸张。透明背景，无地面阴影。"""

# 敌人类型描述
ENEMY_TYPES = {
    "enemy_gunslinger": "武装拾荒者枪手，手持霰弹枪姿势，穿脏污皮夹克，戴防风镜，体型精瘦但肌肉发达。",
    "enemy_militia": "民兵组织成员，穿旧军装混搭，手持自制武器，体型中等偏胖，表情凶狠。",
    "enemy_general": "重型装甲指挥官，穿完整战术护甲，戴战术头盔，体型高大魁梧，表情冷酷威严。",
}

print("="*60)
print("批量生成敌人角色")
print("="*60)

for name, desc in ENEMY_TYPES.items():
    output_path = PROJECT_DIR / "assets/sprites/enemies" / f"{name}.png"
    temp_path = PROJECT_DIR / "assets/.temp_enemy.png"
    
    if output_path.exists() and not os.environ.get('FORCE_REGEN'):
        print(f"\n跳过已存在: {name}.png")
        continue
    
    print(f"\n生成: {name}")
    
    prompt = f"""{ENEMY_STYLE}

{desc}

生成角色"敌人基础身体"模块：成年武装敌人，中性军事体型，穿脏污旧制服内层、工装裤和旧靴子；没有枪、没有背包、没有头盔、没有护甲、没有胸挂。严格右向侧视，全身，双手保持固定持枪姿势但手中为空。人物姿态更具威胁感，但人体尺寸、脚底锚点和持枪锚点必须与玩家完全一致。使用角色技术规则与全局美术规范。

输出文件名: {name}.png
画布: 512×768 RGBA PNG，真实透明背景"""
    
    if call_agnes_api(prompt, temp_path):
        if process_to_rgba(temp_path, output_path):
            temp_path.unlink(missing_ok=True)
            print(f"✓ {name} 完成")
        else:
            temp_path.unlink(missing_ok=True)
            print(f"✗ {name} 失败")
    else:
        temp_path.unlink(missing_ok=True)


print("\n" + "="*60)
print("敌人角色生成完成")
print("="*60)
