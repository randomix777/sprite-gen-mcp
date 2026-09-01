# SPRITE-GEN 生产级优化任务

请在当前仓库 `D:\Projects\MCP\sprite-gen` 中直接完成以下优化。目标不是增加更多表面功能，而是把现有 MCP 从“能生成图片的工具”升级为可稳定生产 Godot 游戏资产的管线，重点服务 `D:\Projects\CodeChronoBullet` 的独立家具、智能掩体和可破坏环境系统。

## 工作原则

- 先检查当前工作树和现有实现，保留用户已有修改，不覆盖或回退无关变更。
- 修复根因，不通过修改测试来掩盖问题。
- 保持现有 MCP 工具向后兼容；必须修改返回结构时，在服务边界提供兼容层。
- 所有新路径、供应商请求、图片处理和 Godot 文件写入继续遵守现有安全限制。
- 不使用伪实现。参考图、批量生成、质量检测和 Godot 导出必须通过真实数据路径验证。
- 每完成一个阶段运行相关测试；最终运行完整测试并报告结果。

## 当前验收结论与本轮强制整改范围

上一轮提交虽然报告 `test:commercial` 通过并宣称 `READY`，但静态审计和实际测试表明严格资产门禁尚未闭环。本轮不要重新评估这些问题是否存在，直接把下列问题视为已确认缺陷并逐项修复。任何一项未完成，最终结论必须是 `BLOCKED`，不得输出 `READY`。

### 2026-08-31 最新复核基线：BLOCKED

本节是后续实现与验收的当前基线；与文档中更早的通过记录或完成声明冲突时，以本节和实际重新执行的测试结果为准。

已实际执行：

```powershell
npm run test:all
npm run test:commercial
node test/e2e_cover_prop.js
```

当前结果：

- `test:all` 退出码为 `0`；核心单元、契约、直接调用、MCP 握手、Provider mock、视频、安全和 Sharp 并发套件均通过。
- `test:commercial` 退出码为 `1`，19 个套件中 17 个 `PASS`、1 个关键套件 `FAIL`、1 个套件 `BLOCKED`，最终 verdict 为 `BLOCKED`。
- `e2e` 为 `14 passed / 6 failed / 20 total`。CoverProp 的 `intact` 成功，但 `rubble` 失败，最终状态为 `REJECTED`；失败返回缺少 `manifest_path` 和 `candidates_dir`，测试继续对 `undefined` 调用 `existsSync/readFileSync` 并崩溃。
- `godot_gate` 因当前机器未找到 Godot 4 可执行文件而 `BLOCKED`，尚无真实 Godot headless 导入和场景加载通过证据。
- 安全矩阵明确报告 `gifPreviewService` 未验证 `output_path`。不得因为该矩阵当前将用例计为通过而忽略此漏洞。
- E2E 执行后遗留 `test/tmp_e2e/`；商业验收要求的零临时产物泄漏尚未满足。

下一轮必须先关闭以下阻塞项：

1. 定位并修复 mock Agnes CoverProp 流程中 `rubble` 被拒绝的根因；不得放宽硬门禁或把预期改成 `REJECTED` 来制造绿测。
2. 统一 CoverProp 成功、拒绝、审查和异常返回结构。失败结果也必须提供可用的状态目录与诊断/manifest 路径，或者提供明确的可空契约；调用方和测试不得对缺失路径继续执行文件 API。
3. E2E 必须逐阶段断言并安全终止后续依赖断言，既保留首个真实失败原因，也不能因测试代码的二次异常掩盖生产缺陷。
4. 为 `gifPreviewService.output_path` 接入与其他写服务相同的路径穿越、绝对路径、UNC、覆盖、输入输出同路径及目标类型校验，并增加行为测试。
5. 所有测试临时目录使用唯一隔离目录并在成功、失败和异常路径中清理；`artifact_cleanup` 必须能检测到 E2E 遗漏，而不是在检查前替被测套件删除证据。
6. 在安装 Godot 4 的环境实际运行 headless import/load 门禁；缺少 Godot 时最终状态保持 `BLOCKED`，不得降级为 `PASS` 或 `READY`。

修复后最低复核命令为：

```powershell
node test/e2e_cover_prop.js
npm run test:security
npm run test:artifact_cleanup
npm run test:godot_gate
npm run test:all
npm run test:commercial
git status --short
```

只有 `test:commercial` 的全部 critical suite 实际通过、Godot 4 门禁有真实执行证据、断言无 skip、且复核后没有测试泄漏产物时，才允许输出 `READY`。

### A. 修复会造成误批准的 CoverProp 发布链路

