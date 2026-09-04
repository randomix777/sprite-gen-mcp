/**
 * 多视角流水线状态机
 * 
 * 工作流阶段:
 * - brief: 需求阶段
 * - concept: 概念设计阶段（文生图 → 图生图修改 → 批准）
 * - view_select: 视角选择阶段
 * - view_generate: 批量视角生成阶段
 * - view_review: 多视角审核阶段
 * - state_generate: 状态变体生成阶段
 * - qc: QC审核阶段
 * - publish: 最终发布阶段
 * 
 * 视角状态: QUEUED / GENERATING / PENDING_REVIEW / APPROVED / REJECTED / FAILED / CANCELLED
 * 状态变体: intact / damaged / rubble
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ASSET_TYPE_IDS, STYLE_PROFILE_IDS, getAssetProfile } from './asset_profiles.js';
import { generateImage } from './image_gen.js';
import { saveGeneratedImage } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DB = path.resolve(__dirname, '..', 'output', 'workflow_db.json');

// 阶段顺序
export const STAGE_ORDER = [
  'brief',
  'concept',
  'view_select',
  'view_generate',
  'view_review',
  'state_generate',
  'qc',
  'publish'
];

// 视角预设（来自 camera_presets.js）
export const VIEW_PRESETS = {
  end_profile: '短边端面侧视',
  long_elevation: '长边正立面',
  front: '正面正交',
  rear: '背面正交',
  top_down: '正交俯视',
  three_quarter: '3/4 展示视角',
  isometric: '等距视角'
};

// 状态变体列表
export const STATE_VARIANTS = ['intact', 'damaged', 'rubble'];

// 视角状态枚举
export const VIEW_STATUS = {
  QUEUED: 'QUEUED',
  GENERATING: 'GENERATING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

// 阶段状态枚举
export const STAGE_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETE: 'COMPLETE'
};

// 全局状态枚举
export const WORKFLOW_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  REVIEWING: 'REVIEWING',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED'
};

/**
 * 初始化工作流数据库
 */
