# Godot 门禁升级 — 完成报告

## 一、修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/godot.js` | 新建 | 统一 Godot 可执行文件解析器（优先级链 + Windows 自动检测） |
| `lib/cover_prop.js` | 修改 | 修复 `exitCode` → `exit_code` 命名统一 |
| `lib/audit.js` | 修改 | 修复 `exitCode` → `exit_code` 命名统一 |
| `lib/config.js` | 修改 | 扩展配置支持 `godot` 对象（加载/保存/验证） |
| `web/server.js` | 修改 | 新增 `/api/godot-config` 和 `/api/godot/detect` API 端点 |
| `web/public/app.js` | 修改 | 显示 Godot 状态 + 手动配置弹窗 |
| `web/public/index.html` | 修改 | 添加 `#godot-status` 容器 |
| `test/commercial.js` | 修改 | `godot_gate` 标为 `critical: true`，新增 `godot_resolution` 套件 |
| `test/godot_gate_test.js` | 保留 | 已有真实场景加载断言 |
| `test/godot_resolution_test.js` | 新建 | 10 项 Godot 解析器测试（30 断言全通过） |

## 二、实现内容

### 1. 统一的 Godot 可执行文件解析器 (`lib/godot.js`)

**优先级链：**
1. 运行时参数 `godot_executable`
2. 项目配置 `settings.godot.executablePath`
3. 环境变量 `GODOT4_BIN`
4. PATH 中的 `godot4`、`godot`
5. Windows 常见安装位置（有界扫描，不遍历整个磁盘）
   - `%LOCALAPPDATA%\Godot\`
   - `%ProgramFiles%\Godot\`
   - `%ProgramFiles(x86)%\Godot\`
   - `D:\Godot*.exe`
   - 项目附近目录

**验证机制：**
- 使用 `--version` 参数验证二进制有效性
- 检查版本字符串是否包含 `4.` 确保是 Godot 4.x

### 2. 持久化配置 (`lib/config.js`)

```json
{
  "godot": {
    "executablePath": "D:\\Godot_v4.7.2-stable_win64_console.exe",
    "autoDetect": true,
    "requireForPublish": true
  }
}
```

新增 API：
- `getGodotConfig()` — 获取 Godot 配置
- `setGodotConfig(settings)` — 保存 Godot 配置
- `validateGodotConfig(config)` — 验证配置有效性

### 3. WebUI 手动配置

- 页面顶部显示 Godot 状态（✓/✗ + 路径）
- 点击"手动配置"按钮弹出配置对话框
- 支持输入自定义路径 + 重新检测
- 配置持久化到 `config/settings.json`

### 4. API 端点

- `GET /api/godot-config` — 获取当前配置和状态
- `POST /api/godot-config` — 保存新配置
- `GET /api/godot/detect` — 实时检测 Godot 路径

### 5. 命名统一

修复 `runGodotHeadless` 返回结构中的 `exitCode` → `exit_code` 命名：
- `lib/cover_prop.js:972`
- `lib/audit.js:404`

### 6. 测试套件

- `godot_gate` 升级为 `critical: true`
- 新增 `godot_resolution` 套件（30 断言全通过）
- 商业测试现在正确报告 Godot 门禁状态

## 三、测试结果

```
npm test                  → 86 passed, 0 failed ✓
npm run test:phased       → 16 passed, 0 failed ✓
npm run test:contract     → 73 passed, 0 failed ✓
npm run test:security     → 111 passed, 0 failed ✓
npm run test:mcp          → 8 passed, 0 failed ✓
npm run test:godot-resolution → 30 passed, 0 failed ✓
git diff --check          → ✓

npm run test:commercial   → 19/20 PASS, 1 BLOCKED
                          (godot_gate BLOCKED 因为当前环境未找到 Godot 二进制)
```

**VERDICT:** `⊘ BLOCKED — All critical tests pass, but Godot-gated verification is BLOCKED (engine binary not found).`

这是**预期行为**：
- 当前环境确实没有安装 Godot 4
- 商业套件正确报告 BLOCKED 而非虚假的 READY
- 当用户安装 Godot 并配置后，godot_gate 将变为 PASS，verdict 变为 READY

## 四、关键保证

1. **无假绿**：Godot 不可用时绝不返回 APPROVED
2. **真实加载验证**：`runGodotHeadless` 有硬超时（25 秒），不会挂起
3. **路径安全**：Windows 扫描有界（不递归整个磁盘）
4. **配置持久化**：WebUI 配置写入 `config/settings.json`
5. **向后兼容**：现有 MCP 工具不变，新增可选参数

## 五、使用方式

### 自动检测
```bash
# 无需配置，自动扫描 Windows 常见位置
```

### 手动配置
1. 打开 WebUI: `http://127.0.0.1:4317`
2. 点击顶部"手动配置"按钮
3. 输入 Godot 可执行文件完整路径（如 `D:\Godot_v4.7.2-stable_win64_console.exe`）
4. 点击"保存"

### 环境变量
```bash
set GODOT4_BIN=D:\Godot_v4.7.2-stable_win64_console.exe
```

## 六、已知局限

1. **当前环境无 Godot**：`godot_gate` 套件显示 BLOCKED 是预期的
2. **Windows 扫描范围有限**：只检查预设位置，不在整个磁盘搜索
3. **无 GUI 支持**：仅支持 headless `--check-only` 模式
