# SPRITE-GEN 生产级优化任务

请在当前仓库 `D:\Projects\MCP\sprite-gen` 中直接完成以下优化。目标不是增加更多表面功能，而是把现有 MCP 从“能生成图片的工具”升级为可稳定生产 Godot 游戏资产的管线，重点服务 `D:\Projects\CodeChronoBullet` 的独立家具、智能掩体和可破坏环境系统。

## 工作原则

- 先检查当前工作树和现有实现，保留用户已有修改，不覆盖或回退无关变更。
- 修复根因，不通过修改测试来掩盖问题。
- 保持现有 MCP 工具向后兼容；必须修改返回结构时，在服务边界提供兼容层。
- 所有新路径、供应商请求、图片处理和 Godot 文件写入继续遵守现有安全限制。
- 不使用伪实现。参考图、批量生成、质量检测和 Godot 导出必须通过真实数据路径验证。
- 每完成一个阶段运行相关测试；最终运行完整测试并报告结果。

## P0：修复现有生产阻塞问题

### 0. 建立严格机器资产门禁

所有生成结果必须依次通过文件安全、像素质量、状态一致性和 Godot 适配四层门禁。不要使用可以互相抵消缺陷的综合评分：任一硬门禁失败必须立即拒绝；检测结果冲突、接近阈值或置信度不足时进入人工复核；只有全部硬门禁通过才能进入正式资产目录。

统一判定状态：

- `REJECTED`：任一硬门禁失败，或检测异常、字段缺失、非有限数值、证据生成失败。
- `REVIEW_REQUIRED`：没有硬失败，但关键指标接近阈值、不同检测结果冲突或一致性置信度不足。
- `APPROVED`：全部硬门禁通过，且没有待复核项。

自动发布采用严格、默认拒绝策略。QC 执行异常不得被转换成零值或成功结果。每条规则必须输出规则 ID、实测值、阈值、状态、失败原因和证据文件；不能只返回一个 `all_ok`。

#### 文件与透明层硬门禁

- PNG 必须可以完整解码，格式、尺寸、文件大小和总像素数符合限制。
- 家具、掩体和独立环境资产必须具有真实 alpha 通道；不能把白底、纯色底或棋盘格当作透明。
- 四角采样区域 alpha 最大值默认不得超过 `13/255`。
- 默认透明像素比例必须位于 `20%–95%`；完全透明、近似空图和几乎无透明区域必须拒绝。
- 检测白底、纯色背景、周期性棋盘格、RGB 泄漏、半透明白边、彩色光晕、锯齿和背景残留。
- RGB 与 RGBA 必须按实际通道数量和步长处理。不得在 `removeAlpha()` 后继续按四通道遍历。
- 抠图前后都要执行检测；执行过 cutout 不代表自动合格。

#### 主体构图硬门禁

- 从 alpha mask 提取主体最大连通区域、全部小连通区域、bounding box 和质心。
- 主体不得触碰画布四边；左右和顶部安全边距默认至少为画布的 `4%`。
- 主体面积默认占画布的 `15%–75%`。
- 小型孤立噪点总面积不得超过主体面积的 `1%`。
- 主体不得被裁切；bounding box、宽高、质心和边距必须是有效有限数值。
- 默认画布为 `1024×1024`，默认 `ground_anchor=[512,930]`，允许 style profile 或 manifest 覆盖。
- 主体底部到 ground anchor 的垂直偏移不得超过画布高度的 `2%`。
- 为每张图生成 alpha mask、bounding-box 叠加图、边距标记图和背景污染热图。

#### 状态一致性门禁

- `intact` 是唯一基准状态；`open`、`empty`、`rubble`、`breached` 等后续状态必须真实使用已验收的 intact 图作为参考。
- 比较画布、主体中心、接地点、朝向、轮廓、尺寸、调色板和视觉特征。
- 非破坏状态中心偏移不得超过画布宽高的 `3%`，接地点偏移不得超过画布高度的 `2%`。
- `open/empty` 等同物体状态的轮廓 IoU 默认不得低于 `0.55`。
- `rubble` 不强制高 IoU，但必须保持材料、色板和空间接地点关系；无法确认时进入 `REVIEW_REQUIRED`。
- 检测左右镜像、视角改变、尺寸突变、光照方向改变和明显风格漂移。
- 任一必需状态失败时，整套资产不得发布。

