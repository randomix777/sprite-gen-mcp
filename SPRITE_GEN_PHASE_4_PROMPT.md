# Sprite-Gen 第四轮商业化整改：阶段性执行 Prompt

你正在维护 `D:\Projects\MCP\sprite-gen`。目标不是增加更多“看起来通过”的测试，而是关闭第四轮复核确认的生产缺陷，使生成资产、存量审计、受控重生成和 Godot 导出具备默认拒绝、可观测、可回归的商业门禁。

## 总执行规则

- 先阅读 `SPRITE_GEN_OPTIMIZATION_PROMPT.md`、当前 diff 和本 Prompt，再修改代码。
- 保留用户已有改动，不执行 `git reset --hard`、`git checkout --` 或清除无关工作树。
- 每个阶段先修真实实现，再写行为测试。禁止只检查函数存在、字符串存在、配置字段存在或用可选 `if` 跳过断言。
- 测试必须执行目标路径并验证文件内容、状态、目录、哈希、请求次数和失败分支。
- `REJECTED`、`REVIEW_REQUIRED`、`BLOCKED` 不能被报告为 PASS 或以退出码 0 冒充商业就绪。
- 缺少 Godot 4 可执行文件时可以完成非 Godot 阶段，但最终商业 verdict 必须为 `BLOCKED`，并返回非零退出码。
- QC、证据、manifest、发布、Provider 预算或 Godot 检测发生异常时默认拒绝；禁止空 catch、伪造零值或固定 `passed=true`。
- 每完成一个阶段立即运行该阶段测试。当前阶段失败时停止，不要继续输出 `READY`。

## 阶段 1：修复发布一致性与 E2E 假绿

### 已确认问题

1. `generateCoverProp()` 先把 candidates 复制到 approved，随后才给 candidate manifest 写入 `approved_dir`。实际运行证明：approved manifest 与 candidate/返回 manifest 哈希不同，approved manifest 缺少 `approved_dir`。
2. `computeAssetStatus()` 只检查 `{success,status}` 和 manifest/Godot 布尔值，没有验证 QC 规则非空、测量有限、证据存在。以下空壳状态目前会错误返回 `APPROVED`：

```js
{
  intact: { success: true, status: 'APPROVED' },
  rubble: { success: true, status: 'APPROVED' }
}
```

3. `test/e2e_cover_prop.js` 仍接受 `APPROVED || REVIEW_REQUIRED`；仍使用错误路径 `candidates/<basename(e2eDir)>/manifest.json`；仍用 `if (existsSync(...))` 跳过 manifest 断言。
4. `rmSyncRecursive()` 在 ESM 中混用异步 `import().then()` 与不可用的 `require()`，发布替换和回滚存在删除竞态。

### 必须实现

- 在发布前完成最终 manifest：写入最终 `qc_status`、包内相对状态路径、Godot 路径、证据索引、文件哈希和最终 approved 目标信息。
- 将完整包写入同文件系统 staging，重新读取并校验 manifest、资源和哈希，然后执行一次原子 rename。
- 发布后读取 `approved/manifest.json`，确认它与返回 manifest 语义一致；不得再只修改 candidates 内副本。
- `replace=false` 时目标存在必须保持旧目录逐文件哈希不变并返回发布冲突。
- `replace=true` 时同步创建备份、验证备份、原子替换；失败时同步回滚。删除和回滚全部使用顶层静态 `fs` 导入的同步 API或完整 await 的异步 API，禁止 fire-and-forget。
- 聚合器显式验证每个必需状态：
  - `success === true`；
  - 状态属于三态枚举；
  - file QC 成功且 rules 为非空数组；
  - 所有适用规则结构完整；
  - 所有数值测量为有限数；
  - 必需 evidence 路径为字符串、存在且可解码；
  - 变体具有成功的一致性结果；
  - manifest 和请求的 Godot 门禁有效。
- 修复 E2E：直接使用 `result.data.session_id`、`manifest_path`、`candidates_dir`、`approved_dir`，所有必需文件无条件断言存在并读取。
- 商业成功 E2E 严格要求 `qc_status === APPROVED`；另设独立 REVIEW 用例并断言 approved 完全不存在。

### 必测场景

- 成功发布后 candidate、approved、返回对象中的 manifest 关键字段一致，approved manifest 哈希与最终 staging manifest 相同。
- 空 rules、空 evidence、缺失 evidence、NaN、Infinity、未知状态、缺失一致性结果分别阻止批准。
- `replace=false` 冲突不改变旧目录；`replace=true` 成功；替换中途失败完整回滚。
- E2E manifest 路径故意改错时测试必须失败，不能零断言通过。

### 阶段退出命令

```powershell
npm run test:cover_prop
npm run test:e2e
git diff --check
```

阶段报告必须附 approved/candidate manifest 的路径、哈希和字段对比。未一致则阶段失败。

## 阶段 2：修复重生成预算、发布结果与审计汇总

### 已确认问题

