const taskList = document.querySelector('#task-list');
const workspace = document.querySelector('#workspace');
const dialog = document.querySelector('#create-dialog');
const toast = document.querySelector('#toast');
let selectedId = null;
let generationController = null;
let elapsedTimer = null;
let cameraPresets = {};
let workflowData = null;

// ─── API helper ──────────────────────────────────────────────────────────────
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const result = await response.json();
  if (!result.success) throw new Error(result.error?.message || '操作失败');
  return result.data;
}

// ─── Main actions ────────────────────────────────────────────────────────────
document.querySelector('#new-task').addEventListener('click', () => dialog.showModal());
document.querySelector('.close').addEventListener('click', () => dialog.close());
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#create-form').addEventListener('submit', createWorkflow);
document.querySelector('#cancel-generation').addEventListener('click', () => generationController?.abort());
document.querySelector('#create-camera').addEventListener('change', updateCreateCameraHelp);

async function refresh() {
  try {
    const data = await api('/api/reviews');
    renderTasks(data.items);
    if (selectedId && data.items.some(item => item.workflow_id === selectedId)) {
      await selectWorkflow(selectedId);
    } else if (!selectedId) {
      // Check for pending tasks after page refresh
      const pending = await api('/api/pending-tasks');
      if (pending.pending_count > 0) {
        notify(`${pending.pending_count} 个后台任务待恢复`);
      }
    }
  } catch (error) {
    notify(error.message);
  }
}

function renderTasks(items) {
  taskList.replaceChildren(...items.map(item => {
    const button = document.createElement('button');
    button.className = `task ${item.workflow_id === selectedId ? 'active' : ''}`;
    const stageLabel = stageName(item.current_stage);
    button.innerHTML = `<strong>${escapeHtml(item.prop_id)}</strong><span>${stageLabel} · ${new Date(item.updated_at).toLocaleString()}</span><span class="status">${statusName(item.stage_status)}</span>`;
    button.addEventListener('click', () => selectWorkflow(item.workflow_id));
    return button;
  }));
  if (items.length === 0) {
    taskList.innerHTML = '<p class="empty-state">暂无待审核任务</p>';
  }
}

async function selectWorkflow(workflowId) {
  selectedId = workflowId;
  try {
    workflowData = await api(`/api/workflows/${encodeURIComponent(workflowId)}`);
    renderWorkflow(workflowData);
  } catch (error) {
    notify(error.message);
  }
  await refreshListOnly();
}

async function refreshListOnly() {
  const data = await api('/api/reviews');
  renderTasks(data.items);
}

// ─── Stage rendering ─────────────────────────────────────────────────────────
function renderWorkflow(record) {
  workspace.className = 'workspace';
  const stage = record.current_stage;
  
  // Render stage indicator
  const stages = ['brief', 'concept', 'view_select', 'view_generate', 'view_review', 'state_generate', 'qc', 'publish'];
  const currentIdx = stages.indexOf(stage);
  const stageIndicator = `<div class="stage-indicator">${stages.map((s, i) => {
    let cls = 'stage-step';
    if (i < currentIdx) cls += ' completed';
    else if (i === currentIdx) cls += ' active';
    return `<span class="${cls}">${stageName(s)}</span>`;
  }).join('<span style="color:var(--border)">›</span>')}</div>`;
  
  switch (stage) {
    case 'brief':
      renderBriefStage(record, stageIndicator);
      break;
    case 'concept':
      renderConceptStage(record, stageIndicator);
      break;
    case 'view_select':
      renderViewSelectStage(record, stageIndicator);
      break;
    case 'view_generate':
      renderViewGenerateStage(record, stageIndicator);
      break;
    case 'view_review':
      renderViewReviewStage(record, stageIndicator);
      break;
    case 'state_generate':
      renderStateGenerateStage(record, stageIndicator);
      break;
    case 'qc':
      renderQCStage(record, stageIndicator);
      break;
    case 'publish':
      renderPublishStage(record, stageIndicator);
      break;
    default:
      workspace.innerHTML = `<div class="empty-state"><p>未知阶段：${escapeHtml(stage)}</p></div>`;
  }
}