#### Godot 适配门禁

- 自动生成验证场景并使用 Godot 4 实际加载 `.tscn`，不能只用正则检查文本。
- 验证纹理、manifest、节点路径和外部资源引用全部有效且位于已验证的 Godot 项目根目录。
- 自动碰撞矩形必须非空、位于画布内且不得超出主体 bounding box；明显覆盖透明区域时拒绝或复核。
- `CoverZone`、`LeftPeekPoint`、`RightPeekPoint`、可选 `VaultPoint`、`DebrisOrigin` 和 ground anchor 必须位于画布内。
- `cover_height=low/high` 必须映射为项目定义的明确数值范围并写入 manifest/场景元数据。
- 在亮色、暗色、彩色和棋盘预览背景下生成验证截图；棋盘只能用于验证预览，不能写入正式纹理。
- 在 `100%`、`50%`、`25%` 缩放下检查边缘、可读性和锚点稳定性。
- 自动推断的碰撞和掩体点必须标记为自动生成，不能宣称等同人工设计。

#### 门禁目录与发布规则

```text
output/candidates/<session>/
output/rejected/<session>/
output/review/<session>/
output/approved/<prop_id>/
```

- 原始生成结果只能先写入 `candidates`。
- 硬门禁失败后移动到 `rejected`，保存完整报告和证据，禁止写入 `approved`。
- `REVIEW_REQUIRED` 进入 `review`，不得自动发布。
- 只有 `APPROVED` 才能复制到 `approved` 或用户指定的游戏正式目录。
- 正式目录默认禁止覆盖。`replace=true` 时也必须备份旧版本或生成新的版本目录。
- 每次验证保存原图、处理图、mask、bbox 预览、污染热图、缩放预览、`qc_report.json`、`manifest.json` 和 Godot 验证结果。

### 1. 统一生成结果协议

`generateImage()` 返回统一结果对象，图片当前位于 `result.data.images`，但部分调用方仍读取 `result.images`。

检查并修复至少以下路径：

- `lib/batch_gen.js`
- `lib/services.js` 中的 `sprite_edit`
- 其他直接调用 `generateImage()` 的模块

建立一个唯一的图片结果解包函数，避免各模块重复兼容判断。真实成功结果不得被误报为“没有图片”。批量任务必须保持输入顺序，并正确统计成功和失败数量。

### 2. 真正传递参考图片

目前 `imageUrls` 被上层接收，但 Agnes 请求体没有实际携带参考图片，导致 `sprite_edit`、状态变体和风格锁定无法成立。

要求：

- 根据各供应商真实支持的接口传递参考图片或内联图片数据。
- 本地参考图必须安全读取并按供应商要求转换为 base64、multipart 或可访问 URL。
- 不要把本地文件路径当作远程服务可以访问的 URL。
- 若某供应商不支持参考图，返回明确的 `UNSUPPORTED_FORMAT` 或能力错误，不能静默退化为纯文本生成。
- 返回元数据中标明 `reference_images_used`、供应商、模型和生成参数。
- `sprite_edit` 必须以最近一次成功输出作为参考，并把新输出追加到会话历史。

为 Agnes、Gemini、Stable Diffusion 和 ComfyUI 建立明确的 capability 描述，至少区分：

- text-to-image
- image-to-image
- 多参考图
- seed
- negative prompt
- 透明背景支持

### 3. 修复 QC 与调色板像素通道错误

`lib/analysis.js` 在 `removeAlpha()` 后仍按 RGBA 四通道遍历。修复所有类似问题，确保 RGB/RGBA 通道数量与步长一致。

QC 至少准确检测：

- 是否存在 alpha 通道
- 四角 alpha
- 整体透明比例
- 主体是否触碰四边
- 是否完全透明或近似空图
- 白底、棋盘格或纯色背景污染
- 主体 bounding box
- 安全边距比例
- 输出尺寸
- 多帧内容差异与空帧