1. `max_provider_requests` 只在处理每个资产前检查；单个资产重试可以突破全局预算。
2. `regenerateSingleAsset()` 调用 `publishToApproved()` 后只等待异常，没有检查返回的 error envelope；发布失败仍可能返回 `APPROVED` 和虚假 `approved_dir`。
3. audit 先统计单图状态，一致性检查把 rubble 改为 REJECTED 后只增加 rejected，没有减少原 approved/review，汇总可能超过扫描总数。
4. `manifest_path`、`reference_root`、`godot_project_path`、`style_profile` 等参数目前主要被记录，没有完整驱动对应验证。

### 必须实现

- 建立共享 Provider 预算对象或请求计数器；在每一次真实 Provider 调用前原子检查剩余额度。包括同资产重试、不同资产和错误重试。
- 当剩余额度为 0 时不得调用 generator；保存 `BUDGET_EXHAUSTED`，原资产和引用保持不变。
- 检查 `publishToApproved()` 的返回协议。返回 error 时最终状态不得为 APPROVED，`approved_dir` 必须为空且报告真实错误。
- `approve_after_gate=true` 仍必须运行完整资产套件门禁，而不是仅用单 PNG QC 直接发布。
- 对审计结果先完成所有单图与状态一致性检查，再从最终资产记录重新计算 summary；保证：

```text
approved + review_required + rejected + unknown == total_scanned
```

- `manifest_path` 必须实际读取、验证并提供画布、ground anchor、状态关系和 Godot 元数据。
- `reference_root` 必须真实影响 intact 查找；找不到必需参考时进入 REVIEW_REQUIRED，不能猜测通过。
- `godot_project_path` 必须触发只读资源引用与场景检查；未执行时不得在报告中声称已验证。
- `style_profile` 要么完整加载并影响阈值/画布/锚点，要么拒绝未知或未实现配置；不能只回显字符串。
- audit 前后比较路径、大小、mtime 和 SHA-256；任一变化使审计失败。

### 必测场景

- `max_provider_requests=1`、单资产 `max_attempts=3` 时 generator 实际只调用一次。
- 两个资产共享预算时总请求数永不超过上限。
- approved 目标冲突且 `replace=false` 时重生成结果不得 APPROVED。
- grouped intact/rubble 一致性失败后 summary 总数仍守恒。
- manifest 参数改变 ground anchor 判定；reference_root 改变参考选择；Godot 参数触发真实检查。
- 未知 style profile、损坏 manifest、缺失参考、Godot 引用缺失都有明确三态和证据。

### 阶段退出命令

```powershell
npm run test:audit
npm run test:regenerate
npm run test:failure_injection
git diff --check
```

阶段报告必须给出预算测试的真实 generator 调用次数，以及审计 summary 守恒等式。

## 阶段 3：建立真实有效的 Godot 4 门禁

### 已确认问题

1. 项目使用 ESM，但 `findGodotExecutable()` 和 `extractBodyFromMask()` 使用 `require()`。PATH 中的 Godot检测会静默失败，QC 主体复用也会异常后退回固定 bbox。
2. 当前命令使用：

```text
godot --headless --path <project> --check-only <scene>
```

`--check-only` 是脚本解析参数，不能证明 `.tscn` 已导入并加载。
3. “自包含”场景没有脚本，却向 Node2D、StaticBody2D、Area2D 写入 `prop_id`、`material_type`、`cover_height_value`、`generated` 等自定义属性。
4. 碰撞位置计算把 StaticBody 放在主体中心后，又把 CollisionShape 偏移负半宽高，形状中心不再与主体 bbox 对齐。
5. PeekPoint 使用 bbox 左右再额外扩展 32 像素，未 clamp，容易越出画布。
6. 当前 Godot 测试硬断言 `findGodotExecutable() === null`：无 Godot 时商业套件跳过；安装 Godot 后测试反而失败。

### 必须实现

- 只使用 ESM 顶层导入：`spawn`/`spawnSync`、`existsSync`、`realpathSync` 等。禁止在该项目中使用 `require()`。
- Godot 查找顺序：显式 `GODOT4_BIN` → PATH 命令解析 →已知安装路径。对候选运行 `--version`，确认主版本为 4。
- 从 `qc.js` 正常导出并 ESM import 主体提取函数；Godot 几何必须使用 QC 的最大连通主体 bbox，提取失败直接阻止导出，不能用固定比例冒充成功。
- 选择一个有效契约：
  - 自包含场景：只写 Godot 内置属性，业务元数据放入 node metadata（如 `metadata/prop_id`）或 manifest；不得写未知节点属性。
  - 脚本场景：生成/验证 GDScript，并用 `@export` 明确声明每个自定义属性。
- CollisionShape2D 中心必须与主体 bbox 对齐，形状不得超出主体 bbox 或画布，不得明显覆盖透明区域。
- CoverZone、PeekPoint、VaultPoint、DebrisOrigin 全部 clamp 到画布；输出计算前后坐标和规则。
- 使用两步 Godot 验证：
  1. `godot --headless --path <project> --import` 完成资源导入；
  2. 使用 `--scene <res://scene.tscn>` 或专用验证脚本加载 PackedScene、instantiate、遍历节点与资源，然后退出。