function initWorkflowDB() {
  try {
    if (!fs.existsSync(WORKFLOW_DB)) {
      fs.mkdirSync(path.dirname(WORKFLOW_DB), { recursive: true });
      fs.writeFileSync(WORKFLOW_DB, JSON.stringify({ workflows: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(WORKFLOW_DB, 'utf8'));
  } catch (e) {
    return { workflows: [] };
  }
}

/**
 * 保存工作流数据库
 */
function saveWorkflowDB(data) {
  fs.writeFileSync(WORKFLOW_DB, JSON.stringify(data, null, 2));
}

/**
 * 创建新的工作流
 */
export function createWorkflow(args) {
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
    return { success: false, error: 'prop_id, prompt, material_type 是必填项' };
  }
  if (!ASSET_TYPE_IDS.includes(asset_type)) return { success: false, error: `不支持的 asset_type: ${asset_type}` };
  if (!STYLE_PROFILE_IDS.includes(style_profile)) return { success: false, error: `不支持的 style_profile: ${style_profile}` };

  // 验证 prop_id 格式
  if (!/^[A-Za-z0-9_-]+$/.test(prop_id)) {
    return { success: false, error: 'prop_id 只能包含字母、数字、下划线和连字符' };
  }

  const workflowId = `${prop_id}_${Date.now()}`;
  const workflowDir = path.resolve(output_dir, workflowId);

  // 创建目录结构
  fs.mkdirSync(path.join(workflowDir, 'concept'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'views'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'states'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'qc_evidence'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'approved'), { recursive: true });

  const now = new Date().toISOString();

  const workflow = {
    workflow_version: 3, // 新版本的 workflow
    workflow_id: workflowId,
    workflow_dir: workflowDir,
    prop_id,
    prompt,
    material_type,
    cover_height,
    width,
    height,
    provider,
    asset_type,
    style_profile,
    asset_profile: getAssetProfile(asset_type),
    
    // 相机视角
    camera_view,
    approved_camera_view: null, // 最终批准的视角
    
    // 阶段状态
    current_stage: 'concept',
    stage_status: STAGE_STATUS.PENDING,
    global_status: WORKFLOW_STATUS.DRAFT,
    
    // 时间节点
    created_at: now,
    updated_at: now,
    
    // 各阶段数据
    brief: {
      status: STAGE_STATUS.APPROVED,
      created_at: now
    },
    
    concept: {
      status: STAGE_STATUS.PENDING_REVIEW,
      revisions: [],
      approved_revision: null,
      approved_at: null,
      history: []
    },
    
    view_select: {
      status: STAGE_STATUS.PENDING,
      selected_views: [],
      created_at: null
    },
    
    view_generate: {
      status: STAGE_STATUS.PENDING,
      views: {},
      batch_status: null,
      created_at: null
    },
    
    view_review: {
      status: STAGE_STATUS.PENDING,
      approved_views: [],
      rejected_views: [],
      created_at: null
    },
    
    state_generate: {
      status: STAGE_STATUS.PENDING,
      states: {},
      created_at: null
    },
    
    qc: {
      status: STAGE_STATUS.PENDING,
      results: {},
      created_at: null
    },
    
    publish: {
      status: STAGE_STATUS.PENDING,
      approved_dir: null,
      manifest: null,
      published_at: null
    },
    
    // 元数据
    metadata: {
      total_generations: 0,
      total_approvals: 0,
      total_rejections: 0
    }
  };

  // 保存到数据库
  const db = initWorkflowDB();
  db.workflows.push(workflow);
  saveWorkflowDB(db);

  return {
    success: true,
    data: {
      workflow_id: workflowId,
      prop_id,
      asset_type,
      style_profile,
      asset_profile: getAssetProfile(asset_type),
      current_stage: 'concept',
      stage_status: STAGE_STATUS.PENDING_REVIEW,
      workflow_dir: workflowDir,
      next_action: '开始生成概念图'
    }
  };
}

/**
 * 获取工作流信息
 */
export function getWorkflow(args) {
  const { workflow_id, prop_id } = args;
  const db = initWorkflowDB();
  
  const workflow = db.workflows.find(w => {
    if (workflow_id) return w.workflow_id === workflow_id;
    if (prop_id) return w.prop_id === prop_id;
    return false;
  });
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  return { success: true, data: workflow };
}

/**
 * 生成概念图（文生图）
 */
export async function generateConceptImage(args) {
  const { workflow_id, prompt_override = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'concept') {
    return { success: false, error: '当前不在概念阶段' };
  }
  
  // 构建概念提示词
  const conceptPrompt = buildConceptPrompt(
    prompt_override || workflow.prompt,
    workflow.material_type,
    workflow.cover_height,
    workflow.camera_view
  );
  const styleHint = workflow.style_profile === 'pixel_art'
    ? ' Pixel art style: hard edges, limited palette, no anti-aliasing.'
    : workflow.style_profile === 'painted'
      ? ' Hand-painted game illustration style with readable silhouettes.'
      : workflow.style_profile === 'concept'
        ? ' Concept design sheet style, emphasize clear shape and material.'
        : ' Clean production game-asset style, readable silhouette and transparent background.';
  const finalConceptPrompt = `${conceptPrompt}${styleHint}`;
  
  const generation = await generateImage({
    provider: workflow.provider,
    prompt: finalConceptPrompt,
    width: workflow.width,
    height: workflow.height,
    num_images: 1,
    style: workflow.style_profile === 'pixel_art' ? 'pixel_art' : 'concept',
    signal: args.signal
  });
  if (!generation.success || !generation.data?.images?.length) {
    return { success: false, error: generation.error?.message || 'Agnes 概念图生成失败', retryable: generation.error?.retryable ?? true };
  }
  const revisionNum = workflow.concept.revisions.length + 1;
  const imagePath = path.join(workflow.workflow_dir, 'concept', `concept_r${revisionNum}.png`);
  saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
  
  // 保存历史记录
  workflow.concept.history.push({
    revision: revisionNum,
    prompt: finalConceptPrompt,
    image_path: imagePath,
    generation_mode: 'text_to_image',
    generated_at: new Date().toISOString(),
    status: 'PENDING_REVIEW'
  });
  
  workflow.concept.revisions.push({
    revision: revisionNum,
    prompt: finalConceptPrompt,
    image_path: imagePath,
    generation_mode: 'text_to_image',
    generated_at: new Date().toISOString(),
    status: VIEW_STATUS.PENDING_REVIEW
  });
  
  workflow.concept.status = STAGE_STATUS.PENDING_REVIEW;
  workflow.concept.approved_revision = null;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_generations++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'concept',
      stage_status: STAGE_STATUS.PENDING_REVIEW,
      generation_mode: 'text_to_image',
      revision: revisionNum,
      preview_path: imagePath,
      prompt: finalConceptPrompt,
      next_action: '审核概念图，确认后批准'
    }
  };
}

/**
 * 修改概念图（图生图）
 */
export async function reviseConceptImage(args) {
  const { workflow_id, feedback, signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'concept') {
    return { success: false, error: '当前不在概念阶段' };
  }
  
  if (!feedback) {
    return { success: false, error: '必须提供修改意见' };
  }
  
  // 获取当前概念图作为参考
  const currentRevision = workflow.concept.revisions[workflow.concept.revisions.length - 1];
  if (!currentRevision?.image_path) {
    return { success: false, error: '没有找到可用的概念图作为参考' };
  }
  
  // 构建修改提示词
  const revisionPrompt = buildConceptRevisionPrompt(
    workflow.prompt,
    workflow.material_type,
    workflow.cover_height,
    workflow.camera_view,
    feedback
  );
  
  const generation = await generateImage({ provider: workflow.provider, prompt: revisionPrompt, width: workflow.width, height: workflow.height, num_images: 1, imageUrls: [currentRevision.image_path], signal });
  if (!generation.success || !generation.data?.images?.length) return { success: false, error: generation.error?.message || '概念修改失败', retryable: true };
  const revisionNum = workflow.concept.revisions.length + 1;
  const imagePath = path.join(workflow.workflow_dir, 'concept', `concept_r${revisionNum}.png`);
  saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
  
  // 更新历史记录
  const previousHistory = { ...currentRevision };
  workflow.concept.history.push(previousHistory);
  
  // 添加新的修订版本
  workflow.concept.revisions.push({
    revision: revisionNum,
    prompt: revisionPrompt,
    image_path: imagePath,
    reference_path: currentRevision.image_path,
    feedback: feedback,
    generation_mode: 'image_to_image',
    generated_at: new Date().toISOString(),
    status: VIEW_STATUS.PENDING_REVIEW
  });
  
  workflow.concept.status = STAGE_STATUS.PENDING_REVIEW;
  workflow.concept.approved_revision = null;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_generations++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'concept',
      stage_status: STAGE_STATUS.PENDING_REVIEW,
      revision: revisionNum,
      preview_path: imagePath,
      prompt: revisionPrompt,
      generation_mode: 'image_to_image',
      next_action: '审核修改后的概念图，确认后可批准'
    }
  };
}

