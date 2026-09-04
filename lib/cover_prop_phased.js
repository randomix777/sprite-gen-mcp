/**
 * 多视角 CoverProp 流水线（v2版本）
 *
 * 支持完整的多阶段工作流：
 * 需求 → 概念设计 → 概念修改 → 批准设计 → 批量多视角 → 分视角审核 → 多状态变体 → QC → 最终批准 → 发布
 */

import fs from 'fs';
import path from 'path';
import { generateImage } from './image_gen.js';
import { buildConceptPrompt, buildConceptRevisionPrompt } from './cover_prop.js';
import { qcGate } from './qc.js';
import { saveGeneratedImage } from './utils.js';
import { ASSET_TYPE_IDS, STYLE_PROFILE_IDS } from './asset_profiles.js';
import { ok, err, ErrorCode, artifact, unwrapImages } from './result.js';
import {
  STAGE_ORDER,
  VIEW_PRESETS,
  STATE_VARIANTS,
  VIEW_STATUS,
  STAGE_STATUS,
  WORKFLOW_STATUS,
  createWorkflow,
  getWorkflow,
  generateConceptImage,
  reviseConceptImage,
  restartConceptImage,
  approveConcept,
  selectViews,
  batchGenerateViews,
  generateSingleView,
  approveView,
  rejectView,
  regenerateView,
  generateStateVariants,
  batchGenerateStates,
  approveState,
  rejectState,
  performQC,
  publishWorkflow,
  listWorkflows,
  restorePendingTasks
} from './workflow_state.js';

const WORKFLOW_VERSION = 3;
const WORKFLOW_DB_PATH = 'output/workflow_db.json';
const REVIEW_QUEUE = 'output/review_queue.json';

// ─── 阶段转换工具 ───────────────────────────────────────────────────────────────

export function nextCoverPropStage(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
}

// ─── 主流程函数 ────────────────────────────────────────────────────────────────

/**
 * 创建新的 CoverProp 工作流（需求阶段）
 */
export async function createCoverPropWorkflow(args) {
  const {
    prop_id,
    prompt,
    material_type,
    cover_height = 'low',
    width = 1024,
    height = 1024,
    provider = 'agnes',
    camera_view = 'end_profile',
    asset_type = 'prop',
    style_profile = 'clean_game',
    output_dir = './output/workflows'
  } = args;

  if (!prop_id || !prompt || !material_type) {
    return err(ErrorCode.INVALID_ARGUMENT, 'prop_id, prompt and material_type are required', { stage: 'validation' });
  }

  if (!/^[A-Za-z0-9_-]+$/.test(prop_id)) {
    return err(ErrorCode.INVALID_ARGUMENT, 'prop_id may contain only letters, numbers, _ and -', { stage: 'validation' });
  }
  if (!ASSET_TYPE_IDS.includes(asset_type)) return err(ErrorCode.INVALID_ARGUMENT, `unsupported asset_type: ${asset_type}`, { stage: 'validation' });
  if (!STYLE_PROFILE_IDS.includes(style_profile)) return err(ErrorCode.INVALID_ARGUMENT, `unsupported style_profile: ${style_profile}`, { stage: 'validation' });

  // 使用新的工作流状态机创建
  const result = createWorkflow({
    prop_id,
    prompt,
    material_type,
    cover_height,
    width,
    height,
    provider,
    camera_view,
    asset_type,
    style_profile,
    output_dir
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'creation' });
  }

  // 自动生成第一版概念图
  const conceptResult = await generateConceptImage({
    workflow_id: result.data.workflow_id
  });

  if (!conceptResult.success) {
    return err(ErrorCode.PROCESSING_FAILED, conceptResult.error, { stage: 'concept_generation' });
  }

  return ok({
    ...result.data,
    ...conceptResult.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '审核概念图，确认后批准进入视角选择阶段'
  }, {
    artifacts: [
      artifact('json', path.join(result.data.workflow_dir, 'workflow.json'))
    ]
  });
}

/**
 * 生成概念图（文生图）
 */
export async function generateConcept(args) {
  const { workflow_id, prompt_override = null, signal = null } = args;

  const result = await generateConceptImage({
    workflow_id,
    prompt_override,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'generation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('image', result.data.preview_path),
      artifact('json', `${result.data.preview_path}.json`)
    ]
  });
}

/**
 * 修改概念图（图生图）
 */
export async function reviseConcept(args) {
  const { workflow_id, feedback, signal = null } = args;

  if (!feedback) {
    return err(ErrorCode.INVALID_ARGUMENT, 'feedback is required for concept revision', { stage: 'validation' });
  }

  const result = await reviseConceptImage({
    workflow_id,
    feedback,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'revision' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('image', result.data.preview_path),
      artifact('json', `${result.data.preview_path}.json`)
    ]
  });
}

