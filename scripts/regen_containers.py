#!/usr/bin/env python3
"""重新生成容器资产，确保外形一致性"""
import sys
import os
import numpy as np
from PIL import Image
from scipy import ndimage
import urllib.request
import json

PROJECT_DIR = r"D:/Projects/CodeChronoBullet"
API_KEY = os.environ.get("HERMES_CUSTOM_AGNES_API_KEY", "")
API_URL = "https://apihub.agnes-ai.com/v1/images/generations"
MODEL = "agnes-image-2.1-flash"

CANVAS_W, CANVAS_H = 512, 768
DIST_THRESHOLD = 60.0
BBOX_PADDING = 30

STYLE_PREFIX = """《Code Chrono Bullet》横版末日战争生存游戏场景素材。粗黑墨线、手绘战争漫画与图像小说质感，写实建筑比例，厚涂材质，低饱和冷灰、泥褐、锈红和暗军绿配色，局部暖黄灯光，磨损、烟熏、弹孔、剥落墙皮和潮湿污迹细节丰富。风格必须与 This War of Mine 式侧视剖面生存场景一致，但不得复制任何现有游戏素材。

严格正交侧视，摄像机正对建筑立面，不要俯视，不要等距视角，不要广角透视，不要消失点，不要倾斜地平线。

输出 PNG。除明确要求无缝纹理的地面素材外，必须使用真实透明 RGBA 背景；未绘制区域 alpha=0，不得把棋盘格、白底、黑底或环境背景画进图片。无人物、无敌人、无尸体、无武器、无 UI、无文字、无数字、无标志、无水印、无 Logo。

每次请求只能输出一个 PNG 文件。不要联系表、九宫格、素材合集、状态对照图、展示板或多视图。不要把生成结果裁切后粘到透明画布；必须从一开始就在指定尺寸的 RGBA 画布上生成。透明区域的 RGB 内容也不得保留可见棋盘格图案。"""


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
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
            items = data.get("data") or []
            if not items:
                print(f"ERROR: no data in response for {output_path.name}")
                return False
            url = items[0].get("url")
            if url:
                return download_image(url, output_path)
            else:
                print(f"ERROR: no url in response for {output_path}")
                return False
    except Exception as e:
        print(f"ERROR calling API for {output_path}: {e}")
        return False


def download_image(url, dest_path):
    """下载图片"""
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, dest_path)
        return True
    except Exception as e:
        print(f"ERROR downloading {dest_path}: {e}")
        return False