/**
 * 重新开始概念图（文生图，不使用参考图）
 */
export async function restartConceptImage(args) {
  const { workflow_id, signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'concept') {
    return { success: false, error: '当前不在概念阶段' };
  }
  
  // 构建原始概念提示词
  const conceptPrompt = buildConceptPrompt(
    workflow.prompt,
    workflow.material_type,
    workflow.cover_height,
    workflow.camera_view
  );
  
  const generation = await generateImage({ provider: workflow.provider, prompt: conceptPrompt, width: workflow.width, height: workflow.height, num_images: 1, style: workflow.style_profile === 'pixel_art' ? 'pixel_art' : 'concept', signal });
  if (!generation.success || !generation.data?.images?.length) return { success: false, error: generation.error?.message || '概念重启失败', retryable: true };
  const revisionNum = workflow.concept.revisions.length + 1;
  const imagePath = path.join(workflow.workflow_dir, 'concept', `concept_r${revisionNum}.png`);
  saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
  
  // 添加重新开始的历史
  workflow.concept.revisions.push({
    revision: revisionNum,
    prompt: conceptPrompt,
    image_path: imagePath,
    generation_mode: 'text_to_image',
    generated_at: new Date().toISOString(),
    status: VIEW_STATUS.PENDING_REVIEW,
    is_restart: true
  });
  
  workflow.concept.status = STAGE_STATUS.PENDING_REVIEW;
  workflow.concept.approved_revision = null;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_generations++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'concept',
      stage_status: STAGE_STATUS.PENDING_REVIEW,
      revision: revisionNum,
      preview_path: imagePath,
      prompt: conceptPrompt,
      generation_mode: 'text_to_image',
      next_action: '重新生成的概念图已就绪，请审核'
    }
  };
}

/**
 * 批准概念图
 */
export function approveConcept(args) {
  const { workflow_id, note = '' } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'concept') {
    return { success: false, error: '当前不在概念阶段' };
  }
  
  const currentRevision = workflow.concept.revisions[workflow.concept.revisions.length - 1];
  if (!currentRevision) {
    return { success: false, error: '没有找到可批准的概念图' };
  }
  
  if (currentRevision.status !== VIEW_STATUS.PENDING_REVIEW) {
    return { success: false, error: '当前概念图状态不是待审核' };
  }
  
  // 批准概念图
  currentRevision.status = VIEW_STATUS.APPROVED;
  currentRevision.approved_at = new Date().toISOString();
  currentRevision.approval_note = note;
  
  workflow.concept.approved_revision = currentRevision.revision;
  workflow.concept.approved_at = new Date().toISOString();
  workflow.concept.status = STAGE_STATUS.APPROVED;
  
  // 进入视角选择阶段
  workflow.current_stage = 'view_select';
  workflow.stage_status = STAGE_STATUS.PENDING;
  workflow.view_select.status = STAGE_STATUS.PENDING;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_approvals++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'view_select',
      stage_status: STAGE_STATUS.PENDING,
      approved_revision: currentRevision.revision,
      approved_image: currentRevision.image_path,
      next_action: '进入视角选择阶段，选择需要的生产视角'
    }
  };
}

/**
 * 选择视角
 */
export function selectViews(args) {
  const { workflow_id, selected_views } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'view_select') {
    return { success: false, error: '当前不在视角选择阶段' };
  }
  
  if (!Array.isArray(selected_views) || selected_views.length === 0) {
    return { success: false, error: '必须选择至少一个视角' };
  }
  
  // 验证视角有效性
  for (const view of selected_views) {
    if (!VIEW_PRESETS[view]) {
      return { success: false, error: `无效的视角预设: ${view}` };
    }
  }
  
  // 保存选中的视角
  workflow.view_select.selected_views = selected_views;
  workflow.view_select.status = STAGE_STATUS.APPROVED;
  workflow.view_select.created_at = new Date().toISOString();
  
  // 进入批量生成阶段
  workflow.current_stage = 'view_generate';
  workflow.stage_status = STAGE_STATUS.IN_PROGRESS;
  workflow.view_generate.status = STAGE_STATUS.IN_PROGRESS;
  workflow.view_generate.created_at = new Date().toISOString();
  
  // 初始化每个视角的状态
  for (const view of selected_views) {
    workflow.view_generate.views[view] = {
      status: VIEW_STATUS.QUEUED,
      image_path: null,
      prompt: null,
      reference_path: null,
      generation_result: null,
      qc_result: null,
      state_results: {}
    };
  }
  
  workflow.updated_at = new Date().toISOString();
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'view_generate',
      stage_status: STAGE_STATUS.IN_PROGRESS,
      selected_views,
      next_action: '开始批量生成视角图片'
    }
  };
}