当前 `lib/cover_prop.js` 只把 intact 的规则写入 `results.qc_rules`，rubble 失败仅设置 `stateData.rejected`，最终却只用 intact 规则计算 `allPassed`。这会导致必需状态失败后整套资产仍返回 `APPROVED`。

必须改为：

- 为每个请求状态保存独立的 `generation_result`、`file_qc`、`state_consistency_qc`、`evidence` 和最终状态。
- `intact` 文件门禁失败立即终止；任何必需变体生成失败、文件门禁失败或一致性门禁失败，整套资产必须 `REJECTED`。
- 任一状态为 `REVIEW_REQUIRED`，整套资产只能为 `REVIEW_REQUIRED`。
- 最终状态由一个唯一、默认拒绝的聚合函数计算，不能依赖可遗漏的数组或空数组 `every()`。
- 聚合器必须显式验证：请求状态全部存在、所有结果对象成功、规则数组非空、所有测量值有限、证据文件存在、manifest 校验通过、Godot 门禁通过（如请求导出）。
- 不允许返回体显示 `APPROVED`，而 manifest 内仍保存旧的 `REJECTED`；manifest 必须在最终判定后构建或原子更新，并再次校验。

增加至少以下回归测试：

1. intact 通过、rubble 文件 QC 失败 → 整套 `REJECTED`。
2. intact 通过、rubble 一致性失败 → 整套 `REJECTED`。
3. 任一状态 `REVIEW_REQUIRED` → 不得返回或写入 `APPROVED`。
4. 变体缺失、Provider 返回空图片、QC 返回 error、规则数组为空、测量值为 `NaN` → 整套 `REJECTED`。
5. 返回状态、manifest 状态、目录位置三者必须一致。

### B. 修复状态一致性门禁本身

当前 `lib/qc.js` 中 `computeBodyBboxFromPath()` 是异步函数，但调用处没有 `await`；`qcStateConsistency()` 调用 `addRule()` 时没有传入 evidence 对象，也会触发异常。该门禁目前没有真正接入 CoverProp 主流程。

必须改为：

- 正确等待两张图片的解码、mask 和 bbox 计算。
- `addRule` 不得依赖隐式可空参数；evidence 缺失属于编程错误并应在顶层变成 `REJECTED`，不能吞掉。
- 使用真实 alpha mask 计算轮廓 IoU，不能用两个 bounding box 的重叠面积冒充 silhouette IoU。
- `rubble` 使用独立规则，不强制 `0.55` IoU；但必须检测接地点、材料色板、碎片空间范围和风格置信度。
- 将状态一致性结果真实接入最终聚合器。
- 增加正常、中心漂移、接地点漂移、镜像、缩放突变、画布不同、色板漂移和损坏图片测试；断言具体测量值和规则 ID。

### C. 严格隔离 candidates、review、rejected、approved

当前流程开始时就创建 `approved/<prop_id>`，并在最终判定前把 Godot 场景写入其中。这属于正式目录污染。

必须改为：

- 流程开始时只允许创建本次 session 的 candidates 临时目录。
- `REJECTED` 和 `REVIEW_REQUIRED` 的归档只在判定后写入对应版本目录。
- 在所有图片、manifest、证据和 Godot 门禁完成之前，禁止创建或写入 approved 目标目录。
- 发布使用同一文件系统内的临时目录加原子 rename；发布前再次检查目标不存在。
- 默认禁止覆盖。若显式 `replace=true`，先创建可恢复的版本备份，再原子替换；任何中途失败必须保持旧版本完整。
- Godot 验证场景先写 candidates 验证目录；验证通过后才随整套资产发布。
- 测试必须在每一种失败和异常注入场景后断言 approved 路径完全不存在，而不只是断言没有 PNG。

### D. 重新实现缺失的 QC 规则，而不是仅修改名称

当前主体检测只是扫描全部 `alpha > 32` 像素形成一个整体 bbox；没有最大连通区域、孤立噪点、RGB 泄漏、白边、彩色光晕或锯齿检测。棋盘格检测只检查第 1 行的相邻像素，无法可靠发现常见大格棋盘。声明的文件大小、最大尺寸和期望画布也没有全部执行。

必须实现并验证：