function renderBriefStage(record, indicator) {
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>需求确认</h3>
      <div class="meta">
        <div><span>资产 ID</span>${escapeHtml(record.prop_id)}</div>
        <div><span>描述</span>${escapeHtml(record.prompt)}</div>
        <div><span>材质</span>${escapeHtml(record.material_type)}</div>
        <div><span>掩体高度</span>${escapeHtml(record.cover_height)}</div>
      </div>
      <button id="approve-brief" class="primary wide">确认需求并开始概念设计</button>
    </div>`;
  document.querySelector('#approve-brief')?.addEventListener('click', async () => {
    setBusy(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/concept/generate`, { method: 'POST' });
      notify('概念图生成已开始');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  });
}

function renderConceptStage(record, indicator) {
  const revisions = record.concept?.revisions || [];
  const current = revisions[revisions.length - 1];
  
  const historyHTML = revisions.map((r, i) => `
    <div class="concept-item ${r.status === 'APPROVED' ? 'approved' : r.status === 'REJECTED' ? 'rejected' : ''}">
      <img class="concept-thumb" src="/api/image?path=${encodeURIComponent(r.image_path)}" alt="revision ${r.revision}">
      <div class="concept-info">
        <h4>R${r.revision} ${r.status === 'APPROVED' ? '✓' : r.status === 'REJECTED' ? '✗' : '·'}</h4>
        <p>${r.generation_mode === 'text_to_image' ? '文生图' : '图生图'} · ${new Date(r.generated_at).toLocaleString()}</p>
        ${r.feedback ? `<p style="color:var(--muted-foreground)">反馈：${escapeHtml(r.feedback)}</p>` : ''}
        ${r.approval_note ? `<p style="color:var(--success)">批准注记：${escapeHtml(r.approval_note)}</p>` : ''}
      </div>
    </div>
  `).reverse().join('');
  
  workspace.innerHTML = `
    ${indicator}
    <div class="review-grid">
      <div>
        <div class="card">
          <h3>当前概念图</h3>
          ${current ? `
            <img src="/api/image?path=${encodeURIComponent(current.image_path)}" style="width:100%;border-radius:8px;margin-bottom:12px;">
            <p style="font-size:12px;color:var(--muted-foreground)">${escapeHtml(current.prompt?.slice(0, 100))}...</p>
          ` : '<p class="empty-state">暂无概念图</p>'}
        </div>
        <div class="card">
          <h3>版本历史</h3>
          <div class="concept-history">${historyHTML || '<p class="empty-state">暂无历史</p>'}</div>
        </div>
      </div>
      <div class="sidebar">
        <div class="card">
          <h3>操作</h3>
          <textarea id="feedback-input" rows="3" placeholder="输入修改意见，用于图生图修正…"></textarea>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button id="revise-concept" class="primary">根据当前图修改（图生图）</button>
            <button id="restart-concept" class="ghost">放弃当前设计（重新文生图）</button>
          </div>
        </div>
        <div class="card">
          <h3>批准概念</h3>
          <textarea id="approval-note" rows="2" placeholder="可选的批准注记…"></textarea>
          <button id="approve-concept" class="primary wide" style="margin-top:8px">批准并进入视角选择</button>
        </div>
      </div>
    </div>`;
  
  document.querySelector('#revise-concept')?.addEventListener('click', async () => {
    const feedback = document.querySelector('#feedback-input')?.value.trim();
    if (!feedback) { notify('请输入修改意见'); return; }
    setBusy(true);
    showGenerationProgress(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/concept/revise`, {
        method: 'POST',
        body: JSON.stringify({ feedback })
      });
      notify('概念图修改已开始');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
      showGenerationProgress(false);
    }
  });
  
  document.querySelector('#restart-concept')?.addEventListener('click', async () => {
    setBusy(true);
    showGenerationProgress(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/concept/restart`, { method: 'POST' });
      notify('已重新开始文生图');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
      showGenerationProgress(false);
    }
  });
  
  document.querySelector('#approve-concept')?.addEventListener('click', async () => {
    const note = document.querySelector('#approval-note')?.value.trim() || '';
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/concept/approve`, {
        method: 'POST',
        body: JSON.stringify({ note })
      });
      notify('概念图已批准');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    }
  });
}

function renderViewSelectStage(record, indicator) {
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>选择生产视角</h3>
      <p style="color:var(--muted-foreground);margin-bottom:16px">勾选需要的视角预设，一键批量生成。每个视角将独立调用图生图。</p>
      <div class="view-grid" id="view-grid">
        ${Object.entries(cameraPresets).map(([id, preset]) => `
          <div class="view-option" data-view="${id}">
            <label><input type="checkbox" value="${id}" style="display:none"> ${escapeHtml(preset.label)}</label>
            <small>${escapeHtml(preset.description)}</small>
          </div>
        `).join('')}
      </div>
      <button id="confirm-views" class="primary wide" style="margin-top:16px">确认选择并开始批量生成</button>
    </div>`;
  
  // Toggle selection
  document.querySelectorAll('.view-option').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('selected');
      const cb = el.querySelector('input');
      if (cb) cb.checked = !cb.checked;
    });
  });
  
  document.querySelector('#confirm-views')?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.view-option.selected input')).map(cb => cb.value);
    if (selected.length === 0) { notify('请至少选择一个视角'); return; }
    setBusy(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/views/select`, {
        method: 'POST',
        body: JSON.stringify({ selected_views: selected })
      });
      notify('视角已选择，开始批量生成');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  });
}

function renderViewGenerateStage(record, indicator) {
  const views = record.view_generate?.views || {};
  const selected = record.view_select?.selected_views || [];
  
  const progress = selected.length > 0 
    ? Math.round((selected.filter(v => views[v]?.status === 'APPROVED').length / selected.length) * 100)
    : 0;
  
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>批量视角生成进度</h3>
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      <p style="color:var(--muted-foreground);font-size:13px">${progress}% 完成 (${selected.filter(v => views[v]?.status === 'APPROVED').length}/${selected.length})</p>
    </div>
    <div class="view-review-grid" id="view-grid">
      ${selected.map(viewId => {
        const viewData = views[viewId] || {};
        const statusClass = viewData.status?.toLowerCase() || 'pending';
        return `
          <div class="view-card ${statusClass}" data-view="${viewId}">
            ${viewData.image_path ? `<img src="/api/image?path=${encodeURIComponent(viewData.image_path)}" alt="${viewId}">` : '<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground)">生成中…</div>'}
            <div class="view-card-body">
              <h4>${escapeHtml(cameraPresets[viewId]?.label || viewId)}</h4>
              <span class="status-badge status-${statusClass}">${statusName(viewData.status)}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <button id="batch-generate" class="primary wide" style="margin-top:16px">重新批量生成</button>`;
  
  document.querySelector('#batch-generate')?.addEventListener('click', async () => {
    setBusy(true);
    showGenerationProgress(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/views/batch`, { method: 'POST' });
      notify('批量生成已开始');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
      showGenerationProgress(false);
    }
  });
}