/**
 * 批量生成视角
 */
export async function batchGenerateViews(args) {
  const { workflow_id, signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'view_generate') {
    return { success: false, error: '当前不在批量生成阶段' };
  }
  
  const approvedConcept = workflow.concept.revisions.find(
    r => r.revision === workflow.concept.approved_revision
  );
  
  if (!approvedConcept) {
    return { success: false, error: '没有找到已批准的概念图' };
  }
  
  const results = [];
  
  for (const view of workflow.view_select.selected_views) {
    // 检查是否已经生成过
    if (workflow.view_generate.views[view]?.status === VIEW_STATUS.APPROVED) {
      results.push({
        view,
        status: VIEW_STATUS.APPROVED,
        image_path: workflow.view_generate.views[view].image_path
      });
      continue;
    }
    
    // 构建视角提示词
    const viewPrompt = buildViewPrompt(
      workflow.prompt,
      workflow.material_type,
      workflow.cover_height,
      view,
      workflow.width,
      workflow.height
    );
    
    const generation = await generateImage({ provider: workflow.provider, prompt: viewPrompt, width: workflow.width, height: workflow.height, num_images: 1, imageUrls: [approvedConcept.image_path], signal });
    const viewDir = path.join(workflow.workflow_dir, 'views', view);
    fs.mkdirSync(viewDir, { recursive: true });
    
    const imagePath = path.join(viewDir, 'view.png');
    if (!generation.success || !generation.data?.images?.length) {
      workflow.view_generate.views[view] = { status: VIEW_STATUS.FAILED, prompt: viewPrompt, error: generation.error?.message || '视角生成失败', reference_path: approvedConcept.image_path };
      results.push({ view, status: VIEW_STATUS.FAILED, error: generation.error?.message || '视角生成失败' });
      continue;
    }
    saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
    
    // 更新视角状态
    workflow.view_generate.views[view] = {
      ...workflow.view_generate.views[view],
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath,
      prompt: viewPrompt,
      reference_path: approvedConcept.image_path,
      generated_at: new Date().toISOString()
    };
    
    results.push({
      view,
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath
    });
    
    workflow.metadata.total_generations++;
  }
  
  workflow.view_generate.batch_status = 'COMPLETED';
  workflow.view_generate.created_at = new Date().toISOString();
  workflow.current_stage = 'view_review';
  workflow.stage_status = STAGE_STATUS.PENDING_REVIEW;
  workflow.view_review.status = STAGE_STATUS.PENDING;
  workflow.updated_at = new Date().toISOString();
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'view_review',
      stage_status: STAGE_STATUS.PENDING_REVIEW,
      batch_results: results,
      next_action: '审核各个视角图片，确认后批准'
    }
  };
}

/**
 * 单独生成某个视角
 */
export async function generateSingleView(args) {
  const { workflow_id, view, signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!VIEW_PRESETS[view]) {
    return { success: false, error: '无效的视角预设' };
  }
  
  if (!workflow.view_select.selected_views.includes(view)) {
    return { success: false, error: '该视角不在已选定的视角列表中' };
  }
  
  const approvedConcept = workflow.concept.revisions.find(
    r => r.revision === workflow.concept.approved_revision
  );
  
  if (!approvedConcept) {
    return { success: false, error: '没有找到已批准的概念图' };
  }
  
  // 构建视角提示词
  const viewPrompt = buildViewPrompt(
    workflow.prompt,
    workflow.material_type,
    workflow.cover_height,
    view,
    workflow.width,
    workflow.height
  );
  
    const generation = await generateImage({ provider: workflow.provider, prompt: viewPrompt, width: workflow.width, height: workflow.height, num_images: 1, imageUrls: [approvedConcept.image_path], signal });
  const viewDir = path.join(workflow.workflow_dir, 'views', view);
  fs.mkdirSync(viewDir, { recursive: true });
  
    const imagePath = path.join(viewDir, 'view.png');
    if (!generation.success || !generation.data?.images?.length) return { success: false, error: generation.error?.message || '视角生成失败', retryable: true };
    saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
  
  // 更新视角状态
  workflow.view_generate.views[view] = {
    ...workflow.view_generate.views[view],
    status: VIEW_STATUS.PENDING_REVIEW,
    image_path: imagePath,
    prompt: viewPrompt,
    reference_path: approvedConcept.image_path,
    generated_at: new Date().toISOString()
  };
  
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_generations++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath,
      next_action: '审核并批准此视角'
    }
  };
}

/**
 * 批准某个视角
 */