增加回归夹具，明确覆盖透明 PNG、RGB PNG、完全透明图、主体贴边图、白底图和正常安全边距图。测试必须断言具体统计值，而不只是断言函数返回成功。

### 4. 修复提示词中的透明背景误导

检查 `lib/prompts.js`。不得再提示模型绘制“checkerboard pattern”来表示透明背景；棋盘格会被烘焙进图片。统一改为要求真实 alpha 或纯色可抠除背景，并与后处理策略一致。

#### Agnes 与不支持可靠 alpha 的供应商：自适应纯色色键背景

不要再要求 Agnes 生成棋盘格，也不要默认相信供应商能够直接输出可靠 alpha。对于不能稳定返回真实透明通道的供应商，统一采用“纯色色键生成 → 背景验收 → 软 alpha 抠图 → 去色溢 → 严格 QC”的数据路径。

色键选择规则：

1. 默认使用纯洋红 `RGB(255,0,255)` / `#FF00FF`。
2. 如果参考图、提示词、材质 profile 或已生成主体包含大量紫色/洋红色，切换为纯亮绿 `RGB(0,255,0)` / `#00FF00`。
3. 如果主体包含大量绿色，切换为纯亮蓝 `RGB(0,102,255)` / `#0066FF`。
4. 优先选择与参考图主体调色板距离最大的候选色，不得固定使用可能与木材、砖石、布艺或特效主体冲突的红色背景。
5. 将最终选择写入请求和元数据：`background_strategy="solid_chroma"`、`chroma_color`、`chroma_color_rgb`。

供应商 Prompt 必须明确包含等价约束：

```text
Generate one isolated game prop only, centered and fully visible.

Background requirements:
- Use one perfectly uniform solid chroma-key background color: {CHROMA_NAME} RGB({R}, {G}, {B}), hex {CHROMA_HEX}.
- The entire background must be exactly one flat color.
- No checkerboard pattern, gradient, texture, floor, wall, room, scenery, horizon, border, frame, shadow, reflection, glow, smoke, particles, text, labels, or watermark.
- Do not use the chroma-key background color anywhere on the object.
- Keep at least 8% clear background margin around the object.
- The complete object silhouette must remain inside the canvas, including legs, corners, handles, and debris.
- Place the lowest physical contact point consistently near the requested ground anchor.
```

负面提示词必须包含：

```text
checkerboard, transparency grid, white background, gray background,
gradient background, textured background, room, wall, floor, scenery,
cast shadow, reflection, glow, border, frame, cropped, cut off,
multiple objects, contact sheet, text, watermark, chroma-colored object details
```

抠图前必须先验证供应商原图的背景，不能直接进入颜色移除：

- 四角和画布边缘的采样颜色必须接近请求的色键颜色。
- 背景区域颜色方差必须低，拒绝渐变、纹理、棋盘格、阴影和多色背景。
- 背景占比默认至少为 `20%`。
- 主体区域不得大量包含与色键过近的颜色；冲突时应使用其他色键重新生成，不能强行删除主体。
- 背景验收失败时返回 `REJECTED`，规则 ID 明确区分 `CHROMA_MISMATCH`、`BACKGROUND_VARIANCE`、`BACKGROUND_PATTERN`、`CHROMA_SUBJECT_CONFLICT` 和 `BACKGROUND_SHADOW`。

色键抠图必须使用颜色距离和软过渡，禁止仅删除完全相等的 RGB：

- 与估计背景色距离处于内阈值的像素设为完全透明。
- 内外阈值之间按颜色距离计算软 alpha。
- 外阈值以外保留为主体。
- 阈值必须可配置，并以 RGB/Lab 等明确色彩距离计算；测试固定算法和默认值。
- 对半透明边缘执行去色溢，用邻近主体颜色恢复被背景污染的 RGB。
- 删除与主体最大连通区域无关的小背景碎片，但保留 manifest/style profile 允许的独立部件。
- 抠图后重新执行透明比例、四角 alpha、安全边距、白边、彩色光晕、主体完整性和噪点门禁。