- 从实际 `info.channels` 派生像素步长；RGB、RGBA、灰度和灰度 alpha 要么正确处理，要么明确拒绝。
- 校验真实 PNG 格式、完整解码、文件字节数、宽高、总像素数、期望画布，且所有失败都影响硬门禁状态。
- 二值 alpha mask、最大连通区域、次要区域面积、孤立噪点比例和真实主体 bbox。
- 二维、多尺度周期检测；至少能识别 1、2、4、8、16、32、64 像素格的灰白/彩色棋盘，不能只采样一行。
- 基于透明边缘邻域的 RGB 泄漏、白色毛边和彩色色溢检测，并输出污染热图。
- 对反锯齿边缘计算合理的半透明带统计；检测无法计算时拒绝，不能用零值代替。
- 文件大小上限、最大尺寸、`canvas_width/canvas_height` 必须真正进入规则和最终判定。
- 每一个阈值都必须有边界测试：阈值以下、刚好等于阈值、阈值以上。

### E. 修复证据生成的异步和失败处理

当前 `generateEvidenceImage()` 返回 Promise，但调用处没有 `await`，异常还被静默吞掉。这可能让 `evidence_path` 变成 Promise/空对象，并在证据尚未落盘时提前返回。

必须改为：

- `await` 所有证据生成任务，并在返回前验证文件存在、可解码、尺寸正确。
- 每条适用规则关联明确证据路径；至少生成 mask、bbox、边距、污染热图和多背景预览。
- 禁止空 `catch`。证据生成失败在严格模式下必须令资产 `REJECTED`，同时返回安全、可诊断的错误信息。
- JSON 序列化测试必须证明 `evidence_path` 是字符串，不是 Promise、`{}`、`null` 或不存在的路径。

### F. Godot 门禁必须执行真实 Godot，而不是只写文本

当前生成场景存在以下已确认风险：纹理使用 `res://<basename>` 但没有复制到对应位置；固定脚本 `res://scripts/cover_prop.gd` 未保证存在；`CoverZone` 写入可能没有脚本声明的自定义属性；碰撞框使用固定画布比例而非主体 bbox；`godot_project_path` 没有形成完整验证闭环。

必须改为：

- 明确选择“生成自包含场景”或“依赖项目脚本场景”。若依赖脚本，先验证脚本存在且属性契约匹配；否则不要引用不存在的脚本或写入未知属性。
- 把纹理复制到 candidates 中的 Godot 验证项目内，使用真实、可解析的 `res://` 相对路径。
- 正确计算 `load_steps`、ext_resource/sub_resource、节点属性和资源引用。
- 碰撞、CoverZone 和 Marker 坐标必须从 QC 的主体 bbox 与 ground anchor 推导，并验证透明覆盖比例。
- 若系统可找到 Godot 4 可执行文件，必须运行 headless import/load 验证并以非零退出码判失败。
- 若请求 `godot_project_path` 但环境无法运行 Godot，严格模式下不得自动 `APPROVED`，应为 `REVIEW_REQUIRED` 或明确的外部验证阻塞；测试不得伪造 Godot 已加载。
- 增加含空格路径、缺失纹理、缺失脚本、非法属性、越界 Marker、空碰撞和有效场景夹具。

### G. 补全资产审计和受控重生成，不得把基础扫描器包装成完成品

当前 `sprite_audit_assets` 只遍历图片并运行单图 `qcGate`；`asset_type`、`strict`、`report_dir` 没有真正生效，也没有状态分组、Godot 引用、证据报告、哈希保护或重生成清单。

必须完整实现本文后续“存量美术资产审计与受控重生成”章节，并特别保证：

- 输入根目录先经过路径安全验证；限制递归深度、文件数、总大小并防止 symlink/junction 逃逸。
- `strict`、`asset_type`、`report_dir`、include/exclude、manifest 和 Godot 参数真实生效。
- 审计前后记录输入文件路径、大小、mtime 和 SHA-256，证明只读。
- 输出 JSON、Markdown、CSV 和证据，不得只返回内存计数。
- 新增并注册独立的 `sprite_regenerate_rejected_assets`；不得由 audit 隐式生成。

### H. 修复结果协议遗漏并强化测试可信度

当前 `lib/background_gen.js` 仍在多个路径先检查 `gen.images`，会把统一结构 `result.data.images` 的成功结果误判失败。必须全仓搜索所有旧式直接读取并统一改用唯一解包函数。

测试禁止以下“存在性冒充行为验证”的写法：

- 仅断言函数 `typeof === 'function'` 就声称参考图已传入。
- 仅断言 capability 配置字段为 `true` 就声称供应商支持该能力。
- 使用 `result.success || result.data`、`result?.success || !result?.error` 等弱断言。
- mock 永远返回成功，却没有检查实际请求体、文件输出和失败分支。
- 新测试单独运行通过，但没有加入 `test:commercial`。

Agnes 参考图测试必须拦截真实 HTTP 请求构造，断言请求体确实包含可用的参考图数据、格式正确、元数据准确；不支持能力的供应商必须测试明确拒绝。CoverProp 测试必须真实写入合成 PNG、运行 QC、检查目录和 manifest，并尽可能让 Godot headless 实际加载。