/**
 * 重新开始概念图（纯文生图）
 */
export async function restartConcept(args) {
  const { workflow_id, signal = null } = args;

  const result = await restartConceptImage({
    workflow_id,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'restart' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('image', result.data.preview_path)
    ]
  });
}

/**
 * 批准概念图
 */
export function approveConceptStage(args) {
  const { workflow_id, note = '' } = args;

  const result = approveConcept({
    workflow_id,
    note
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'approval' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '进入视角选择阶段，选择需要的生产视角'
  });
}

/**
 * 选择视角
 */
export function selectViewsStage(args) {
  const { workflow_id, selected_views } = args;

  const result = selectViews({
    workflow_id,
    selected_views
  });

  if (!result.success) {
    return err(ErrorCode.INVALID_ARGUMENT, result.error, { stage: 'view_selection' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '开始批量生成视角图片'
  });
}

/**
 * 批量生成视角
 */
export async function generateViewsBatch(args) {
  const { workflow_id, signal = null } = args;

  const result = await batchGenerateViews({
    workflow_id,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'batch_generation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '审核各个视角图片，确认后批准'
  }, {
    artifacts: result.data.batch_results.map(r =>
      artifact('image', r.image_path)
    )
  });
}

/**
 * 单独生成某个视角
 */
export async function generateSingleViewStage(args) {
  const { workflow_id, view, signal = null } = args;

  if (!view || !VIEW_PRESETS[view]) {
    return err(ErrorCode.INVALID_ARGUMENT, `Invalid view preset: ${view}`, { stage: 'validation' });
  }

  const result = await generateSingleView({
    workflow_id,
    view,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'generation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('image', result.data.image_path)
    ]
  });
}

/**
 * 批准某个视角
 */
export function approveViewStage(args) {
  const { workflow_id, view, note = '' } = args;

  const result = approveView({
    workflow_id,
    view,
    note
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'approval' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: result.data.all_views_approved
      ? '进入状态变体生成阶段'
      : '继续审核其他视角'
  });
}

/**
 * 拒绝某个视角
 */
export function rejectViewStage(args) {
  const { workflow_id, view, note = '' } = args;

  const result = rejectView({
    workflow_id,
    view,
    note
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'rejection' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '重新生成被拒绝的视角'
  });
}

/**
 * 重新生成某个视角
 */
export async function regenerateViewStage(args) {
  const { workflow_id, view, signal = null } = args;

  const result = await regenerateView({
    workflow_id,
    view,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'regeneration' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('image', result.data.image_path)
    ]
  });
}

/**
 * 生成状态变体
 */
export async function generateStateVariantsStage(args) {
  const { workflow_id, view, states = ['intact', 'damaged', 'rubble'], signal = null } = args;

  const result = await generateStateVariants({
    workflow_id,
    view,
    states,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'state_generation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: result.data.states.map(s =>
      artifact('image', s.image_path)
    )
  });
}

/**
 * 批量生成所有视角的状态变体
 */
export async function generateAllStatesBatch(args) {
  const { workflow_id, states = ['intact', 'damaged', 'rubble'], signal = null } = args;

  const result = await batchGenerateStates({
    workflow_id,
    states,
    signal
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'batch_state_generation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '进行QC审核'
  });
}

/**
 * 批准某个状态变体
 */
export function approveStateStage(args) {
  const { workflow_id, view, state, note = '' } = args;

  const result = approveState({
    workflow_id,
    view,
    state,
    note
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'approval' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  });
}

/**
 * 拒绝某个状态变体
 */
export function rejectStateStage(args) {
  const { workflow_id, view, state, note = '' } = args;

  const result = rejectState({
    workflow_id,
    view,
    state,
    note
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'rejection' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  });
}

/**
 * 执行QC审核
 */
export async function performQCStage(args) {
  const { workflow_id, strict = true } = args;

  const result = await performQC({
    workflow_id,
    strict
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'qc' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION,
    next_action: '准备发布资产'
  });
}

/**
 * 发布工作流
 */