新增供应商背景能力描述，至少包含：

- `native_alpha`: 是否能可靠返回真实 alpha；
- `solid_chroma`: 是否使用纯色色键策略；
- `preferred_chroma_colors`: 候选色列表；
- `supports_negative_prompt`: 是否能独立传递负面提示；
- `requires_post_cutout`: 是否必须经过后处理。

Agnes 默认配置为 `solid_chroma=true`、`requires_post_cutout=true`，除非真实供应商穿透测试证明当前模型能够稳定输出合格 alpha。不要根据接口声明或单张成功样本把它标记为可靠原生透明。

## P1：增加生产级家具资产工作流

新增一个面向游戏家具与掩体的 MCP 工具，建议名称：

`sprite_generate_cover_prop`

输入至少包括：

- `prop_id`
- `prompt`
- `material_type`: wood / metal / glass / fabric / masonry / composite
- `cover_height`: low / high
- `width`, `height`
- `provider`
- `reference_image_path`（可选）
- `seed`（可选）
- `states`，默认 `intact` 与 `rubble`
- `output_dir`
- `godot_project_path`（可选）

生成流程：

1. 生成或读取完整主体参考图。
2. 执行抠图和严格 QC。
3. 锁定画布尺寸、主体缩放、接地点、朝向和安全边距。
4. 以完整主体作为真实参考生成残骸或破坏变体。
5. 对所有状态做轮廓、尺寸、接地点和风格一致性检查。
6. 失败素材进入候选目录，不得覆盖正式资产。
7. 通过后输出资产清单和可选 Godot 场景。

不要默认要求每件家具生成 `closed/open/empty/damaged` 四态：

- 普通掩体家具：`intact` + `rubble`。
- 可搜索容器：可追加 `open` + `empty`。
- 门窗：根据交互需求追加 `open`、`breached`。
- 受损过程优先由 Shader、贴花、粒子和通用碎片表达。

## P1：定义 CoverProp 资产清单

为每件家具输出机器可读 JSON，例如：

```json
{
  "schema_version": 1,
  "prop_id": "wooden_bed_01",
  "display_name": "Wooden Bed",
  "material_type": "wood",
  "canvas_size": [1024, 1024],
  "ground_anchor": [512, 930],
  "states": {
    "intact": "wooden_bed_01_intact.png",
    "rubble": "wooden_bed_01_rubble.png"
  },
  "cover": {
    "height": "low",
    "left_peek": true,
    "right_peek": true,
    "vaultable": true
  },
  "destruction": {
    "max_health": 100,
    "destroyed_cover_height": "none"
  },
  "placement": {
    "allowed_zones": ["wall", "center"],
    "requires_wall": false,
    "clearance_px": 48
  }
}
```

对 schema 进行运行时验证，并保留版本字段以支持后续迁移。

## P1：Godot CoverProp 场景导出

扩展 Godot 导出能力，使其可以从上述 manifest 生成 Godot 4 `.tscn`。输出至少包含：

```text
CoverProp (Node2D)
├── Sprite2D
├── StaticBody2D
│   └── CollisionShape2D
├── CoverZone (Area2D)
│   └── CollisionShape2D
├── LeftPeekPoint (Marker2D)
├── RightPeekPoint (Marker2D)
├── VaultPoint (Marker2D，可选)
└── DebrisOrigin (Marker2D)
```

第一版允许使用基于非透明 bounding box 的保守矩形碰撞，但必须：

- 明确标记为自动生成；
- 允许通过 manifest 覆盖；
- 保证碰撞不超出画布；
- 不声称自动推断结果等同人工设计。

场景需携带 NPC 与玩家共享的掩体元数据，例如高度、朝向、探身点、翻越能力、材质和生命值。不要在工具中实现完整游戏 AI，只负责可靠导出数据。

## P1：风格与状态一致性

增加项目级 style profile，例如：

