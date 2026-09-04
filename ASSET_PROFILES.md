# 通用资产预设

工作流现在支持通用精灵图资产，不再限定为 CoverProp。创建工作流时可传入：

- `asset_type`: `prop`、`character`、`weapon`、`vehicle`、`tile`、`background`、`ui`、`effect`
- `style_profile`: `clean_game`、`pixel_art`、`painted`、`concept`

两项均有兼容默认值（`prop` / `clean_game`），旧客户端无需修改即可继续使用。预设会写入工作流 JSON，供后续视角、状态变体和 QC 阶段读取；具体生成提示词仍以用户 prompt 为主。

MCP 工具 `sprite_create_workflow` 与 WebUI 创建表单均支持这两个字段。