function renderViewReviewStage(record, indicator) {
  const views = record.view_generate?.views || {};
  const selected = record.view_select?.selected_views || [];
  const approved = record.view_review?.approved_views || [];
  
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>视角审核</h3>
      <p style="color:var(--muted-foreground);margin-bottom:16px">已批准 ${approved.length}/${selected.length} 个视角。所有视角批准后自动进入状态变体阶段。</p>
    </div>
    <div class="view-review-grid" id="view-review-grid">
      ${selected.map(viewId => {
        const viewData = views[viewId] || {};
        const isApproved = approved.includes(viewId);
        return `
          <div class="view-card ${isApproved ? 'approved' : ''}" data-view="${viewId}">
            ${viewData.image_path ? `<img src="/api/image?path=${encodeURIComponent(viewData.image_path)}" alt="${viewId}">` : ''}
            <div class="view-card-body">
              <h4>${escapeHtml(cameraPresets[viewId]?.label || viewId)}</h4>
              <span class="status-badge status-${isApproved ? 'approved' : 'pending'}">${isApproved ? '已批准' : '待审核'}</span>
              <div style="display:flex;gap:8px;margin-top:8px">
                <button class="approve-view" data-view="${viewId}" ${isApproved ? 'disabled' : ''}>批准</button>
                <button class="regenerate-view" data-view="${viewId}" ${isApproved ? 'disabled' : ''}>重生成</button>
              </div>
              <textarea class="view-note" rows="2" placeholder="批注或拒绝原因…" style="width:100%;margin-top:8px;font-size:12px"></textarea>
            </div>
          </div>
        `;
      }).join('')}
    </div>`;
  
  document.querySelectorAll('.approve-view').forEach(btn => {
    btn.addEventListener('click', async () => {
      const viewId = btn.dataset.view;
      const note = btn.closest('.view-card').querySelector('.view-note').value.trim();
      try {
        await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/views/approve`, {
          method: 'POST',
          body: JSON.stringify({ view: viewId, note })
        });
        notify(`视角 ${viewId} 已批准`);
        await selectWorkflow(record.workflow_id);
      } catch (error) {
        notify(error.message);
      }
    });
  });
  
  document.querySelectorAll('.regenerate-view').forEach(btn => {
    btn.addEventListener('click', async () => {
      const viewId = btn.dataset.view;
      setBusy(true);
      try {
        await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/views/regenerate`, {
          method: 'POST',
          body: JSON.stringify({ view: viewId })
        });
        notify(`视角 ${viewId} 重新生成已开始`);
        await selectWorkflow(record.workflow_id);
      } catch (error) {
        notify(error.message);
      } finally {
        setBusy(false);
      }
    });
  });
}

function renderStateGenerateStage(record, indicator) {
  const states = record.state_generate?.states || {};
  const selected = record.view_select?.selected_views || [];
  const stateTypes = ['intact', 'damaged', 'rubble'];
  
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>状态变体生成</h3>
      <p style="color:var(--muted-foreground);margin-bottom:16px">为每个批准的视角生成 intact / damaged / rubble 三种状态变体。</p>
      <button id="batch-states" class="primary wide">批量生成所有状态变体</button>
    </div>
    <div class="state-matrix" id="state-matrix">
      ${selected.map(viewId => `
        <div class="card">
          <h4>${escapeHtml(cameraPresets[viewId]?.label || viewId)}</h4>
          ${stateTypes.map(st => {
            const stateData = states[viewId]?.[st] || {};
            const isApproved = stateData.status === 'APPROVED';
            return `
              <div class="state-card ${isApproved ? 'approved' : ''}" style="margin:8px 0">
                ${stateData.image_path ? `<img src="/api/image?path=${encodeURIComponent(stateData.image_path)}" alt="${st}">` : `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted-foreground)">${st}</div>`}
                <div class="state-card-body">
                  <span class="status-badge status-${isApproved ? 'approved' : 'pending'}">${isApproved ? '✓' : st}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `).join('')}
    </div>`;
  
  document.querySelector('#batch-states')?.addEventListener('click', async () => {
    setBusy(true);
    showGenerationProgress(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/states/batch`, { method: 'POST' });
      notify('状态变体批量生成已开始');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
      showGenerationProgress(false);
    }
  });
}

function renderQCStage(record, indicator) {
  const qc = record.qc || {};
  const results = qc.results || {};
  
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>QC 审核</h3>
      <p style="color:var(--muted-foreground);margin-bottom:16px">对所有视角和状态变体进行质量检查。</p>
      <button id="perform-qc" class="primary wide">执行 QC 审核</button>
    </div>
    ${Object.keys(results).length > 0 ? `
      <div class="card">
        <h3>QC 结果</h3>
        <div style="display:grid;gap:8px">
          ${Object.entries(results).map(([key, res]) => `
            <div style="padding:8px;background:var(--muted);border-radius:4px;font-size:13px">
              ${escapeHtml(key)}: <span style="color:${res.status === 'APPROVED' ? 'var(--success)' : 'var(--destructive)'}">${escapeHtml(res.status)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}`;
  
  document.querySelector('#perform-qc')?.addEventListener('click', async () => {
    setBusy(true);
    try {
      await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/qc/perform`, { method: 'POST' });
      notify('QC 审核已完成');
      await selectWorkflow(record.workflow_id);
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  });
}

function renderPublishStage(record, indicator) {
  workspace.innerHTML = `
    ${indicator}
    <div class="card">
      <h3>最终发布确认</h3>
      <p style="color:var(--muted-foreground);margin-bottom:16px">所有必需节点已批准，可以发布资产。</p>
      <div class="meta">
        <div><span>资产 ID</span>${escapeHtml(record.prop_id)}</div>
        <div><span>视角</span>${(record.view_select?.selected_views || []).join(', ')}</div>
        <div><span>状态</span>intact, damaged, rubble</div>
      </div>
      <button id="publish-btn" class="primary wide" style="margin-top:16px">确认并发布资产</button>
    </div>`;
  
  document.querySelector('#publish-btn')?.addEventListener('click', async () => {
    setBusy(true);
    try {
      const result = await api(`/api/workflows/${encodeURIComponent(record.workflow_id)}/publish`, { method: 'POST' });
      notify('资产已成功发布！');
      selectedId = null;
      workspace.innerHTML = `
        <div class="empty-state">
          <div class="reticle">✓</div>
          <h2>资产已发布</h2>
          <p>完整的多视角、多状态资产套件已保存到 approved 目录。</p>
          <p style="font-size:12px;margin-top:8px">${escapeHtml(result.approved_dir)}</p>
        </div>`;
      await refreshListOnly();
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  });
}

// ─── Workflow creation ────────────────────────────────────────────────────────
async function createWorkflow(event) {
  event.preventDefault();
  setBusy(true);
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.width = Number(values.width);
    values.height = Number(values.height);
    values.provider = 'agnes';
    generationController = new AbortController();
    const data = await api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(values),
      signal: generationController.signal
    });
    dialog.close();
    event.currentTarget.reset();
    selectedId = data.workflow_id;
    notify('需求已创建，概念图生成中');
    await refresh();
  } catch (error) {
    notify(error.name === 'AbortError' ? '已取消生成' : error.message);
  } finally {
    generationController = null;
    showGenerationProgress(false);
    setBusy(false);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setBusy(value) {
  document.body.classList.toggle('loading', value);
}

function showGenerationProgress(visible) {
  const panel = document.querySelector('#generation-progress');
  const elapsed = document.querySelector('#elapsed');
  panel.hidden = !visible;
  clearInterval(elapsedTimer);
  if (!visible) return;
  const startedAt = Date.now();
  elapsed.textContent = '0';
  elapsedTimer = setInterval(() => {
    elapsed.textContent = String(Math.floor((Date.now() - startedAt) / 1000));
  }, 1000);
}

async function loadCameraPresets() {
  try {
    cameraPresets = await api('/api/camera-presets');
    const select = document.querySelector('#create-camera');
    if (select) {
      select.innerHTML = Object.entries(cameraPresets).map(([id, preset]) => 
        `<option value="${escapeHtml(id)}">${escapeHtml(preset.label)}</option>`
      ).join('');
      select.value = 'end_profile';
      updateCreateCameraHelp();
    }
  } catch (error) {
    notify(`视角预设加载失败：${error.message}`);
  }
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function stageName(stage) {
  const names = {
    brief: '需求',
    concept: '概念',
    view_select: '视角选择',
    view_generate: '视角生成',
    view_review: '视角审核',
    state_generate: '状态变体',
    qc: 'QC',
    publish: '发布'
  };
  return names[stage] || stage;
}

function statusName(status) {
  const names = {
    PENDING: '待处理',
    IN_PROGRESS: '进行中',
    PENDING_REVIEW: '待审核',
    APPROVED: '已批准',
    REJECTED: '已拒绝',
    COMPLETE: '已完成'
  };
  return names[status] || status;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function updateCreateCameraHelp() {
  const selected = document.querySelector('#create-camera')?.value;
  const help = document.querySelector('#create-camera-help');
  if (help) help.textContent = cameraPresets[selected]?.description || '';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadCameraPresets();
refreshGodotStatus();
refresh();

// ─── Godot status ─────────────────────────────────────────────────────────────
async function refreshGodotStatus() {
  try {
    const data = await api('/api/godot-config');
    renderGodotStatus(data.status, data.config);
  } catch (e) {
    console.warn('Failed to load Godot status:', e);
  }
}

function renderGodotStatus(status, config) {
  const container = document.querySelector('#godot-status');
  if (!container) return;

  const icon = status.available ? '✓' : '✗';
  const color = status.available ? 'var(--success)' : 'var(--destructive)';
  const btnText = status.available ? '修改配置' : '手动配置';

  container.innerHTML = `
    <div class="godot-status" style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--muted);border-radius:6px;margin-top:16px;">
      <span style="font-size:20px">${icon}</span>
      <div style="flex:1">
        <div style="font-weight:600;color:${color}">Godot 4</div>
        <div style="font-size:12px;color:var(--muted-foreground)">${status.note || '未检测到 Godot 可执行文件'}</div>
        ${status.executable ? `<div style="font-size:11px;color:var(--muted-foreground);margin-top:2px">${status.executable}</div>` : ''}
      </div>
      <button id="configure-godot" class="ghost" style="font-size:12px">${btnText}</button>
    </div>
  `;

  document.querySelector('#configure-godot')?.addEventListener('click', () => showGodotConfigDialog(status, config));
}

function showGodotConfigDialog(currentStatus, currentConfig) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>配置 Godot 4</h3>
        <button class="close">×</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--muted-foreground);font-size:13px;margin-bottom:16px">
          指定 Godot 4 可执行文件路径。支持 Windows 自动检测，也支持手动输入完整路径。
        </p>
        <div class="form-group">
          <label>Godot 可执行文件路径</label>
          <input type="text" id="godot-path-input" placeholder="D:\\Godot_v4.7.2-stable_win64_console.exe" value="${currentConfig?.executablePath || ''}" style="width:100%">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="godot-require-publish" ${currentConfig?.requireForPublish !== false ? 'checked' : ''}>
            发布时必需 Godot 验证
          </label>
        </div>
        <div id="godot-detect-result" style="margin-top:12px;font-size:13px"></div>
      </div>
      <div class="modal-footer">
        <button class="ghost" id="godot-detect-btn">重新检测</button>
        <button class="primary" id="godot-save-btn">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#godot-detect-btn')?.addEventListener('click', async () => {
    try {
      const status = await api('/api/godot/detect');
      const result = overlay.querySelector('#godot-detect-result');
      const icon = status.available ? '✓' : '✗';
      const color = status.available ? 'var(--success)' : 'var(--destructive)';
      result.innerHTML = `<span style="color:${color}">${icon} ${status.note || '未找到 Godot'}</span>`;
    } catch (e) {
      overlay.querySelector('#godot-detect-result').innerHTML = `<span style="color:var(--destructive)">检测失败: ${e.message}</span>`;
    }
  });

  overlay.querySelector('#godot-save-btn')?.addEventListener('click', async () => {
    const pathInput = overlay.querySelector('#godot-path-input').value.trim();
    const requirePublish = overlay.querySelector('#godot-require-publish').checked;
    try {
      const result = await api('/api/godot-config', {
        method: 'POST',
        body: JSON.stringify({ executablePath: pathInput || null, requireForPublish: requirePublish }),
      });
      overlay.remove();
      renderGodotStatus(result.status, result.config);
      notify('Godot 配置已保存');
    } catch (e) {
      notify('保存失败: ' + e.message);
    }
  });
}