- 统一美术描述与负面提示词
- 固定画布和接地点
- 允许色板或参考图
- 侧视/正交视角
- 光照方向
- 线条粗细
- 安全边距
- 禁止文字、水印、联系表、棋盘格和场景背景

同一家具系列的后续状态必须引用已验收的 `intact` 图。增加可量化的一致性报告：

- 主体 bounding box 差异
- 接地点偏移
- 轮廓 IoU 或相似指标
- 调色板距离
- 左右翻转或朝向异常

不要只依靠 prompt 中的“保持一致”。

## P2：候选、门禁和发布流程

建立目录阶段：

```text
output/candidates/<session>/
output/approved/<prop_id>/
output/rejected/<session>/
```

- 生成结果先进入 `candidates`。
- QC 失败进入 `rejected` 并保存报告。
- 只有全部门禁通过后才能进入 `approved` 或用户指定的游戏正式目录。
- 默认禁止覆盖已存在的正式资产；显式 `replace=true` 时也要先备份或生成新版本。
- 生成 `manifest.json`、`qc_report.json` 和缩略预览。

## P2：存量美术资产审计与受控重生成

新增一个用于检查现有美术资产的 MCP 工具，建议名称：

`sprite_audit_assets`

该工具默认必须是只读审计，不能在扫描阶段修改、移动、删除或覆盖任何现有资产。它应能够扫描单个文件、目录或 Godot 项目内的指定资产根目录，并复用与新生成资产完全相同的严格机器门禁，避免“新资产严格、旧资产放行”的双重标准。

输入至少包括：

- `input_path`：单个图片、资产目录或 Godot 项目路径；
- `recursive`：是否递归，默认 `true`；
- `asset_type`：`auto / cover_prop / sprite / animation / effect / tileset / ui`；
- `style_profile`：可选项目级风格配置；
- `manifest_path`：可选，用于提供 ground anchor、状态关系和 Godot 元数据；
- `reference_root`：可选，状态一致性参考图根目录；
- `report_dir`：审计报告目录；
- `strict`：默认 `true`；
- `include_patterns`、`exclude_patterns`：可选过滤规则；
- `godot_project_path`：可选，用于执行 Godot 资源和场景验证。

审计流程：

1. 安全枚举支持的图片、manifest、`.tscn` 和相关资源，限制深度、文件数和总字节数，防止符号链接或 junction 逃逸。
2. 为每个资产识别类型、尺寸、状态关系、引用位置和可能的 intact 基准。
3. 执行文件、透明层、背景污染、主体构图、状态一致性和 Godot 适配门禁。
4. 输出每个资产的 `APPROVED / REVIEW_REQUIRED / REJECTED`、规则明细、证据图片和引用关系。
5. 生成机器可读 `asset_audit.json`、人类可读 `asset_audit.md`、汇总 CSV 和预览联系表；联系表仅用于报告，不能被当作正式资产。
6. 记录扫描总数、通过数、复核数、拒绝数、未识别数、误差和无法验证原因。
7. 不得因为缺少 manifest 就把所有资产直接判定为合格；缺少关键锚点或状态关系时进入 `REVIEW_REQUIRED`。

单个审计记录至少包含：

```json
{
  "asset_path": "res://assets/props/wooden_bed_01_intact.png",
  "asset_type": "cover_prop",
  "status": "REJECTED",
  "hard_failures": ["BACKGROUND_PATTERN", "EDGE_COLOR_SPILL"],
  "review_reasons": [],
  "measurements": {},
  "evidence": {},
  "references": [],
  "recommended_action": "REGENERATE",
  "regeneration_input": {}
}
```

### 受控重生成工具

新增独立工具，建议名称：

`sprite_regenerate_rejected_assets`

不要让审计工具在扫描过程中隐式触发生成。审计和重生成必须是两个明确阶段，以便用户先查看报告、调整阈值并批准范围。

输入至少包括：

- `audit_report_path`；
- `statuses`：默认仅 `REJECTED`，不得默认重生成 `REVIEW_REQUIRED`；
- `rule_ids`：可选，仅重生成指定失败原因；
- `asset_paths`：可选白名单；
- `provider`；
- `style_profile`；
- `max_assets`；
- `max_attempts_per_asset`，默认 `3`；
- `output_root`，必须位于候选目录；
- `approve_after_gate`，默认 `false`；
- `replace`，默认 `false`。

