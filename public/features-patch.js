// ============================================================
//  SprintForge v3.0 — features-patch.js
//  Patches existing renders to show dependencies, locked tasks,
//  delay badges, tentative dates, dependency selector in modal
// ============================================================

const _origRenderTaskCard = renderTaskCard;
renderTaskCard = function(t) {
  const blocked = isTaskBlocked(t.id);
  const blockers = getBlockingTasks(t.id);
  const r = getResource(t.assigneeId);
  const avatarHtml = r
    ? `<div class="task-assignee" style="background:${r.color}22;color:${r.color}">${r.initials}</div>`
    : '';
  const pct = t.estimatedHours
    ? Math.min(100, Math.round(((t.loggedHours||0) / t.estimatedHours) * 100))
    : 0;
  const tent = taskTentativeDate(t.id);
  const tStatus = tentativeStatus(tent, getSprint(t.sprintId)?.endDate);
  const delayCount = (t.delayReasons||[]).length;
  const scopeBadge = t.scopeAddition ? '<span class="scope-pill">SCOPE+</span>' : '';

  // Overlay always has pointer-events:none so card click always fires
  const lockOverlay = blocked
    ? `<div class="task-lock-overlay">
        <span class="lock-icon">🔒</span>
        <span class="lock-msg">Waiting on: ${blockers.map(b=>escHtml(b.title)).join(', ')}</span>
        <span class="lock-edit-hint">Click to view &amp; edit</span>
      </div>`
    : '';

  return `<div class="task-card priority-${t.priority} ${blocked?'task-locked':''}" onclick="openTaskDetail('${t.id}')" title="${blocked?'Dependency blocked — click to edit':''}">
    ${lockOverlay}
    <div class="task-card-title">${escHtml(t.title)} ${scopeBadge}</div>
    ${delayCount > 0 ? `<div class="delay-pill">🚧 ${delayCount} delay reason${delayCount>1?'s':''}</div>` : ''}
    <div class="task-card-footer">
      <span class="task-type-badge type-${t.type}">${t.type}</span>
      ${avatarHtml}
      <div class="task-hrs">⏱ <span>${t.loggedHours||0}</span>/${t.estimatedHours||0}h</div>
    </div>
    ${tent && t.status !== 'done' ? `<div class="task-tent tent-${tStatus}">🗓 ${fmt(tent)}</div>` : ''}
    ${pct > 0 ? `<div style="margin-top:6px"><div style="height:2px;background:var(--surface2);border-radius:99px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:var(--green);border-radius:99px"></div></div></div>` : ''}
  </div>`;
};