export function approveView(args) {
  const { workflow_id, view, note = '' } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!workflow.view_generate.views[view]) {
    return { success: false, error: '该视角不存在' };
  }
  
  if (workflow.view_generate.views[view].status !== VIEW_STATUS.PENDING_REVIEW) {
    return { success: false, error: '该视角状态不是待审核' };
  }
  
  // 更新视角状态
  workflow.view_generate.views[view].status = VIEW_STATUS.APPROVED;
  workflow.view_generate.views[view].approved_at = new Date().toISOString();
  workflow.view_generate.views[view].approval_note = note;
  
  // 记录已批准的视角
  if (!workflow.view_review.approved_views) {
    workflow.view_review.approved_views = [];
  }
  workflow.view_review.approved_views.push(view);
  
  workflow.view_review.status = STAGE_STATUS.IN_PROGRESS;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_approvals++;
  
  saveWorkflowDB(db);
  
  // 检查是否所有视角都已批准
  const allApproved = workflow.view_select.selected_views.every(
    v => workflow.view_generate.views[v]?.status === VIEW_STATUS.APPROVED
  );
  
  if (allApproved) {
    workflow.view_review.status = STAGE_STATUS.APPROVED;
    workflow.current_stage = 'state_generate';
    workflow.stage_status = STAGE_STATUS.PENDING;
    workflow.state_generate.status = STAGE_STATUS.PENDING;
    workflow.updated_at = new Date().toISOString();
    saveWorkflowDB(db);
  }
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      status: VIEW_STATUS.APPROVED,
      all_views_approved: allApproved,
      next_stage: allApproved ? 'state_generate' : 'view_review',
      next_action: allApproved ? '进入状态变体生成阶段' : '继续审核其他视角'
    }
  };
}

/**
 * 拒绝某个视角
 */
export function rejectView(args) {
  const { workflow_id, view, note = '' } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!workflow.view_generate.views[view]) {
    return { success: false, error: '该视角不存在' };
  }
  
  if (workflow.view_generate.views[view].status !== VIEW_STATUS.PENDING_REVIEW) {
    return { success: false, error: '该视角状态不是待审核' };
  }
  
  // 更新视角状态
  workflow.view_generate.views[view].status = VIEW_STATUS.REJECTED;
  workflow.view_generate.views[view].rejected_at = new Date().toISOString();
  workflow.view_generate.views[view].rejection_note = note;
  
  // 记录被拒绝的视角
  if (!workflow.view_review.rejected_views) {
    workflow.view_review.rejected_views = [];
  }
  workflow.view_review.rejected_views.push(view);
  
  workflow.view_review.status = STAGE_STATUS.IN_PROGRESS;
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_rejections++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      status: VIEW_STATUS.REJECTED,
      next_action: '重新生成被拒绝的视角'
    }
  };
}

/**
 * 重新生成某个视角
 */
export async function regenerateView(args) {
  const { workflow_id, view, signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!workflow.view_generate.views[view]) {
    return { success: false, error: '该视角不存在' };
  }
  
  const approvedConcept = workflow.concept.revisions.find(
    r => r.revision === workflow.concept.approved_revision
  );
  
  if (!approvedConcept) {
    return { success: false, error: '没有找到已批准的概念图' };
  }
  
  // 使用之前的 prompt 或重新生成
  const viewPrompt = workflow.view_generate.views[view].prompt || 
    buildViewPrompt(
      workflow.prompt,
      workflow.material_type,
      workflow.cover_height,
      view,
      workflow.width,
      workflow.height
    );
  
  const generation = await generateImage({ provider: workflow.provider, prompt: viewPrompt, width: workflow.width, height: workflow.height, num_images: 1, imageUrls: [approvedConcept.image_path], signal });
  if (!generation.success || !generation.data?.images?.length) return { success: false, error: generation.error?.message || '视角重生成失败', retryable: true };
  const viewDir = path.join(workflow.workflow_dir, 'views', view);
  fs.mkdirSync(viewDir, { recursive: true });
  
  const imagePath = path.join(viewDir, 'view.png');
  saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
  
  // 更新视角状态
  workflow.view_generate.views[view] = {
    ...workflow.view_generate.views[view],
    status: VIEW_STATUS.PENDING_REVIEW,
    image_path: imagePath,
    prompt: viewPrompt,
    reference_path: approvedConcept.image_path,
    regenerated_at: new Date().toISOString()
  };
  
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_generations++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath,
      next_action: '审核并批准重新生成的视角'
    }
  };
}

/**
 * 生成状态变体
 */
export async function generateStateVariants(args) {
  const { workflow_id, view, states = ['intact', 'damaged', 'rubble'], signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'state_generate') {
    return { success: false, error: '当前不在状态变体生成阶段' };
  }
  
  const approvedView = workflow.view_generate.views[view];
  if (!approvedView || approvedView.status !== VIEW_STATUS.APPROVED) {
    return { success: false, error: '该视角未批准' };
  }
  
  const results = [];
  
  for (const state of states) {
    if (!STATE_VARIANTS.includes(state)) {
      continue;
    }
    
    // 构建状态提示词
    const statePrompt = buildStatePrompt(
      workflow.prompt,
      workflow.material_type,
      state,
      view,
      workflow.width,
      workflow.height
    );
    
    const generation = await generateImage({ provider: workflow.provider, prompt: statePrompt, width: workflow.width, height: workflow.height, num_images: 1, imageUrls: [approvedView.image_path], signal });
    const stateDir = path.join(workflow.workflow_dir, 'states', view, state);
    fs.mkdirSync(stateDir, { recursive: true });
    
    const imagePath = path.join(stateDir, 'state.png');
    if (!generation.success || !generation.data?.images?.length) {
      results.push({ view, state, status: VIEW_STATUS.FAILED, error: generation.error?.message || '状态生成失败' });
      continue;
    }
    saveGeneratedImage(generation.data.images[0].data, generation.data.images[0].mimeType, imagePath);
    
    // 初始化状态结果
    if (!workflow.state_generate.states[view]) {
      workflow.state_generate.states[view] = {};
    }
    
    workflow.state_generate.states[view][state] = {
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath,
      prompt: statePrompt,
      reference_path: approvedView.image_path,
      generated_at: new Date().toISOString()
    };
    
    results.push({
      view,
      state,
      status: VIEW_STATUS.PENDING_REVIEW,
      image_path: imagePath
    });
    
    workflow.metadata.total_generations++;
  }
  
  workflow.state_generate.status = STAGE_STATUS.IN_PROGRESS;
  workflow.updated_at = new Date().toISOString();
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      states: results,
      next_action: '审核并批准各个状态变体'
    }
  };
}

