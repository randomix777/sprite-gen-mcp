# Agnes Image 2.5 Flash 官方 API 参数

> 官方文档：https://agnes-ai.com/zh-Hans/docs/agnes-image-25-flash  
> 核对日期：2026-09-01

## 基本信息

- 模型：`agnes-image-2.5-flash`
- Endpoint：`POST https://apihub.agnes-ai.com/v1/images/generations`
- 鉴权：`Authorization: Bearer YOUR_API_KEY`
- Content-Type：`application/json`
- 建议客户端超时：60–360 秒

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定使用 `agnes-image-2.5-flash`。 |
| `prompt` | string | 是 | 图像生成或编辑指令。 |
| `size` | string | 是 | 推荐 `1K`、`2K`、`3K`、`4K`；兼容部分 `1024x768` 格式的历史精确尺寸。 |
| `ratio` | string | 否 | 与档位式 `size` 配合；默认 `1:1`。 |
| `image` | string[] | 图生图必填 | 官方参数说明中的输入图像数组；实际图生图示例放在 `extra_body.image`。支持公共 HTTPS URL 或 Data URI Base64。 |
| `return_base64` | boolean | 否 | 文生图需要 Base64 响应时设为 `true`。 |
| `extra_body` | object | 否 | 图生图、多图合成和输出格式等高级参数。 |
| `extra_body.image` | string[] | 图生图必填 | 输入图片 URL 或 Data URI Base64 数组。 |
| `extra_body.response_format` | string | 否 | `url` 或 `b64_json`。不得把 `response_format` 放在请求体顶层。 |

官方文档没有列出 `n`、`seed`、`negative_prompt` 或 `tags` 参数。图生图不应发送 `tags: ["img2img"]`。

## 支持的宽高比

`1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`

## 原生输出尺寸

| Ratio | 1K | 2K | 3K | 4K |
| --- | --- | --- | --- | --- |
| `1:1` | 1024×1024 | 2048×2048 | 3072×3072 | 4096×4096 |
| `3:4` | 864×1152 | 1728×2304 | 2592×3456 | 3456×4608 |
| `4:3` | 1152×864 | 2304×1728 | 3456×2592 | 4608×3456 |
| `16:9` | 1312×736 | 2624×1472 | 3936×2208 | 5248×2944 |
| `9:16` | 736×1312 | 1472×2624 | 2208×3936 | 2944×5248 |
| `2:3` | 832×1248 | 1664×2496 | 2496×3744 | 3328×4992 |
| `3:2` | 1248×832 | 2496×1664 | 3744×2496 | 4992×3328 |
| `21:9` | 1568×672 | 3136×1344 | 4704×2016 | 6272×2688 |

不受原生支持的精确尺寸可能被服务映射到最接近的档位和宽高比。需要 128×128 等游戏资产时，应请求 `1K`、`1:1`，再在本地缩放。

## 文生图：Base64 输出

```json
{
  "model": "agnes-image-2.5-flash",
  "prompt": "A game prop isolated on a solid uniform background",
  "size": "1K",
  "ratio": "1:1",
  "return_base64": true
}
```

响应图片路径：`data[0].b64_json`

## 文生图：URL 输出

```json
{
  "model": "agnes-image-2.5-flash",
  "prompt": "A cinematic environment with rich visual detail",
  "size": "2K",
  "ratio": "16:9",
  "extra_body": {
    "response_format": "url"
  }
}
```

响应图片路径：`data[0].url`

## 图生图：Base64 输出

```json
{
  "model": "agnes-image-2.5-flash",
  "prompt": "Create a destroyed version while preserving material and composition",
  "size": "1K",
  "ratio": "1:1",
  "extra_body": {
    "image": [
      "data:image/png;base64,BASE64_HERE"
    ],
    "response_format": "b64_json"
  }
}
```

## URL 响应格式

```json
{
  "created": 1780000000,
  "data": [
    {
      "url": "https://storage.googleapis.com/agnes-aigc/xxx.png",
      "b64_json": null,
      "revised_prompt": null
    }
  ]
}
```

## Base64 响应格式

```json
{
  "created": 1780000000,
  "data": [
    {
      "url": null,
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
      "revised_prompt": null
    }
  ]
}
```

## 接入检查清单

- 使用 `agnes-image-2.5-flash`。
- 请求完整 endpoint：`https://apihub.agnes-ai.com/v1/images/generations`。
- 文生图包含 `model`、`prompt`、`size`。
- 优先使用档位式 `size` 并搭配 `ratio`。
- 文生图 Base64 输出使用 `return_base64: true`。
- 图生图输入放在 `extra_body.image`。
- 图生图 Base64 输出使用 `extra_body.response_format: "b64_json"`。
- 不在顶层放置 `response_format`。
- 不传递 `tags: ["img2img"]`。