// ── PATCH: openTaskDetail — show dependency info + delay button ─
const _origOpenTaskDetail = openTaskDetail;
openTaskDetail = function(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const r = getResource(t.assigneeId);
  const s = getSprint(t.sprintId);
  const pct = t.estimatedHours ? Math.min(100, Math.round(((t.loggedHours||0)/t.estimatedHours)*100)) : 0;
  const fillColor = pct > 90 ? 'var(--green)' : pct > 50 ? 'var(--yellow)' : 'var(--accent2)';
  const tent = taskTentativeDate(taskId);
  const tStatus = tentativeStatus(tent, s?.endDate);
  const isBlocked = isTaskBlocked(taskId);
  const blockers = getBlockingTasks(taskId);
  const dependents = getDependentTasks(taskId);

  const moveButtons = STATUSES.filter(st => st !== t.status).map(st =>
    `<button class="btn-sm" onclick="moveTask('${t.id}','${st}')">→ ${STATUS_LABEL[st]}</button>`
  ).join('');

  const depInfo = t.dependsOn && t.dependsOn.length
    ? `<div class="dep-info-section">
        <div class="task-meta-label">Depends On</div>
        ${t.dependsOn.map(id => {
          const dep = state.tasks.find(x => x.id === id);
          return dep ? `<div class="dep-tag ${dep.status==='done'?'dep-done':'dep-pending'}">
            ${dep.status==='done'?'✓':'⏳'} ${escHtml(dep.title)}
          </div>` : '';
        }).join('')}
      </div>` : '';

  const depByInfo = dependents.length
    ? `<div class="dep-info-section">
        <div class="task-meta-label">Blocking</div>
        ${dependents.map(d => `<div class="dep-tag dep-blocking">${escHtml(d.title)}</div>`).join('')}
      </div>` : '';

  const delaySection = (t.delayReasons||[]).length
    ? `<div class="delay-history" style="margin-top:12px">
        <div class="delay-history-title">Delay Reasons (${t.delayReasons.length})</div>
        ${t.delayReasons.map(dr => `<div class="delay-entry">
          <span class="delay-type-chip">${escHtml(dr.type)}</span>
          <span class="delay-meta">${escHtml(dr.addedBy||'')} · ${fmt(dr.date)}</span>
          <p class="delay-desc">${escHtml(dr.description)}</p>
          ${dr.expectedResolution ? `<span class="delay-resolution">Expected: ${fmt(dr.expectedResolution)}</span>` : ''}
        </div>`).join('')}
      </div>` : '';

  openModal(`<div class="modal-content">
    <div class="task-detail-header">
      <div class="task-detail-type-priority">
        <span class="task-type-badge type-${t.type}">${t.type}</span>
        <span class="priority-chip p-${t.priority}">${t.priority}</span>
        <span class="info-chip">${escHtml(s?.name||'Unknown Sprint')}</span>
        ${t.scopeAddition ? '<span class="scope-pill">SCOPE+</span>' : ''}
        ${isBlocked ? '<span class="locked-badge">🔒 DEP BLOCKED</span>' : ''}
      </div>
      <div class="task-detail-title">${escHtml(t.title)}</div>
      ${t.description ? `<div class="task-detail-desc">${escHtml(t.description)}</div>` : ''}
      ${tent ? `<div class="tent-date-detail tent-${tStatus}">
        🗓 Tentative completion: <strong>${fmt(tent)}</strong>
        ${tStatus==='overdue'?' — ⚠ Past sprint end date':tStatus==='at-risk'?' — ⚡ At risk':''}
      </div>` : ''}
    </div>

    <div class="task-meta-grid">
      <div class="task-meta-item"><div class="task-meta-label">Assignee</div>
        <div class="task-meta-value" style="font-size:13px">
          ${r ? `<span style="color:${r.color}">${r.initials}</span> ${r.name}` : '—'}
        </div></div>
      <div class="task-meta-item"><div class="task-meta-label">Status</div>
        <div class="task-meta-value" style="font-size:13px">${STATUS_LABEL[t.status]}</div></div>
      <div class="task-meta-item"><div class="task-meta-label">Estimated</div>
        <div class="task-meta-value">${t.estimatedHours||0}<span style="font-size:11px;color:var(--text3)">h</span></div></div>
      <div class="task-meta-item"><div class="task-meta-label">Logged</div>
        <div class="task-meta-value">${t.loggedHours||0}<span style="font-size:11px;color:var(--text3)">h</span></div></div>
      <div class="task-meta-item"><div class="task-meta-label">Story Points</div>
        <div class="task-meta-value">${t.storyPoints||0}</div></div>
      <div class="task-meta-item"><div class="task-meta-label">Remaining</div>
        <div class="task-meta-value" style="color:var(--accent)">
          ${Math.max(0,(t.estimatedHours||0)-(t.loggedHours||0))}<span style="font-size:11px;color:var(--text3)">h</span>
        </div></div>
    </div>

    ${depInfo}${depByInfo}

    <div class="task-progress-section">
      <div class="task-progress-header"><span>Progress</span><span>${pct}%</span></div>
      <div class="task-progress-track">
        <div class="task-progress-fill" style="width:${pct}%;background:${fillColor}"></div>
      </div>
    </div>

    <div style="margin-top:16px">
      <div class="task-meta-label" style="margin-bottom:8px">Update Logged Hours</div>
      <div class="hours-logged-section">
        <span class="hours-logged-label">Logged:</span>
        <input class="hours-logged-input" type="number" id="det-log" min="0" step="0.5" value="${t.loggedHours||0}">
        <span class="hours-logged-label">h</span>
        <button class="btn-sm accent" style="margin-left:auto" onclick="updateLoggedHours('${t.id}')">Update</button>
      </div>
    </div>

    <div class="task-status-actions">
      <span style="font-size:10px;font-family:var(--mono);color:var(--text3);margin-right:4px">MOVE TO:</span>
      ${moveButtons}
    </div>

    ${delaySection}

    <div class="form-actions">
      <button class="btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn-sm" onclick="closeModal();openDelayReasonModal('${t.id}')">🚧 Log Delay</button>
      <button class="btn-sm danger" onclick="confirmDeleteTask('${t.id}')">Delete</button>
      <button class="btn-primary" onclick="closeModal();openTaskModal('${t.sprintId}','${t.status}','${t.id}')">Edit Task</button>
    </div>
  </div>`);
};