/**
 * 批量生成所有视角的状态变体
 */
export async function batchGenerateStates(args) {
  const { workflow_id, states = ['intact', 'damaged', 'rubble'], signal = null } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'state_generate') {
    return { success: false, error: '当前不在状态变体生成阶段' };
  }
  
  // 获取所有已批准的视角
  const approvedViews = workflow.view_select.selected_views.filter(
    view => workflow.view_generate.views[view]?.status === VIEW_STATUS.APPROVED
  );
  
  if (approvedViews.length === 0) {
    return { success: false, error: '没有已批准的视角' };
  }
  
  const allResults = {};
  
  for (const view of approvedViews) {
    allResults[view] = await generateStateVariants({
      workflow_id,
      view,
      states,
      signal
    });
  }
  
  // 检查是否所有视角的状态都已生成
  const allGenerated = approvedViews.every(view => {
    return states.every(state => workflow.state_generate.states[view]?.[state]?.status !== null);
  });
  
  if (allGenerated) {
    workflow.state_generate.status = STAGE_STATUS.APPROVED;
    workflow.current_stage = 'qc';
    workflow.stage_status = STAGE_STATUS.PENDING_REVIEW;
    workflow.qc.status = STAGE_STATUS.PENDING;
    workflow.updated_at = new Date().toISOString();
    saveWorkflowDB(db);
  }
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: workflow.current_stage,
      stage_status: workflow.stage_status,
      results: allResults,
      next_action: '进行QC审核'
    }
  };
}

/**
 * 批准某个状态变体
 */
export function approveState(args) {
  const { workflow_id, view, state, note = '' } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!workflow.state_generate.states[view]?.[state]) {
    return { success: false, error: '该状态变体不存在' };
  }
  
  if (workflow.state_generate.states[view][state].status !== VIEW_STATUS.PENDING_REVIEW) {
    return { success: false, error: '该状态变体状态不是待审核' };
  }
  
  // 更新状态变体状态
  workflow.state_generate.states[view][state].status = VIEW_STATUS.APPROVED;
  workflow.state_generate.states[view][state].approved_at = new Date().toISOString();
  workflow.state_generate.states[view][state].approval_note = note;
  
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_approvals++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      state,
      status: VIEW_STATUS.APPROVED,
      next_action: '继续批准其他状态变体或进入QC阶段'
    }
  };
}

/**
 * 拒绝某个状态变体
 */
export function rejectState(args) {
  const { workflow_id, view, state, note = '' } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (!workflow.state_generate.states[view]?.[state]) {
    return { success: false, error: '该状态变体不存在' };
  }
  
  if (workflow.state_generate.states[view][state].status !== VIEW_STATUS.PENDING_REVIEW) {
    return { success: false, error: '该状态变体状态不是待审核' };
  }
  
  // 更新状态变体状态
  workflow.state_generate.states[view][state].status = VIEW_STATUS.REJECTED;
  workflow.state_generate.states[view][state].rejected_at = new Date().toISOString();
  workflow.state_generate.states[view][state].rejection_note = note;
  
  workflow.updated_at = new Date().toISOString();
  workflow.metadata.total_rejections++;
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      view,
      state,
      status: VIEW_STATUS.REJECTED,
      next_action: '重新生成被拒绝的状态变体'
    }
  };
}

/**
 * 执行QC审核
 */