重生成规则：

1. 原文件永远作为只读参考保存，禁止原地覆盖。
2. 从审计报告、文件名、manifest、引用场景和人工补充信息恢复生成参数；信息不足时进入 `REVIEW_REQUIRED`，不得猜测关键产品语义。
3. 背景污染类失败使用自适应纯色色键策略；状态一致性失败必须以 intact 或最近一次已验收资产作为真实参考。
4. 每次重生成进入独立的 `candidates/regeneration_<session>/` 版本目录。
5. 每次尝试都重新执行全部门禁，而不仅是之前失败的规则，防止修复背景时破坏构图或状态一致性。
6. 达到最大次数仍失败时停止并保存所有尝试，不得无限消耗 Provider 配额。
7. 默认 `approve_after_gate=false`：即使新资产通过机器门禁，也进入待确认结果；只有显式允许时才能发布到 approved。
8. `replace=true` 也不能覆盖原始文件；必须先创建带时间戳或内容哈希的备份和版本化新文件，再更新 manifest/引用。
9. 输出新旧对比：透明层、bbox、接地点、状态一致性、Godot 截图、规则变化和文件哈希。
10. Provider 请求失败、取消或配额不足不能改变原资产状态。

### 审计与重生成安全策略

- 扫描根目录、报告目录和候选输出目录必须分别验证，禁止目录穿越和输入输出同路径。
- 审计报告不得包含 API key、Authorization header 或完整供应商响应。
- Godot 项目扫描只读；更新引用必须是重生成流程中的独立显式动作，并使用临时文件加原子替换。
- 支持 `dry_run=true`，输出将要重生成的资产、预计调用次数和输出位置，不发起 Provider 请求。
- 支持成本上限：`max_assets`、`max_attempts_per_asset` 和可选 `max_provider_requests`。
- 对历史资产的自动审计结果必须允许人工覆盖，但人工覆盖要记录操作者、原因、时间和原始机器判定。

## 测试要求

在现有测试基础上增加：

1. `generateImage` 统一结果解包测试。
2. 批量生成真实成功包络测试，确保不会误报失败。
3. `sprite_edit` 使用最近参考图并写入历史的测试。
4. Agnes 请求体实际包含参考图的 mock HTTP 断言。
5. 不支持参考图的供应商明确报错测试。
6. RGB/RGBA QC 精确数值测试。
7. 透明、白底、棋盘格、贴边和空图门禁测试。
8. CoverProp manifest schema 测试。
9. CoverProp Godot `.tscn` 可解析测试。
10. 候选素材不得在 QC 失败时写入 approved 目录的测试。
11. 输出路径覆盖、目录穿越和输入输出同路径安全测试。
12. 严格机器门禁回归夹具：真实透明 PNG、RGB PNG、完全透明图、近似空图、白底、纯色底、周期性棋盘格、假透明、白色毛边、彩色光晕、主体贴边、裁切、孤立噪点、错误接地点和正常安全边距图。
13. 每个不合格夹具必须被对应规则拒绝，并断言具体统计值、规则 ID、阈值和证据文件；不能只断言返回失败。
14. 合格夹具必须通过，防止门禁过严导致全部误杀。
15. 状态一致性夹具必须覆盖中心偏移、接地点偏移、IoU 不足、镜像、尺寸突变、调色板漂移和正常同系列状态。
16. Godot 门禁必须通过 Godot 4 实际加载生成的 `.tscn`，并验证节点、资源、碰撞、掩体点和纹理路径。
17. QC 代码异常、字段缺失、`NaN`、`Infinity` 或证据生成失败必须得到 `REJECTED`，不得静默放行。
18. QC 失败或 `REVIEW_REQUIRED` 时不得在 `approved` 或游戏正式目录产生文件。
19. 将历史不合格资产加入回归集，记录误放率和误拒率；商业发布优先降低误放率。
20. `test:commercial` 必须包含严格 QC 回归套件；任一硬门禁回归失败、关键测试跳过或证据缺失时返回非零退出码。
21. Agnes mock 请求必须断言最终 Prompt 包含选定的纯色色键、禁止棋盘格、禁止阴影/场景背景和安全边距要求；不得只检查请求成功。
22. 色键选择测试必须覆盖：默认洋红、洋红主体切换亮绿、绿色主体切换亮蓝，并验证选择结果写入生成元数据。
23. 原图背景验收测试必须覆盖：准确纯色、色值偏差、渐变、阴影、多色、棋盘格、背景占比不足和主体色键冲突。
24. 软 alpha 测试必须使用合成边缘夹具，断言内阈值透明、过渡区半透明、主体保留和去色溢后的边缘 RGB；不能只目视检查。
25. 色键背景失败必须阻止 cutout 后结果进入 `approved`；切换色键重试必须有最大次数，避免无限生成。
26. 存量资产审计测试必须覆盖单文件、递归目录、Godot 项目、未知资产类型、缺失 manifest、符号链接逃逸、损坏图片和混合合格/不合格目录。
27. 审计必须证明只读：运行前后所有输入文件的路径、大小、mtime 和哈希保持不变。
28. 审计报告必须准确统计 `APPROVED / REVIEW_REQUIRED / REJECTED`，并能从报告定位每条规则的证据。
29. 重生成测试必须使用 mock Provider，验证默认只处理 `REJECTED`、不覆盖原文件、每次尝试重新执行全部门禁并遵守最大尝试次数。
30. `dry_run` 测试必须证明没有 Provider 请求、没有候选图片写入和没有 Godot 引用修改。
31. 重生成成功后必须生成新旧对比报告；失败、取消或达到上限后原文件及其 Godot 引用必须保持不变。