// ── PATCH: openTaskModal — add dependency selector ────────────
const _origOpenTaskModal = openTaskModal;
openTaskModal = function(sprintId, defaultStatus='todo', taskId=null) {
  const t = taskId ? state.tasks.find(x => x.id === taskId) : null;
  const title = t ? 'Edit Task' : 'New Task';
  const resOpts = state.resources.map(r =>
    `<option value="${r.id}" ${(t?.assigneeId||'')==r.id?'selected':''}>${r.name} · ${r.role}</option>`
  ).join('');
  const prioOpts = PRIORITIES.map(p =>
    `<option value="${p}" ${(t?.priority||'medium')===p?'selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`
  ).join('');
  const typeOpts = TASK_TYPES.map(ty =>
    `<option value="${ty}" ${(t?.type||'story')===ty?'selected':''}>${ty.charAt(0).toUpperCase()+ty.slice(1)}</option>`
  ).join('');
  const statusOpts = STATUSES.map(st =>
    `<option value="${st}" ${(t?.status||defaultStatus)===st?'selected':''}>${STATUS_LABEL[st]}</option>`
  ).join('');
  const sprintOpts = state.sprints.map(s =>
    `<option value="${s.id}" ${(t?.sprintId||sprintId)===s.id?'selected':''}>${s.name}</option>`
  ).join('');
  const activeSprint = getSprint(sprintId);
  const isScopeWarn = !taskId && activeSprint?.status === 'active';
  const depSelector = renderDependencySelector(sprintId, taskId||'', t?.dependsOn||[]);

  openModal(`<div class="modal-content">
    <div class="modal-title">${title}</div>
    <div class="modal-sub">${t ? `Task ID: ${t.id}` : 'Add a new task to the sprint'}</div>
    ${isScopeWarn ? `<div class="scope-warn-banner">⚠ This sprint is <strong>active</strong> — this task will be flagged as a <strong>scope addition</strong></div>` : ''}
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input class="form-input" id="ft-title" value="${escHtml(t?.title||'')}" placeholder="Task description...">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="ft-desc" placeholder="Optional details...">${escHtml(t?.description||'')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Sprint</label>
          <select class="form-select" id="ft-sprint">${sprintOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Assignee</label>
          <select class="form-select" id="ft-assignee">
            <option value="">Unassigned</option>${resOpts}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-select" id="ft-type">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select class="form-select" id="ft-priority">${prioOpts}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" id="ft-status">${statusOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Story Points</label>
          <input class="form-input" type="number" id="ft-sp" min="0" value="${t?.storyPoints||1}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Estimated Hours *</label>
          <input class="form-input" type="number" id="ft-est" min="0" step="0.5" value="${t?.estimatedHours||4}">
        </div>
        <div class="form-group">
          <label class="form-label">Logged Hours</label>
          <input class="form-input" type="number" id="ft-log" min="0" step="0.5" value="${t?.loggedHours||0}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Dependencies (Blocked By)</label>
        <div class="dep-selector">${depSelector}</div>
      </div>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveTask('${t?.id||''}','${sprintId}')">
          ${t ? 'Save Changes' : 'Add Task'}
        </button>
      </div>
    </div>
  </div>`);
};

// ── PATCH: renderView to include new tabs ─────────────────────
const _origRenderView = renderView;
renderView = function(view) {
  if (view === 'dashboard')  renderDashboard();
  if (view === 'sprints')    renderSprints();
  if (view === 'timeline')   renderTimeline();
  if (view === 'resources')  renderResources();
  if (view === 'reports')    renderReports();
  if (view === 'logs')       renderLogs();
};