export function publishWorkflowStage(args) {
  const { workflow_id, replace = false } = args;

  const result = publishWorkflow({
    workflow_id,
    replace
  });

  if (!result.success) {
    return err(ErrorCode.OUTPUT_WRITE_FAILED, result.error, { stage: 'publish' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  }, {
    artifacts: [
      artifact('json', result.data.manifest_path)
    ]
  });
}

/**
 * 获取工作流信息
 */
export function getCoverPropWorkflow(args) {
  const { workflow_id, prop_id } = args;

  const result = getWorkflow({ workflow_id, prop_id });

  if (!result.success) {
    return err(ErrorCode.FILE_NOT_FOUND, result.error, { stage: 'validation' });
  }

  return ok({
    ...result.data,
    workflow_version: WORKFLOW_VERSION
  });
}

/**
 * 列出待审核的工作流
 */
export function listPendingReviews(args = {}) {
  const result = listWorkflows({
    status: WORKFLOW_STATUS.ACTIVE,
    ...args
  });

  if (!result.success) {
    return err(ErrorCode.PROCESSING_FAILED, result.error, { stage: 'listing' });
  }

  return ok({
    total: result.data.total,
    items: result.data.workflows.map(w => ({
      workflow_id: w.workflow_id,
      prop_id: w.prop_id,
      current_stage: w.current_stage,
      stage_status: w.stage_status,
      global_status: w.global_status,
      updated_at: w.updated_at,
      metadata: w.metadata
    }))
  });
}

/**
 * 恢复后台任务（页面刷新后）
 */
export function restorePendingTasksStage() {
  const result = restorePendingTasks();

  return ok({
    pending_count: result.pending_count,
    workflows: result.workflows
  });
}

/**
 * 兼容旧版本的函数
 */
export function nextCoverPropStageLegacy(stage) {
  return nextCoverPropStage(stage);
}

export async function generateCoverPropPhase1Legacy(args) {
  // 迁移到新的工作流系统
  return createCoverPropWorkflow(args);
}

export async function approveCoverPropLegacy(args) {
  const { prop_id, candidate_dir } = args;
  const workflow = getWorkflow({ prop_id });

  if (!workflow.success) {
    return err(ErrorCode.FILE_NOT_FOUND, 'Review workflow not found', { stage: 'validation' });
  }

  return approveConceptStage({
    workflow_id: workflow.data.workflow_id,
    note: args.note
  });
}

export async function processCoverPropPhase2Legacy(args) {
  const { prop_id, candidate_dir } = args;
  const workflow = getWorkflow({ prop_id });

  if (!workflow.success) {
    return err(ErrorCode.FILE_NOT_FOUND, 'Review workflow not found', { stage: 'validation' });
  }

  // 根据当前阶段决定执行什么操作
  const currentStage = workflow.data.current_stage;

  if (currentStage === 'view_select') {
    return err(ErrorCode.INVALID_ARGUMENT, 'Please select views first using sprite_select_views', { stage: 'validation' });
  } else if (currentStage === 'view_generate' || currentStage === 'view_review') {
    return generateViewsBatch({ workflow_id: workflow.data.workflow_id });
  } else if (currentStage === 'state_generate') {
    return generateAllStatesBatch({ workflow_id: workflow.data.workflow_id });
  } else if (currentStage === 'qc') {
    return performQCStage({ workflow_id: workflow.data.workflow_id });
  } else if (currentStage === 'publish') {
    return publishWorkflowStage({ workflow_id: workflow.data.workflow_id });
  } else {
    return err(ErrorCode.INVALID_ARGUMENT, `Cannot process stage: ${currentStage}`, { stage: 'validation' });
  }
}

// ─── 持久化辅助函数 ─────────────────────────────────────────────────────────────

function persistRecord(record) {
  // 写入工作流数据库
  try {
    const db = JSON.parse(fs.readFileSync(WORKFLOW_DB_PATH, 'utf8'));
    const index = db.workflows.findIndex(w => w.workflow_id === record.workflow_id);
    if (index >= 0) {
      db.workflows[index] = record;
    } else {
      db.workflows.push(record);
    }
    fs.writeFileSync(WORKFLOW_DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Failed to persist record:', e);
  }

  // 同步到旧的 review queue
  try {
    const queue = JSON.parse(fs.readFileSync(REVIEW_QUEUE, 'utf8'));
    const index = queue.findIndex(item => item.workflow_id === record.workflow_id);
    if (index >= 0) {
      queue[index] = record;
    } else {
      queue.push(record);
    }
    fs.writeFileSync(REVIEW_QUEUE, JSON.stringify(queue, null, 2));
  } catch (e) {
    // 如果旧队列不存在，忽略
  }
}

function findRecord(propId, candidateDir) {
  if (!propId) return null;
  const expectedDir = candidateDir ? path.resolve(candidateDir) : null;

  try {
    const db = JSON.parse(fs.readFileSync(WORKFLOW_DB_PATH, 'utf8'));
    return db.workflows
      .filter(record => record.workflow_version === WORKFLOW_VERSION && record.prop_id === propId)
      .filter(record => !expectedDir || path.resolve(record.workflow_dir) === expectedDir)
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] || null;
  } catch {
    return null;
  }
}