def process_to_rgba(input_path, output_path):
    """处理图像为 RGBA"""
    img = Image.open(input_path).convert('RGB')
    rgb = np.array(img)
    h, w = rgb.shape[:2]
    
    # 计算背景色
    corner_size = min(50, w // 10, h // 10)
    corners = [
        rgb[:corner_size, :corner_size].reshape(-1, 3),
        rgb[:corner_size, -corner_size:].reshape(-1, 3),
        rgb[-corner_size:, :corner_size].reshape(-1, 3),
        rgb[-corner_size:, -corner_size:].reshape(-1, 3),
    ]
    bg_rgb = np.mean(np.vstack(corners), axis=0)
    
    # 距离切图
    rgb_f = rgb.astype(np.float32)
    dist = np.sqrt(((rgb_f - bg_rgb) ** 2).sum(axis=2))
    alpha = np.where(dist > DIST_THRESHOLD, 255, 0).astype(np.uint8)
    
    # 合并为 RGBA
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = alpha
    
    # Bbox 裁剪（带 padding）
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
    
    # 缩放（留 5% 水平边距，3% 垂直边距）
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

    # 形态学清理：使用更大的结构元素去除噪点
    from scipy import ndimage
    alpha_bin = crop_arr[:, :, 3] > 0
    # 先用更大的核膨胀，再腐蚀（opening）
    alpha_bin = ndimage.binary_opening(alpha_bin, structure=np.ones((7,7)))
    # 填充空洞
    alpha_bin = ndimage.binary_closing(alpha_bin, structure=np.ones((7,7)))
    # 确保最小连通分量（移除小于50像素的孤立噪点）
    labels, num = ndimage.label(alpha_bin)
    if num > 0:
        # 只保留最大的连通分量
        areas = np.bincount(labels.ravel())
        if len(areas) > 1:
            max_label = areas[1:].argmax() + 1
            alpha_bin = (labels == max_label)
    crop_arr[:, :, 3] = (alpha_bin * 255).astype(np.uint8)
    
    # 居中到画布
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
    
    print(f"  ✓ {CANVAS_W}x{CANVAS_H} RGBA, corners={corners_alpha}, transparent={trans_pct:.1f}%")
    return all(c == 0 for c in corners_alpha) and trans_pct > 25


def generate_container(name, description, output_filename, reference_filename=None):
    """生成单个容器资产"""
    output_path = Path(f"{PROJECT_DIR}/{output_filename}")
    temp_path = Path(f"{PROJECT_DIR}/assets/.temp_{output_path.name}")
    
    if output_path.exists() and not os.environ.get('FORCE_REGEN'):
        print(f"跳过已存在: {output_path.name}")
        return True
    
    print(f"\n生成: {name}")
    if reference_filename:
        ref_path = Path(f"{PROJECT_DIR}/{reference_filename}")
        if ref_path.exists():
            print(f"参考: {ref_path.name}")
    
    prompt = f"{STYLE_PREFIX}\n\n"
    if reference_filename:
        prompt += f"基于已通过验收的 {reference_filename} 外轮廓和尺寸，只改变门/抽屉的状态。\n\n"
    prompt += description
    
    if call_agnes_api(prompt, temp_path):
        if process_to_rgba(temp_path, output_path):
            temp_path.unlink(missing_ok=True)
            print(f"✓ {name} 完成")
            return True
        else:
            temp_path.unlink(missing_ok=True)
            return False
    else:
        temp_path.unlink(missing_ok=True)
        return False


if __name__ == '__main__':
    from pathlib import Path
    
    print("="*60)
    print("重新生成容器资产（锁定外形）")
    print("="*60)
    
    # 冰箱（先 closed，再用 closed 作为参考）
    generate_container(
        "refrigerator_closed",
        """关闭的冰箱，严格侧视，透明背景。老旧家用冰箱，单门，表面有磨损和污渍。门把手在右侧。尺寸适中，适合作为可搜刮物。精确画布 512×768 RGBA PNG，真实透明背景。""",
        "assets/containers/refrigerator_closed.png"
    )
    
    generate_container(
        "refrigerator_open",
        """打开的冰箱，严格侧视，透明背景。与 closed 状态保持完全一致的外轮廓、尺寸、位置和光照方向。只有门打开约90度，露出内部空腔。内部无食物，保持空白以便程序化填充。无地面阴影。""",
        "assets/containers/refrigerator_open.png",
        reference_filename="assets/containers/refrigerator_closed.png"
    )
    
    generate_container(
        "refrigerator_empty",
        """已搜空的冰箱，严格侧视，透明背景。与 closed 状态保持完全一致的外轮廓、尺寸、位置和光照方向。门完全打开，内部空无一物，灯光熄灭。无地面阴影。""",
        "assets/containers/refrigerator_empty.png",
        reference_filename="assets/containers/refrigerator_closed.png"
    )
    
    # 木箱
    generate_container(
        "wooden_crate_closed",
        """关闭的木箱，严格侧视，透明背景。标准军用木箱，箱盖关闭，金属包角可见。木板拼接，表面有磨损。精确画布 512×768 RGBA PNG，真实透明背景。""",
        "assets/containers/wooden_crate_closed.png"
    )
    
    generate_container(
        "wooden_crate_open",
        """打开的木箱，严格侧视，透明背景。与 closed 状态保持完全一致的外轮廓、尺寸、位置和光照方向。只有箱盖打开约45度，露出内部空间。内部无具体物品，保持空白以便程序化填充。无地面阴影。""",
        "assets/containers/wooden_crate_open.png",
        reference_filename="assets/containers/wooden_crate_closed.png"
    )
    
    generate_container(
        "wooden_crate_empty",
        """已搜空的木箱，严格侧视，透明背景。与 closed 状态保持完全一致的外轮廓、尺寸、位置和光照方向。箱盖完全打开平放，内部空无一物。无地面阴影。""",
        "assets/containers/wooden_crate_empty.png",
        reference_filename="assets/containers/wooden_crate_closed.png"
    )
    
    print("\n" + "="*60)
    print("生成完成")
    print("="*60)