- 设置明确超时并终止卡死进程；记录版本、命令、退出码、stdout/stderr 和加载证据。
- 缺少 Godot 时返回 BLOCKED；Godot 存在但导入/加载失败时返回 REJECTED。二者都不得发布 approved。

### 必测场景

- PATH 可执行文件、`GODOT4_BIN` 和无效二进制检测。
- 实际 Godot 4 导入并加载有效场景。
- 缺失纹理、非法自定义属性、无效 subresource、重复 ID、越界 Marker、空碰撞分别加载失败或门禁拒绝。
- 主体 bbox 已知的合成 PNG，断言碰撞中心、尺寸和 anchor 精确值。
- 有 Godot 的机器不得执行“Godot 必须不存在”断言；无 Godot 的机器必须得到 BLOCKED。

### 阶段退出命令

```powershell
$env:GODOT4_BIN = '<Godot 4 console executable>'
npm run test:godot_gate
npm run test:cover_prop
git diff --check
```

没有真实 Godot 4 输出时，本阶段只能报告 BLOCKED，不能报告完成。

## 阶段 4：修复商业测试编排的假成功

### 已确认问题

1. `godot_gate` 被标记为 `critical:false`。
2. Godot BLOCKED 时控制台输出 BLOCKED，但 `test:commercial` 仍退出 0，CI 会视为成功。
3. 商业编排仍只依据子进程退出码，没有解析断言数、failed、skipped 和耗时。
4. `artifact_cleanup_test` 会先删除前序套件泄漏再宣布通过，掩盖各测试没有自行清理的问题。

### 必须实现

- `godot_gate` 是商业发布 critical suite。缺失 Godot 时整体 verdict 为 BLOCKED 且退出非零；建议约定：测试失败退出 1，外部阻塞退出 2。
- 每个 suite 输出一行稳定 JSON，例如：

```json
{"suite":"audit","assertions":16,"passed":16,"failed":0,"skipped":0,"duration_ms":123,"status":"PASS"}
```

- 编排器解析 JSON；缺字段、断言数为 0、critical skipped、status 与退出码冲突、输出无法解析均判失败。
- 报告每套件 assertions/passed/failed/skipped/duration/exit_code，不再只显示 PASS。
- 每个测试套件在 `finally` 中清理自己的唯一临时目录。
- cleanup suite 在运行前只检测泄漏并失败，不得先删除再通过；可以在记录失败后清理，避免污染后续运行，但退出码必须保持非零。
- 测试临时根使用唯一 session 或系统 temp，避免并行套件互删。
- commercial 完成后检查 `test/tmp_*`、根目录临时脚本和意外 output 产物；存在即失败。
- `READY` 只允许在所有 critical suite 实际 PASS、Godot 实际加载、零 skip、零泄漏时输出。

### 必测场景

- 模拟 suite 输出零断言、非法 JSON、skip、退出码冲突，编排器全部拒绝。
- 模拟 Godot 缺失，断言商业命令退出非零且 verdict 为 BLOCKED。
- 人工留下 `test/tmp_leak`，cleanup suite 必须非零，而不是删除后 PASS。
- 安装 Godot 后 godot_gate 实际执行且计入断言统计。

### 阶段退出命令

```powershell
npm run test:artifact_cleanup
npm run test:commercial
git diff --check
git status --short
```

## 阶段 5：最终商业验收

按顺序运行：

```powershell
npm test
npm run test:contract
npm run test:security
npm run test:qc
npm run test:cover_prop
npm run test:e2e
npm run test:audit
npm run test:regenerate
npm run test:failure_injection
npm run test:godot_gate
npm run test:artifact_cleanup
npm run test:commercial
git diff --check
git status --short
```

### 最终通过条件

- approved manifest、返回 manifest、资源包内容一致且可复验。
- 聚合器不能批准缺 rules、缺 evidence、非有限测量或缺一致性结果的状态。
- Provider 总调用数永不超过预算。
- 审计 summary 守恒，输入文件前后哈希/大小/mtime 不变。
- 重生成发布失败不能返回 APPROVED。
- Godot 4 实际导入并加载场景，纹理、节点、碰撞和 Marker 全部有效。
- 所有 critical suite 有非零断言、零失败、零 skip。
- 商业命令无 BLOCKED/REVIEW，退出码 0。
- 仓库没有 `test/tmp_*` 或其他测试产物。

### 最终报告格式

先输出唯一 verdict：`READY`、`BLOCKED` 或 `NOT READY`。随后报告：

1. 每阶段修改文件和修复根因；
2. 每个 suite 的 assertions/passed/failed/skipped/duration/exit_code；
3. approved/candidate manifest 哈希对比；
4. Provider 预算实测调用次数；
5. audit 前后输入哈希和 summary 守恒结果；
6. Godot 版本、实际命令、导入/加载退出码；
7. 已知外部供应商限制；
8. 临时产物检查结果。

任何一项缺少真实证据时，不得输出 `READY`。