### I. 商业测试与完成报告的防误报要求

- 增加 `test:qc` 和 `test:regression` npm scripts，并把二者作为 `test:commercial` 的 critical suite。
- `test:commercial` 必须至少包含 QC 夹具、CoverProp 端到端、状态一致性、资产审计、受控重生成和 Godot 门禁。
- critical suite 出现 skip、未安装必需本地依赖、证据缺失或测试数为零时必须返回非零退出码；真实供应商 API 测试可以明确标为 external，但不能替代本地 mock 请求契约测试。
- 最终报告必须列出每个 suite 的测试数量、失败数、跳过数、耗时和退出码，不得只写总计数字。
- 最终报告必须提供至少一个合格资产和每类不合格夹具的规则 ID、实测值、输出目录及证据路径。
- 最终报告必须附上一次“rubble 失败阻止整套发布”和一次“Godot 加载失败阻止发布”的实际测试输出摘要。
- README 必须记录两个生成/审计工具、重生成工具、三态语义、目录生命周期、供应商能力限制和 Godot 外部依赖。
- 所有已确认问题修复并完成上述证据前，最终报告标题和 verdict 必须使用 `BLOCKED` 或 `NOT READY`。

## 第二次验收新增阻塞项（必须在上一轮整改基础上继续修复）

第二次实际验收中，`npm run test:qc`、`npm run test:regression` 和 `npm run test:commercial` 虽然全部返回成功，但仍发现以下确定性缺陷。这证明当前测试存在“代码没有真正执行、仅检查符号存在、错误测量始终为零仍通过”的假绿问题。本轮必须修复实现与测试，不能只调整报告文字或增加相同类型的浅层断言。

### J. 修复 alpha 数据布局与连通区域恒为零

当前 `lib/qc.js` 已把 RGBA alpha 提取为长度 `w*h` 的单通道数组，但 `computeConnectedComponents()` 仍判断：

```js
alphaData.length < w * h * 4
```

这会让所有正常图片直接返回 `{mainArea:0, noiseArea:0, noiseRatio:0}`，导致孤立噪点永远放行。

要求：

- 在 QC 内定义唯一、明确的像素数据结构：原始交错 buffer、channels、单通道 alpha mask，不得让不同 helper 猜测布局。
- `computeConnectedComponents(alphaMask,w,h)` 必须严格要求 `alphaMask.length === w*h`；不匹配时抛出可诊断错误并令 QC `REJECTED`。
- 主体 bbox 必须来自最大连通区域，而不是把所有 alpha 噪点合并进整体 bbox。
- 返回每个连通区域的面积、bbox、是否为允许独立部件，并生成组件标色证据图。
- BFS/队列不得使用会在百万像素图上产生明显退化的反复 `Array.shift()`；使用索引队列、typed array 或等价线性实现。
- 测试必须创建“一个合格主体 + 若干真实孤立小点”，断言 `main_area`、`noise_area`、`noise_ratio` 的具体值，并分别覆盖阈值下、等于阈值、阈值上。
- 禁止只断言 `CONNECTED_COMPONENTS` 规则存在。

### K. 修复 CoverProp 成功路径的确定性崩溃

当前 `lib/cover_prop.js` 把 `manifestValidCheck` 声明为 `const`，随后又重新赋值。真实流程走到 manifest 阶段会抛出 `TypeError: Assignment to constant variable`，但现有测试没有调用主流程，因此未发现。

要求：

- 删除无意义的预设 `{valid:true}`，构建 manifest 后直接使用真实 `validateCoverPropManifest()` 结果。
- 最终聚合必须在 manifest 验证和可选 Godot 验证之后执行，不能先用硬编码 `true` 算 finalStatus。
- manifest 中的 `qc_status` 必须来自最终聚合结果，不允许默认值、旧值或构建时尚未确定的值。
- 捕获主流水线最外层异常，清理未完成的 staging，返回统一错误；不得让 MCP 进程崩溃。
- 新增真正的端到端测试：mock `generateImage()` 返回合成 PNG，随后真实调用 `generateCoverProp()`，运行 intact QC、rubble QC、一致性、manifest 和发布逻辑。
- 端到端测试必须覆盖成功、intact 拒绝、rubble 拒绝、一致性拒绝、manifest 无效、Godot 失败、Provider 空结果和异常抛出。

### L. 证据生成失败必须可观测且默认拒绝

当前 `generateEvidenceImage()` 尾部仍有 `.catch(() => null)`，它会在错误到达 `qcGate` 外层前吞掉异常。因此外层所谓“证据失败硬拒绝”不会生效。