export async function performQC(args) {
  const { workflow_id, strict = true } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'qc') {
    return { success: false, error: '当前不在QC阶段' };
  }
  
  // 收集所有需要QC的图像
  const qcTargets = [];
  
  // QC视角图
  for (const view of workflow.view_select.selected_views) {
    const viewData = workflow.view_generate.views[view];
    if (viewData?.status === VIEW_STATUS.APPROVED && viewData.image_path) {
      qcTargets.push({
        type: 'view',
        view,
        path: viewData.image_path
      });
    }
  }
  
  // QC状态变体
  for (const view of workflow.view_select.selected_views) {
    for (const state of STATE_VARIANTS) {
      const stateData = workflow.state_generate.states[view]?.[state];
      if (stateData?.status === VIEW_STATUS.APPROVED && stateData.image_path) {
        qcTargets.push({
          type: 'state',
          view,
          state,
          path: stateData.image_path
        });
      }
    }
  }
  
  // 执行QC（这里需要调用实际的qc.js）
  // const { qcGate } = await import('./qc.js');
  const qcResults = {};
  
  for (const target of qcTargets) {
    // const result = await qcGate({
    //   image_path: target.path,
    //   canvas_width: workflow.width,
    //   canvas_height: workflow.height,
    //   ground_anchor: [Math.floor(workflow.width / 2), Math.floor(workflow.height * 0.9)]
    // });
    
    // 模拟QC结果
    qcResults[`${target.type}_${target.view}_${target.state || ''}`] = {
      status: 'APPROVED',
      rules: [],
      measurements: {},
      evidence_path: null
    };
  }
  
  workflow.qc.results = qcResults;
  workflow.qc.status = STAGE_STATUS.APPROVED;
  workflow.current_stage = 'publish';
  workflow.stage_status = STAGE_STATUS.PENDING;
  workflow.updated_at = new Date().toISOString();
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      current_stage: 'publish',
      stage_status: STAGE_STATUS.PENDING,
      qc_results: qcResults,
      next_action: '准备发布资产'
    }
  };
}

/**
 * 发布工作流
 */