最终至少运行：

```powershell
npm test
npm run test:contract
npm run test:security
npm run test:qc
npm run test:commercial
```

如环境已配置真实供应商，再运行供应商穿透测试；没有 API key 时应明确跳过，不能伪造通过。

## 完成标准

任务只有在以下条件全部满足时才算完成：

- P0 的结果包络、参考图和 QC 错误均已修复并有回归测试。
- `sprite_generate_cover_prop` 能完成候选生成、QC、manifest 和可选 Godot 场景导出。
- 参考图确实进入供应商请求或供应商明确返回不支持。
- QC 能可靠阻止空图、背景污染和主体贴边素材进入正式目录。
- 严格机器门禁输出 `REJECTED`、`REVIEW_REQUIRED`、`APPROVED` 三态，并对每条规则提供实测值、阈值和证据。
- 白底、棋盘格、假透明、毛边、光晕、裁切、噪点和错误接地点夹具全部被准确拒绝，正常夹具不会被误杀。
- Agnes 及不支持可靠 alpha 的供应商使用自适应纯色色键背景；色键选择、背景验收、软 alpha 和去色溢均有真实数据路径与回归测试。
- 所有自动生成 Prompt 已移除要求模型绘制棋盘格的文本；棋盘格只允许作为本地验证预览背景。
- `sprite_audit_assets` 能以只读方式检查已有美术资产，并对每项资产输出三态判定、规则证据和建议动作。
- `sprite_regenerate_rejected_assets` 只在显式调用后处理审计报告中的拒绝资产，默认不覆盖、不自动批准，并严格限制资产数、尝试次数和 Provider 请求数。
- 状态一致性门禁能阻止中心/接地点漂移、镜像、尺寸突变和明显风格漂移的整套资产发布。
- 生成的 Godot 场景可被 Godot 4 加载，节点和资源引用有效。
- 原有 MCP 工具和测试没有回归。
- README 增加新工作流、示例、供应商能力矩阵和限制说明。

完成后请报告：

- 修改的文件；
- 修复的根因；
- 新增 MCP 工具及调用示例；
- 测试命令和实际结果；
- 尚未解决的供应商限制；
- 如何从 `CodeChronoBullet` 接入生成的 CoverProp 资产。