要求：

- 删除所有空 catch、`.catch(() => null)` 和把异常转换为正常空值的路径。
- 证据 helper 失败时保留安全错误码、阶段和原因，由 qcGate 添加失败规则并将状态设为 `REJECTED`。
- 严格模式下，只要某条适用规则缺少证据文件、文件不存在、无法解码或尺寸不符，最终不得批准。
- 对证据写入注入失败（无效输出路径、Sharp mock 抛错、磁盘写入失败），断言 QC 返回 `REJECTED` 和 `EVIDENCE_GENERATION`。
- 测试必须读取证据文件并解码，不得只接受 `null || string`。
- `APPROVED` 资产也必须生成并验证规定的发布证据集；不能因为所有规则通过就完全没有证据。

### M. 补齐文件完整性门禁并让失败真正影响 verdict

当前 `FILE_DECODE` 只判断最小宽高，声明的 `maxFileSizeBytes`、`maxDimensions`、期望画布和 PNG 格式没有完整执行；该规则失败后也没有统一设置硬失败。

要求：

- 将文件规则拆成或明确输出：`FILE_FORMAT`、`FILE_SIZE`、`DIMENSIONS_RANGE`、`CANVAS_MATCH`、`TOTAL_PIXELS`、`DECODE_COMPLETE`。
- 使用真实文件 stat、Sharp metadata 和完整 decode 结果；家具门禁默认只接受 PNG。
- `canvas_width/canvas_height` 提供时必须严格匹配，除非 style profile 明确允许容差。
- 所有规则通过统一 `recordHardRule()` 或等价机制更新 verdict，避免添加了失败规则却忘记设置 `hasHardFailure`。
- 所有 measured value 必须是有限数值；undefined、null、NaN、Infinity 直接失败。
- 增加过小、刚好最小、正常、刚好最大、超最大、画布不匹配、超文件大小、损坏/截断 PNG 和伪扩展名夹具。

### N. 禁止在状态一致性规则中保留占位成功

当前实现仍包含：

```js
const rubbleGroundOk = true;
const rubblePaletteCheck = { checked: false, score: 0 }; // TODO
```

要求：

- 删除所有固定 true、checked:false 却不阻塞发布、TODO 占位测量和伪造零值。
- `qcStateConsistency` 输入必须包含或推断明确的 `variant_type`，为 non-destructive 与 rubble 使用不同策略。
- rubble 仍必须检查画布、接地点允许范围、材料主色/色板距离、碎片总体空间位置、明显镜像/视角变化和风格置信度。
- 无法计算色板或特征时至少 `REVIEW_REQUIRED`；检测异常则 `REJECTED`。
- 每个一致性规则输出 `checked:true`、真实测量、阈值和证据；不适用规则必须标为 `not_applicable` 并说明原因，不能伪装通过。

### O. 完整实现资产审计，不得保留未使用参数

当前 `sprite_audit_assets` 仍只遍历图片调用单图 QC，`asset_type`、`report_dir` 等参数没有真实作用。

要求：

- 未实现的公开参数不能留在 MCP schema 中冒充能力：要么完整实现，要么从 schema 删除并明确限制；本任务要求按前文规格完整实现。
- 对 `input_path`、`report_dir`、Godot 根目录分别执行路径安全验证，确保报告目录不在被审计输入内部造成递归扫描。
- 限制 `max_depth`、`max_files`、`max_total_bytes`，检测 symlink/junction/reparse point，禁止逃逸扫描根目录。
- 审计识别 manifest 和状态命名，将同一资产的 intact/rubble/open/empty 分组，并执行整套一致性门禁。
- 审计前后计算 SHA-256、大小和 mtime；任何输入变化令审计失败。
- 真实写入 `asset_audit.json`、`asset_audit.md`、CSV 和证据索引，并在返回 artifacts 中列出。
- 测试必须验证参数实际改变行为，不能只确认工具已注册。

### P. 修复重生成工具中的虚假参数和文件覆盖风险

当前 `lib/regenerate.js` 接收 `replace`，但没有使用；`approve_after_gate=true` 只修改返回状态，没有真正安全发布；多个资产共享 `attempt_1/` 目录，相同文件名可能互相覆盖。

要求：