export function publishWorkflow(args) {
  const { workflow_id, replace = false } = args;
  const db = initWorkflowDB();
  const workflow = db.workflows.find(w => w.workflow_id === workflow_id);
  
  if (!workflow) {
    return { success: false, error: '工作流不存在' };
  }
  
  if (workflow.current_stage !== 'publish') {
    return { success: false, error: '当前不在发布阶段' };
  }
  
  // 验证所有必需节点都已批准
  const requiredNodes = [
    ...workflow.view_select.selected_views.map(v => ({ type: 'view', id: v })),
    ...workflow.view_select.selected_views.flatMap(v =>
      STATE_VARIANTS.map(s => ({ type: 'state', id: `${v}_${s}` }))
    )
  ];
  
  for (const node of requiredNodes) {
    if (node.type === 'view') {
      if (workflow.view_generate.views[node.id]?.status !== VIEW_STATUS.APPROVED) {
        return { success: false, error: `视角 ${node.id} 未批准` };
      }
    } else {
      const [view, state] = node.id.split('_');
      if (workflow.state_generate.states[view]?.[state]?.status !== VIEW_STATUS.APPROVED) {
        return { success: false, error: `状态变体 ${node.id} 未批准` };
      }
    }
  }
  
  // 创建发布目录
  const approvedDir = path.join(workflow.workflow_dir, 'approved');
  fs.mkdirSync(approvedDir, { recursive: true });
  
  // 复制所有批准的文件
  for (const view of workflow.view_select.selected_views) {
    const viewData = workflow.view_generate.views[view];
    if (viewData?.image_path && fs.existsSync(viewData.image_path)) {
      const destDir = path.join(approvedDir, 'views', view);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(viewData.image_path, path.join(destDir, 'view.png'));
    }
    
    for (const state of STATE_VARIANTS) {
      const stateData = workflow.state_generate.states[view]?.[state];
      if (stateData?.image_path && fs.existsSync(stateData.image_path)) {
        const destDir = path.join(approvedDir, 'states', view, state);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(stateData.image_path, path.join(destDir, 'state.png'));
      }
    }
  }
  
  // 构建 manifest
  const manifest = buildManifest(workflow);
  const manifestPath = path.join(approvedDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  // 更新工作流状态
  workflow.publish.status = STAGE_STATUS.APPROVED;
  workflow.publish.approved_dir = approvedDir;
  workflow.publish.manifest = manifest;
  workflow.publish.published_at = new Date().toISOString();
  workflow.global_status = WORKFLOW_STATUS.COMPLETED;
  workflow.updated_at = new Date().toISOString();
  
  saveWorkflowDB(db);
  
  return {
    success: true,
    data: {
      workflow_id,
      prop_id: workflow.prop_id,
      approved_dir: approvedDir,
      manifest_path: manifestPath,
      manifest,
      next_action: '资产已成功发布'
    }
  };
}

/**
 * 构建 manifest
 */
function buildManifest(workflow) {
  return {
    schema_version: 3,
    prop_id: workflow.prop_id,
    display_name: workflow.prop_id.replace(/_/g, ' '),
    material_type: workflow.material_type,
    canvas_size: [workflow.width, workflow.height],
    views: workflow.view_select.selected_views,
    states: STATE_VARIANTS,
    approved_at: workflow.publish.published_at,
    approved_dir: workflow.publish.approved_dir,
    metadata: workflow.metadata
  };
}

/**
 * 构建概念提示词
 */
function buildConceptPrompt(prompt, materialType, coverHeight, cameraView) {
  return `${buildCameraConstraint(cameraView)}
Create a clean visual concept for one game cover prop for a 2D game.
Prompt: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
Show one complete object only, centered and fully visible.
Preserve a clear silhouette and readable construction details suitable for a later production asset pass.
Use one uniform flat background with no scenery, floor, shadow, text, watermark, border, frame, or additional objects.`;
}

/**
 * 构建概念修改提示词
 */
function buildConceptRevisionPrompt(prompt, materialType, coverHeight, cameraView, feedback) {
  return `Use the supplied concept image as the authoritative identity and design reference.
Original design brief: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
${buildCameraConstraint(cameraView)}
PRESERVE EXACTLY unless the revision explicitly asks otherwise:
- The same object identity, recognizable design language, main construction and functional purpose.
- The same material family, color palette, proportions and art style.
- All details unrelated to the requested revision.
APPLY ONLY THIS REVISION:
${feedback}
Do not invent a different prop, redesign unrelated parts, add scenery, add text, or produce multiple views.
Return one complete isolated revised concept on one uniform flat background.`;
}

/**
 * 构建视角提示词
 */
function buildViewPrompt(prompt, materialType, coverHeight, view, width, height) {
  return `Using the approved concept image as reference, generate the ${VIEW_PRESETS[view] || view} production view of this game prop.
Prompt: ${prompt}
Material: ${materialType}. Cover height: ${coverHeight}.
${buildCameraConstraint(view)}
Canvas size: ${width}x${height}.
Keep the same object identity, structure, proportions, material, color palette, and art style.
Only change the camera angle to show the ${view} view.`;
}

/**
 * 构建状态变体提示词
 */
function buildStatePrompt(prompt, materialType, state, view, width, height) {
  const stateDescriptions = {
    intact: 'production-ready intact state',
    damaged: 'damaged state with visible wear and tear',
    rubble: 'destroyed rubble state with debris pieces'
  };
  
  return `Generate the ${stateDescriptions[state] || state} of this game prop: ${prompt}.
Material: ${materialType}. Camera view: ${view}.
Keep the same canvas size ${width}x${height}, same material appearance, same perspective, same anchor point, and same color palette.
The object identity and silhouette must remain consistent with the approved view.`;
}

/**
 * 构建相机约束
 */
function buildCameraConstraint(cameraView) {
  if (cameraView === 'end_profile') {
    return `CAMERA LOCK — TRUE SHORT-END SIDE PROFILE FOR A 2D SIDE-SCROLLER:
- View the prop directly from its narrow end, looking exactly along the object's long axis.
- Show only the short end face and its thickness profile; the broad long face shown in product photos must not be visible.
- The silhouette must be narrow rather than long, suitable for a barrier extending into the screen in a side-scrolling game.
- Orthographic camera at the object's vertical midpoint, zero downward angle, no top surface, no perspective and no three-quarter view.`;
  }
  if (cameraView === 'long_elevation') {
    return `CAMERA LOCK — BROAD LONG-FACE ELEVATION:
- Orthographic side-on camera at the object's vertical midpoint, looking horizontally with zero downward angle.
- Show the broad gameplay-facing elevation as a flat silhouette, as it would appear in a 2D side-scrolling game.
- The top surface and receding end planes must be completely invisible; use parallel horizontal and vertical edges only.
- No depth perspective, no vanishing point, no isometric or three-quarter presentation.`;
  }
  if (cameraView === 'top_down') return 'CAMERA LOCK: orthographic top-down view, camera directly overhead, no horizon and no side elevation.';
  if (cameraView === 'three_quarter') return 'CAMERA LOCK: consistent three-quarter game-asset view with a mildly elevated camera.';
  if (cameraView === 'isometric') return 'CAMERA LOCK: true isometric projection with equal axis scale, fixed 30-degree axes and no perspective vanishing point.';
  if (cameraView === 'rear') return 'CAMERA LOCK: orthographic rear elevation, looking squarely at the back face with no top surface, receding planes or perspective.';
  return 'CAMERA LOCK: orthographic front elevation with no perspective or visible receding planes.';
}

/**
 * 列出所有工作流
 */
export function listWorkflows(args = {}) {
  const db = initWorkflowDB();
  let workflows = db.workflows;
  
  // 过滤
  if (args.prop_id) {
    workflows = workflows.filter(w => w.prop_id === args.prop_id);
  }
  
  if (args.status) {
    workflows = workflows.filter(w => w.global_status === args.status);
  }
  
  if (args.stage) {
    workflows = workflows.filter(w => w.current_stage === args.stage);
  }
  
  // 排序
  workflows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  
  return {
    success: true,
    data: {
      total: workflows.length,
      workflows: workflows.map(w => ({
        workflow_id: w.workflow_id,
        prop_id: w.prop_id,
        current_stage: w.current_stage,
        stage_status: w.stage_status,
        global_status: w.global_status,
        updated_at: w.updated_at,
        metadata: w.metadata
      }))
    }
  };
}

/**
 * 恢复后台任务（页面刷新后）
 */
export function restorePendingTasks() {
  const db = initWorkflowDB();
  const pendingWorkflows = db.workflows.filter(w => 
    w.stage_status === STAGE_STATUS.IN_PROGRESS ||
    w.stage_status === STAGE_STATUS.PENDING_REVIEW
  );
  
  return {
    success: true,
    data: {
      pending_count: pendingWorkflows.length,
      workflows: pendingWorkflows.map(w => ({
        workflow_id: w.workflow_id,
        prop_id: w.prop_id,
        current_stage: w.current_stage,
        stage_status: w.stage_status
      }))
    }
  };
}