// ── PATCH: setView to update aria ────────────────────────────
const _origSetView = setView;
setView = function(view) {
  state.activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.add('active');
  const tabEl  = document.querySelector(`.nav-tab[data-view="${view}"]`);
  if (tabEl) { tabEl.classList.add('active'); tabEl.setAttribute('aria-selected','true'); }
  renderView(view);
  checkAndShowBanners();
};

// ── PATCH: Dashboard — add scope/overload insights panel ──────
const _baseRenderDashboard = renderDashboard;
renderDashboard = function() {
  _baseRenderDashboard();
  const el = document.getElementById('view-dashboard');
  const dashGrid = el.querySelector('.dash-grid');
  if (!dashGrid) return;

  // Active sprint burndown (existing patch from app.js may add this — skip duplicate)
  // Add insights panel
  const activeSprints = state.sprints.filter(s => s.status === 'active');
  const insights = [];

  activeSprints.forEach(s => {
    const tent = sprintTentativeEnd(s.id);
    const ts = tentativeStatus(tent, s.endDate);
    if (ts === 'overdue')  insights.push(`<div class="insight-item insight-red">🔴 <b>${escHtml(s.name)}</b>: likely to overrun by ${daysBetween(s.endDate, tent)} days</div>`);
    if (ts === 'at-risk')  insights.push(`<div class="insight-item insight-yellow">🟡 <b>${escHtml(s.name)}</b>: at risk — projected end ${fmt(tent)}</div>`);
    const scope = sprintScopeAdditions(s.id);
    if (scope.length)      insights.push(`<div class="insight-item insight-orange">📈 <b>${escHtml(s.name)}</b>: ${scope.length} scope additions (+${scopeAddedHours(s.id)}h)</div>`);
    const blockedTasks = sprintTasks(s.id).filter(t => t.status === 'blocked');
    if (blockedTasks.length) insights.push(`<div class="insight-item insight-red">🚧 <b>${escHtml(s.name)}</b>: ${blockedTasks.length} blocked task(s)</div>`);
  });

  if (insights.length) {
    const panel = document.createElement('div');
    panel.className = 'dash-panel insights-panel';
    panel.innerHTML = `<div class="dash-panel-title">⚡ Sprint Insights</div>${insights.join('')}`;
    dashGrid.appendChild(panel);
  }

  // ── Resource Availability Panel ──
  const availList = resourceAvailabilitySorted();
  if (availList.length) {
    const rows = availList.map(({ resource: r, free }) => {
      if (!free) return '';
      const statusColor = free.status === 'free' ? 'var(--green)' : free.status === 'soon' ? 'var(--green)' : free.status === 'this-week' ? 'var(--yellow)' : 'var(--accent2)';
      const statusIcon  = free.status === 'free' ? '🟢' : free.status === 'soon' ? '🟢' : free.status === 'this-week' ? '🟡' : '🔵';
      const freeLabel   = free.status === 'free' ? 'Free now' : `Free ${fmt(free.date)}`;
      return `<div class="avail-row" onclick="openAvailabilityModal('${r.id}')">
        <div class="dash-res-avatar" style="background:${r.color}22;color:${r.color};width:30px;height:30px;font-size:10px;font-weight:700;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">${r.initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.name)}</div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${free.taskCount} tasks · ${free.remainingHours}h left</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:700;color:${statusColor}">${statusIcon} ${freeLabel}</div>
          ${free.daysFromNow > 0 ? `<div style="font-size:10px;color:var(--text3)">${free.daysFromNow} days</div>` : ''}
        </div>
      </div>`;
    }).filter(Boolean).join('');

    const availPanel = document.createElement('div');
    availPanel.className = 'dash-panel';
    availPanel.innerHTML = `<div class="dash-panel-title">👥 Resource Availability <span style="font-size:9px;color:var(--text3);font-weight:400">(click for details)</span></div>${rows}`;
    dashGrid.appendChild(availPanel);
  }
};

// ── INIT PATCH ────────────────────────────────────────────────
const _origInit = init;
init = function() {
  _origInit();
  migrateState();
  checkAndShowBanners();

  // Wire up keyboard shortcuts for new tabs
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '5') setView('reports');
    if (e.key === '6') setView('logs');
  });
};

// Re-init to apply patches
init();