- 每个资产使用稳定且安全的唯一目录，例如 `<asset_hash>/attempt_<n>/`，不得只按尝试次数分目录。
- 输出文件名碰撞必须被检测并拒绝，不能静默覆盖。
- `approve_after_gate=false` 时，即使 QC 通过也必须明确进入 review/candidates，返回状态与目录一致。
- `approve_after_gate=true` 必须复用 CoverProp 的统一发布器，且只有完整资产套件全部通过才发布。
- `replace=false` 时目标存在必须拒绝；`replace=true` 必须生成内容哈希/时间戳备份、验证备份哈希，然后原子替换。
- 若当前版本不更新 Godot 引用，就不要声称支持；若实现更新，必须备份、临时文件写入、语法验证和原子替换。
- 生成新旧 SHA-256、bbox、透明层、色板、接地点和规则差异报告。
- `max_provider_requests` 必须在每次请求前强制执行，包括重试和不同资产。
- 参数 `replace`、`approve_after_gate`、`rule_ids`、`asset_paths`、最大尝试和 dry-run 均要有行为断言。

### Q. 重写浅层测试，商业套件不得因“符号存在”而通过

以下现有测试模式必须删除或升级：

- `test/qc_test.js` 的噪点测试仅断言规则存在；必须断言真实测量和拒绝。
- `test/cover_prop_test.js` 的 Godot 测试仅断言 `typeof exportGodotCoverProp === 'function'`；必须真实导出并让 Godot headless 加载。
- `test/regression.js` 的 Agnes 测试仍只断言 `generateImage` 是函数；必须拦截并检查真实请求体。
- 直接测试 `computeAssetStatus()` 不能代替调用 `generateCoverProp()` 的端到端测试。

商业测试器还必须：

- 捕获每个 suite 的断言总数、失败数和 skip 数；无法解析结果或断言数为零时失败。
- 不允许 suite 自己 `process.exit(0)` 但没有执行目标路径。
- 对 Godot 等必需本地门禁检查可执行文件；缺失时商业 verdict 必须是 `BLOCKED`，不能继续输出 `READY`。
- 在输出 `READY` 前运行一次独立 smoke test，真实调用 CoverProp 主流程并检查最终目录、manifest 和证据。
- 将临时目录放在系统或测试专用临时根，并在成功/失败后清理；仓库不得残留 `test/tmp_*`、`test_tmp.mjs` 或生成证据。
- `git diff --check` 必须无错误；工作树中的测试产物必须为零。

第二次验收的最低复核命令至少包括：

```powershell
npm run test:qc
npm run test:cover_prop
npm run test:regression
npm run test:commercial
git diff --check
git status --short
```

最终报告除原有要求外，还必须给出：

- `generateCoverProp()` 端到端成功路径确实执行到发布的证明；
- 连通区域夹具的真实 `main_area/noise_area/noise_ratio`；
- 证据生成故障注入导致 `REJECTED` 的输出；
- audit 运行前后输入哈希完全一致的证明；
- 两个同名资产重生成不会互相覆盖的证明；
- 测试结束后仓库不存在临时测试产物的证明。

## 第三次验收新增阻塞项（14/14 PASS 仍不得判定 READY）

第三次实际复核确认 `npm run test:commercial` 返回退出码 `0` 并报告 `14/14 PASS`，但关键发布路径仍存在确定性缺陷，且多条断言没有执行目标代码。以下问题均按已确认缺陷处理；不要只更新测试文案、增加函数存在性断言或继续沿用 `READY` 报告。所有项目关闭前，商业 verdict 必须为 `BLOCKED / NOT READY`。

### R. 修复 E2E 测试中的跳过式假通过

当前 `test/e2e_cover_prop.js` 存在三处直接造成假绿的问题：

- manifest 路径使用 `path.join(e2eDir, 'candidates', path.basename(e2eDir), 'manifest.json')`，但真实 session 名为 `cover_<timestamp>`，因此该路径恒不正确；后续又用 `if (existsSync(manifestPath))` 包住全部断言，导致 manifest 验证零执行仍通过。
- 最终状态断言接受 `APPROVED || REVIEW_REQUIRED`，不能证明自动发布成功。
- 调用 `generateCoverProp()` 时没有传入 `godot_project_path`，却在文件头声称覆盖 `manifest → Godot → publish` 全链路。

必须改为：

- 直接使用 `e2eResult.data.manifest_path`、`candidates_dir`、`approved_dir` 和 `session_id`，每个路径都先强制断言为非空字符串、位于预期根目录、真实存在，再读取内容；禁止用可选 `if (existsSync(...))` 跳过必需断言。
- 商业成功 E2E 必须严格断言 `qc_status === APPROVED`；另设独立用例验证 `REVIEW_REQUIRED` 绝不发布。
- 成功用例必须传入真实临时 Godot 项目并证明 Godot 门禁被调用；Godot 缺失时该用例应明确失败或让商业套件 `BLOCKED`，不能静默降级。
- 为 E2E 增加断言计数下限，并断言 manifest 内状态、返回状态、实际目录状态三者完全一致。
- 删除随机色值对断言结果的影响；合成夹具必须确定性生成，连续运行多次结果一致。

