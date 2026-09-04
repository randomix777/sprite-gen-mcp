# 多视角流水线升级 — 完成报告

## 一、修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/workflow_state.js` | 新建 | 多视角流水线状态机核心（1604行），包含完整的阶段转换、视角管理、状态变体、QC、发布逻辑 |
| `lib/cover_prop_phased.js` | 重写 | v2 多视角流水线服务层，支持新的阶段枚举和批量操作 |
| `lib/services_phased.js` | 新建 | 导出所有新服务函数供 server.js 使用 |
| `web/server.js` | 重写 | Web UI 服务器，新增 /api/views/batch、/api/views/{id}/regenerate、/api/states/generate、/api/publish 等端点 |
| `web/public/app.js` | 重写 | 前端应用，支持8个阶段的完整UI交互 |
| `web/public/index.html` | 重写 | 更新页面结构，加入多阶段指示器 |
| `test/phased_workflow_v2_test.js` | 新建 | 15项强制测试用例 |
| `server.js` | 修改 | 新增 MCP 工具注册（sprite_generate_views, sprite_regenerate_view 等） |

## 二、新状态机结构

```
brief → concept → view_select → view_generate → view_review → state_generate → qc → publish
   ↓        ↓          ↓              ↓              ↓              ↓          ↓       ↓
  APPROVED PENDING_REVIEW PENDING    PENDING_REVIEW APPROVED   PENDING    APPROVED  APPROVED
```

各阶段状态：
- **brief**: 需求确认，直接批准
- **concept**: 概念设计，支持文生图/图生图/重新文生图
- **view_select**: 视角选择，用户勾选所需视角
- **view_generate**: 批量视角生成，每个视角独立请求
- **view_review**: 视角审核，批准/拒绝/重生成
- **state_generate**: 状态变体生成（intact/damaged/rubble）
- **qc**: 质量检查，保留 QC 证据图
- **publish**: 最终发布，校验所有必需节点已批准

## 三、WebUI 新流程

1. **概念设计页面**：显示当前概念图、版本历史、用户反馈输入、批准按钮
2. **概念版本历史**：对比显示所有修订版本，带时间戳和反馈记录
3. **概念修改（图生图）**：传入当前图片作为 reference，结合用户反馈重新生成
4. **放弃设计重新文生图**：清除参考，纯文生图重新开始
5. **视角选择页面**：7种预设视角（end_profile, long_elevation, front, rear, top_down, three_quarter, isometric）
6. **批量视角生成进度**：实时进度条、每个视角的状态卡片
7. **多视角并排审核**：网格布局展示所有视角，支持批准/拒绝/重生成
8. **单视角拒绝和重生成**：独立的视角操作按钮
9. **状态变体矩阵**：按视角×状态展示的矩阵布局
10. **QC 证据查看**：显示所有 QC 检测结果
11. **最终发布确认**：显示已批准的资产列表，确认后发布

## 四、Prompt 设计

概念修改 Prompt 必须包含：
- 当前图片是权威身份参考
- 原始设计需求
- 必须保持的身份、结构、材质、配色、比例和风格
- 用户本次修改是唯一允许变化的部分
- 禁止修改无关细节
- 禁止场景背景、文字、水印、多个物体和多视角联系表

## 五、Workflow 数据迁移方式

- 旧 workflow_version: 2 的数据保持只读兼容
- 新数据使用 workflow_version: 3
- 加载旧数据时执行安全迁移或只读兼容
- 旧的一键工具（sprite_generate_cover_prop_phase1）仍然可用，不会绕过人工批准流程

## 六、测试结果

| 测试套件 | 结果 |
|---------|------|
| npm test | ✓ 86 passed, 0 failed |
| npm run test:phased | ✓ 16 passed, 0 failed |
| npm run test:phased:v2 | ✓ 47 passed, 0 failed |
| npm run test:contract | ✓ 73 passed, 0 failed |
| npm run test:security | ✓ 111 passed, 0 failed |
| npm run test:mcp | ✓ 8 passed, 0 failed |
| git diff --check | ✓ 无错误 |

## 七、尚未实现或仍需人工确认的部分

1. **真实 API 调用**：当前是模拟生成，需要接入真实的 Agnes API
2. **图像处理**：抠图、色键、Alpha 检查等 QC 步骤需要接入真实的 Sharp 处理
3. **Godot 集成**：发布后需要自动导入 Godot 项目
4. **后台任务持久化**：页面刷新后恢复任务的功能已实现，但需要验证在长时间运行场景下的稳定性
5. **端口冲突处理**：WebUI 端口自动切换功能已实现，需在实际环境中测试

## 八、本地 WebUI 地址

```
http://127.0.0.1:4317
```

（端口可能因占用而自动递增，具体地址写入 output/review-ui.json）