### S. Godot 导出目前不是有效门禁

当前 `lib/cover_prop.js` 中 `godot_project_path` 仅作为未使用参数继续传递。生成场景固定引用 `res://scripts/cover_prop.gd`，仓库和测试项目中并不存在该脚本；纹理路径固定为 `res://<basename>`；`CoverZone` 还写入 `cover_height_value` 未声明属性。更严重的是，Godot 导出失败时主流程没有设置失败状态，最终聚合仍只检查图片状态和 manifest，可继续发布为 `APPROVED`。

必须改为：

- 将 Godot 验证结果作为 `computeAssetStatus()` 的显式必需输入；只要请求了 `godot_project_path`，导出失败、资源缺失、headless 导入失败或场景加载失败都必须阻止 `APPROVED`。
- `exportGodotCoverProp()` 必须真正使用并验证 `godot_project_path/project.godot`，将纹理和场景放入受控的候选验证目录，并按项目根计算 `res://` 路径。
- 第一版优先生成不依赖外部脚本的自包含有效场景；若必须使用 `cover_prop.gd`，同时生成/复制脚本并验证 `@export` 属性契约，不能引用未知脚本或未知属性。
- `load_steps` 必须等于真实外部与子资源数量要求；所有 ext_resource、sub_resource ID 必须唯一并可解析。
- Godot 门禁结果必须包含可执行文件路径、版本、命令、退出码、stdout/stderr 摘要、导入结果和加载结果，敏感路径按需脱敏。
- 本环境本次复核没有找到 Godot 可执行文件，因此当前机器不得输出“Godot 已验证”或商业 `READY`；应报告明确外部阻塞。

### T. 修复状态一致性异常分支和仍存在的固定放行

当前 `qcStateConsistency()` 在 `computePaletteDistance()` 的 `catch` 中执行 `rules.push(...)`，但 `const rules = []` 在该代码之后才声明。色板计算一旦抛错，会触发 temporal dead zone 的 `ReferenceError`，原始失败原因也会丢失。

同时，rubble 的中心偏移规则仍把 `passed` 固定传为 `true`：

```js
addRule('CENTER_OFFSET', ..., { max_ratio: ... }, true, evidence)
```

这违反默认拒绝原则和上一轮“禁止固定 true”的要求。

必须改为：

- 在任何异步测量前创建唯一规则收集器；测量异常通过统一的 `recordHardFailure()` 写入，不允许异常路径访问未初始化变量。
- rubble 中心、接地点、碎片总体范围和色板均使用真实布尔判定；接近阈值可进入 `REVIEW_REQUIRED`，超过硬阈值必须 `REJECTED`。
- 色板距离只统计主体 alpha mask 内的有效像素。当前先 `removeAlpha()` 再对整个 64×64 画布求均值会让共同透明背景稀释颜色差异，必须修复。
- 增加 palette helper 抛错、损坏变体、空 mask、完全不同颜色、中心严重漂移和正常 rubble 的故障注入测试，并断言规则 ID、原始安全错误、状态和有限测量值。

### U. 文件完整性规则仍是伪测量

当前 `qcGate()` 的文件门禁仍有以下问题：

- `FILE_FORMAT` 把测量硬编码为 `{format:'png', decoded:true}`，没有使用 Sharp metadata 的真实格式。
- `DECODE_COMPLETE` 的表达式 `rgbData.length === w*h*(rgbData.length/(w*h))` 恒等成立，最终 `passed` 又只使用 `!!rgbData`，无法证明完整解码。
- `hasAlpha = meta.channels >= 4` 以及按固定 4 通道提取 alpha，未正确处理灰度、灰度 alpha和未来其他通道布局。
- stat 失败被空 catch 转为 `fileSizeBytes=0`，没有保留可诊断原因。
- `computeBodyBbox()` 仍扫描所有 alpha 像素，主体 bbox 不是最大连通区域 bbox，孤立噪点仍可污染边距与接地点测量。

必须改为：

- 保存真实 `metadata.format/channels/hasAlpha` 和 raw `info.channels/size`；仅真实 PNG 通过 `FILE_FORMAT`。
- `DECODE_COMPLETE` 使用明确的 `expectedBytes = width*height*channels` 与真实 raw 长度比较，且任何维度、通道、长度不是有限安全整数都硬拒绝。
- 定义并测试 1、2、3、4 通道输入策略；家具资产不支持的布局明确拒绝，不得错误索引。
- stat/metadata/raw decode 任一异常均保留阶段化错误并形成失败规则。
- 连通区域计算返回最大主体 mask/bbox/centroid，后续边距、面积和 ground anchor 全部复用该主体结果。
- 增加伪 PNG 扩展名、JPEG 改名、截断 PNG、灰度 PNG、灰度 alpha、异常 raw 长度和孤立远端噪点夹具。

### V. 修复发布器的覆盖语义和 manifest 不一致

当前 `publishToApproved()` 无论调用方是否显式允许替换，只要目标存在就自动 rename 为备份，违反“正式目录默认禁止覆盖”。此外，发布时先复制 candidate manifest 到 approved，随后才只更新 candidate manifest 的 `approved_dir`，可能造成已发布 manifest 与返回对象不一致。

必须改为：

- 发布器显式接收 `replace=false`；目标存在时默认返回可诊断冲突且不改动任何文件。
- `replace=true` 才允许创建备份；验证旧目录和备份哈希后执行原子替换，并在失败时回滚。
- 在原子发布前完成 manifest 的最终字段、相对资源路径和哈希，写入 staging 后重新校验；rename 后 approved 内 manifest 必须与返回 manifest 内容一致。
- manifest 不得保存易失效的 candidates 绝对路径；正式包内引用使用包内相对路径或有效 `res://` 路径。
- 增加“目标已存在且 replace=false”“replace=true 成功”“rename 中途失败回滚”“approved manifest 与返回值逐字段一致”测试。

### W. Godot 资源测试正则实际匹配零条

当前 `test/cover_prop_test.js` 使用 `/ext_resource\s*=\s*"res:\/\/.../` 查找资源，但真实 `.tscn` 语法是：

```text
[ext_resource type="Texture2D" path="res://..." id="..."]
```

因此 `extResourceLines` 为空，循环零次，缺失纹理和缺失脚本都不会失败。

必须改为：

- 使用 Godot 解析器或严格解析 section header 的 `path` 字段，禁止以“空匹配数组循环成功”作为验证。
- 先断言 ext_resource 数量符合预期且至少包含纹理；若声明脚本则也必须存在。
- 从真实 Godot 项目根解析 `res://`，不能相对 `.tscn` 所在目录猜测。
- 添加缺失纹理、缺失脚本、错误资源 ID、重复 ID 和无 ext_resource 的负向夹具，确保每个夹具返回非零。

### X. 商业测试编排仍缺少必需套件和可信统计

当前 `test/commercial.js` 的 14 个 suite 中没有资产审计、受控重生成和 Godot headless 门禁。它只依据子进程退出码判定 PASS，不收集断言数、skip 数、耗时或目标路径覆盖证据，却仍输出 `READY`。

必须改为：

- 增加独立 critical suites：`audit`、`regenerate`、`godot_gate`、`failure_injection`、`artifact_cleanup`。
- 每个 suite 输出机器可读结果：`assertions/passed/failed/skipped/duration_ms/exit_code`；字段缺失、断言数为零、critical skip 或输出无法解析均失败。
- `provider` 套件需区分真实外部测试与 mock contract；缺 API key 可以标记 external unavailable，但不能把未执行的真实穿透写成 PASS。
- 商业编排结束后检查仓库测试产物。当前测试会留下 `test/tmp_cover_prop`、`test/tmp_e2e`、`test/tmp_qc_regression`、`test/tmp_regression`，该检查必须令套件失败。
- 只有 Godot headless 实际加载、audit/regenerate 行为测试执行、失败注入通过、临时产物清零后才允许输出 `READY`。

### Y. 第三次验收必须提供的复核证据

最低复核命令：

```powershell
npm run test:qc
npm run test:cover_prop
node test/e2e_cover_prop.js
node test/audit_test.js
node test/regenerate_test.js
node test/godot_gate_test.js
npm run test:commercial
git diff --check
git status --short
```

最终报告必须额外附上：

- E2E 实际读取的 `manifest_path`、严格 `APPROVED` 断言和 approved 内 manifest 校验摘要；
- palette 计算抛错被正确转为 `PALETTE_DISTANCE` 硬失败的输出；
- rubble 中心超阈值被拒绝的真实测量；
- 伪 PNG、截断 PNG 和异常 raw 长度分别触发的规则；
- Godot 缺失脚本/纹理导致整套资产不发布的测试输出；
- `replace=false` 保持旧 approved 完全不变的前后哈希；
- audit/regenerate/Godot/故障注入各 suite 的断言数、skip 数、耗时和退出码；
- 测试结束后 `test/tmp_*` 为零的检查结果。

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
