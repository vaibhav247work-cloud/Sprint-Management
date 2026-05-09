// ============================================================
//  SprintForge v3.0 — features-core.js
//  Dependencies · Delay Reasons · Activity Log · Overload · Scope
// ============================================================

// ── STATE MIGRATION ──────────────────────────────────────────
function migrateState() {
  if (!state.activityLog)    state.activityLog    = [];
  if (!state.retrospectives) state.retrospectives = {};
  state.tasks.forEach(t => {
    if (!t.dependsOn)    t.dependsOn    = [];
    if (!t.delayReasons) t.delayReasons = [];
    if (t.scopeAddition  === undefined) t.scopeAddition = false;
    if (t.originalSprint === undefined) t.originalSprint = t.sprintId;
  });
  saveState();
}

// ── ACTIVITY LOG ─────────────────────────────────────────────
const LOG_TYPES = {
  TASK_CREATED   : 'task_created',
  STATUS_CHANGED : 'status_changed',
  HOURS_LOGGED   : 'hours_logged',
  DEPENDENCY_OPEN: 'dependency_open',
  SCOPE_ADDED    : 'scope_added',
  DELAY_REASON   : 'delay_reason',
  SPRINT_STARTED : 'sprint_started',
  SPRINT_DONE    : 'sprint_completed',
  RETRO_SAVED    : 'retro_saved',
};

function addLog(type, data) {
  state.activityLog.unshift({
    id       : genId(),
    type,
    timestamp: new Date().toISOString(),
    ...data,
  });
  // Keep last 500 logs
  if (state.activityLog.length > 500) state.activityLog.length = 500;
  saveState();
}

function logLabel(type) {
  return {
    task_created     : '✦ Task Created',
    status_changed   : '↕ Status Changed',
    hours_logged     : '⏱ Hours Logged',
    dependency_open  : '⛓ Dependency Blocked',
    scope_added      : '⚠ Scope Addition',
    delay_reason     : '🚧 Delay Reason',
    sprint_started   : '🚀 Sprint Started',
    sprint_completed : '🎉 Sprint Completed',
    retro_saved      : '📋 Retrospective Saved',
  }[type] || type;
}

// ── DEPENDENCY ENGINE ─────────────────────────────────────────
function isTaskBlocked(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !t.dependsOn || !t.dependsOn.length) return false;
  return t.dependsOn.some(depId => {
    const dep = state.tasks.find(x => x.id === depId);
    return dep && dep.status !== 'done';
  });
}

function getBlockingTasks(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !t.dependsOn) return [];
  return t.dependsOn
    .map(id => state.tasks.find(x => x.id === id))
    .filter(d => d && d.status !== 'done');
}

function getDependentTasks(taskId) {
  return state.tasks.filter(t => t.dependsOn && t.dependsOn.includes(taskId));
}

// ── SCOPE CREEP ENGINE ────────────────────────────────────────
function sprintOriginalHours(sprintId) {
  return state.tasks
    .filter(t => t.sprintId === sprintId && !t.scopeAddition)
    .reduce((s, t) => s + (t.estimatedHours || 0), 0);
}

function sprintScopeAdditions(sprintId) {
  return state.tasks.filter(t => t.sprintId === sprintId && t.scopeAddition);
}

function scopeAddedHours(sprintId) {
  return sprintScopeAdditions(sprintId).reduce((s, t) => s + (t.estimatedHours || 0), 0);
}

function checkAndShowBanners() {
  renderOverloadBanner();
  renderScopeBanner();
}

function renderOverloadBanner() {
  const banner = document.getElementById('overload-banner');
  if (!banner) return;
  const overloaded = [];
  state.resources.forEach(r => {
    state.sprints.filter(s => s.status === 'active').forEach(s => {
      const alloc = resourceAllocHours(r.id, s.id);
      const cap   = resourceCapacityInSprint(r.id, s.id);
      if (cap > 0 && alloc > cap * 1.05) {
        overloaded.push(`${r.name} (${s.name}: ${alloc}h / ${cap}h cap)`);
      }
    });
  });
  if (overloaded.length) {
    banner.className = 'overload-banner visible';
    banner.innerHTML = `<span class="banner-icon">⚠</span>
      <strong>Resource Overload Detected:</strong> ${overloaded.join(' · ')}
      <button class="banner-dismiss" onclick="this.parentElement.classList.remove('visible')">✕</button>`;
  } else {
    banner.className = 'overload-banner hidden';
  }
}

function renderScopeBanner() {
  const banner = document.getElementById('scope-banner');
  if (!banner) return;
  const activeSprints = state.sprints.filter(s => s.status === 'active');
  const scopeItems = [];
  activeSprints.forEach(s => {
    const added = sprintScopeAdditions(s.id);
    if (added.length) {
      scopeItems.push(`${s.name}: +${added.length} tasks (+${scopeAddedHours(s.id)}h)`);
    }
  });
  if (scopeItems.length) {
    banner.className = 'scope-banner visible';
    banner.innerHTML = `<span class="banner-icon">📈</span>
      <strong>Scope Creep Alert:</strong> ${scopeItems.join(' · ')}
      <button class="banner-dismiss" onclick="this.parentElement.classList.remove('visible')">✕</button>`;
  } else {
    banner.className = 'scope-banner hidden';
  }
}

// ── TENTATIVE COMPLETION DATE ─────────────────────────────────
function taskTentativeDate(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || t.status === 'done') return null;
  const remaining = Math.max(0, (t.estimatedHours || 0) - (t.loggedHours || 0));
  if (!remaining) return null;
  const r = getResource(t.assigneeId);
  const hoursPerDay = r ? r.capacityPerDay : 6;
  const daysNeeded  = Math.ceil(remaining / hoursPerDay);
  const date = new Date();
  let added = 0;
  while (added < daysNeeded) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added++;
  }
  return date.toISOString().slice(0, 10);
}

function sprintTentativeEnd(sprintId) {
  const tasks = sprintTasks(sprintId).filter(t => t.status !== 'done');
  if (!tasks.length) return null;
  const dates = tasks.map(t => taskTentativeDate(t.id)).filter(Boolean);
  if (!dates.length) return null;
  return dates.sort().pop(); // latest tentative date
}

function tentativeStatus(tentDate, endDate) {
  if (!tentDate || !endDate) return 'unknown';
  const diff = daysBetween(endDate, tentDate);
  if (diff <= 0) return 'on-track';
  if (diff <= 3) return 'at-risk';
  return 'overdue';
}

// ── RESOURCE AVAILABILITY ENGINE ─────────────────────────────
/**
 * Returns the date a resource will finish ALL their pending tasks
 * and become fully free for new assignments.
 * Uses: sum of remaining hours across all active/planning sprints
 *       divided by their daily capacity (working days only)
 */
function resourceFreeDate(resourceId) {
  const r = getResource(resourceId);
  if (!r) return null;
  // Only count non-done tasks in active/planning sprints
  const pendingTasks = state.tasks.filter(t =>
    t.assigneeId === resourceId &&
    t.status !== 'done' &&
    t.status !== 'blocked' &&
    (() => { const s = getSprint(t.sprintId); return s && s.status !== 'completed'; })()
  );
  if (!pendingTasks.length) return { date: today(), remainingHours: 0, taskCount: 0, status: 'free' };

  const totalRemaining = pendingTasks.reduce((sum, t) =>
    sum + Math.max(0, (t.estimatedHours || 0) - (t.loggedHours || 0)), 0
  );
  if (!totalRemaining) return { date: today(), remainingHours: 0, taskCount: pendingTasks.length, status: 'free' };

  const hoursPerDay = r.capacityPerDay || 6;
  const daysNeeded  = Math.ceil(totalRemaining / hoursPerDay);
  const date = new Date();
  let added = 0;
  while (added < daysNeeded) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added++;
  }
  const freeDate = date.toISOString().slice(0, 10);
  const daysFromNow = daysBetween(today(), freeDate);
  const status = daysFromNow <= 2 ? 'soon' : daysFromNow <= 7 ? 'this-week' : 'later';
  return { date: freeDate, remainingHours: totalRemaining, taskCount: pendingTasks.length, daysFromNow, status, tasks: pendingTasks };
}

/** Returns a sorted list of all resources by when they become free (earliest first) */
function resourceAvailabilitySorted() {
  return state.resources
    .map(r => ({ resource: r, free: resourceFreeDate(r.id) }))
    .sort((a, b) => {
      if (!a.free || !b.free) return 0;
      return a.free.date.localeCompare(b.free.date);
    });
}

/** Show the Resource Availability modal with full breakdown */
function openAvailabilityModal(resourceId) {
  const r = getResource(resourceId);
  const info = resourceFreeDate(resourceId);
  if (!r || !info) return;

  const taskRows = (info.tasks || []).map(t => {
    const s = getSprint(t.sprintId);
    const remaining = Math.max(0, (t.estimatedHours||0) - (t.loggedHours||0));
    return `<tr>
      <td>${escHtml(t.title)}</td>
      <td><span class="sprint-badge badge-${t.status}" style="font-size:9px">${t.status}</span></td>
      <td style="font-family:var(--mono)">${remaining}h left</td>
      <td style="color:var(--text3);font-size:11px">${escHtml(s?.name||'')}</td>
      <td>${fmt(taskTentativeDate(t.id)) || '—'}</td>
    </tr>`;
  }).join('');

  const statusColor = info.status === 'free' ? 'var(--green)' : info.status === 'soon' ? 'var(--green)' : info.status === 'this-week' ? 'var(--yellow)' : 'var(--accent2)';
  const statusLabel = info.status === 'free' ? '🟢 Available Now' : info.status === 'soon' ? '🟢 Free in 1-2 days' : info.status === 'this-week' ? '🟡 Free this week' : '🔵 Busy for a while';

  openModal(`<div class="modal-content">
    <div class="modal-title">👤 ${escHtml(r.name)}</div>
    <div class="modal-sub">${escHtml(r.role)} · ${r.capacityPerDay}h/day capacity</div>

    <div class="avail-hero" style="background:${statusColor}18;border:1px solid ${statusColor}33;border-radius:14px;padding:18px 20px;margin-bottom:16px;display:flex;align-items:center;gap:16px">
      <div style="font-size:36px">${info.status === 'free' ? '✅' : '⏳'}</div>
      <div style="flex:1">
        <div style="font-size:20px;font-weight:800;color:${statusColor}">${info.status === 'free' ? 'Available Now' : fmt(info.date)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px">${statusLabel}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:24px;font-weight:800;font-family:var(--mono);color:var(--text)">${info.remainingHours}h</div>
        <div style="font-size:11px;color:var(--text3)">remaining work</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      <div class="task-meta-item"><div class="task-meta-label">Tasks Pending</div><div class="task-meta-value">${info.taskCount}</div></div>
      <div class="task-meta-item"><div class="task-meta-label">Hours Remaining</div><div class="task-meta-value">${info.remainingHours}h</div></div>
      <div class="task-meta-item"><div class="task-meta-label">Days Until Free</div><div class="task-meta-value" style="color:${statusColor}">${info.daysFromNow || 0}</div></div>
    </div>

    ${info.tasks?.length ? `
    <div class="report-section-title">Pending Tasks</div>
    <div style="overflow-x:auto">
      <table class="report-table">
        <thead><tr><th>Task</th><th>Status</th><th>Remaining</th><th>Sprint</th><th>Est. Done</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>` : '<div style="color:var(--green);font-size:13px;padding:12px 0">✅ No pending tasks — this resource is free!</div>'}

    <div class="form-actions">
      <button class="btn-ghost" onclick="closeModal()">Close</button>
    </div>
  </div>`);
}


// ── DELAY REASON MODAL ────────────────────────────────────────
const DELAY_TYPES = ['API Delay','Meeting','Dependency','Resource Unavailable','Requirement Change','Technical Debt','Other'];

function openDelayReasonModal(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const typeOpts = DELAY_TYPES.map(d => `<option>${d}</option>`).join('');
  const existing = (t.delayReasons || []).map(dr => `
    <div class="delay-entry">
      <span class="delay-type-chip">${escHtml(dr.type)}</span>
      <span class="delay-meta">${escHtml(dr.addedBy || 'Unknown')} · ${fmt(dr.date)}</span>
      <p class="delay-desc">${escHtml(dr.description)}</p>
      ${dr.expectedResolution ? `<span class="delay-resolution">Expected: ${fmt(dr.expectedResolution)}</span>` : ''}
    </div>`).join('') || '<div style="color:var(--text3);font-size:12px">No delay reasons logged yet</div>';

  openModal(`<div class="modal-content">
    <div class="modal-title">🚧 Log Delay Reason</div>
    <div class="modal-sub">Task: ${escHtml(t.title)}</div>
    ${existing ? `<div class="delay-history"><div class="delay-history-title">Delay History</div>${existing}</div>` : ''}
    <div class="form-grid" style="margin-top:16px">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Delay Type *</label>
          <select class="form-select" id="dr-type">${typeOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Added By</label>
          <select class="form-select" id="dr-by">
            ${state.resources.map(r => `<option value="${r.name}">${r.name}</option>`).join('')}
            <option value="Manager">Manager</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description *</label>
        <textarea class="form-textarea" id="dr-desc" placeholder="Describe the delay in detail..."></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Expected Resolution Date</label>
        <input class="form-input" type="date" id="dr-resolve">
      </div>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveDelayReason('${taskId}')">Log Delay</button>
      </div>
    </div>
  </div>`);
}

function saveDelayReason(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const type = document.getElementById('dr-type').value;
  const desc = document.getElementById('dr-desc').value.trim();
  const by   = document.getElementById('dr-by').value;
  const res  = document.getElementById('dr-resolve').value;
  if (!desc) { showToast('Description is required', 'error'); return; }
  if (!t.delayReasons) t.delayReasons = [];
  const reason = { id: genId(), type, description: desc, addedBy: by, date: today(), expectedResolution: res };
  t.delayReasons.push(reason);
  addLog(LOG_TYPES.DELAY_REASON, { taskId, taskTitle: t.title, type, addedBy: by, description: desc });
  saveState();
  closeModal();
  showToast('Delay reason logged ✓', 'success');
  renderView(state.activeView);
}

// ── DEPENDENCY SELECTOR IN TASK MODAL ────────────────────────
function renderDependencySelector(sprintId, currentTaskId, selectedDeps) {
  const available = state.tasks.filter(t =>
    t.sprintId === sprintId && t.id !== currentTaskId
  );
  if (!available.length) return '<div style="color:var(--text3);font-size:12px;padding:8px 0">No other tasks in this sprint</div>';
  return available.map(t => {
    const checked = selectedDeps.includes(t.id) ? 'checked' : '';
    return `<label class="dep-checkbox-row">
      <input type="checkbox" class="dep-checkbox" value="${t.id}" ${checked}>
      <span class="dep-task-name">${escHtml(t.title)}</span>
      <span class="task-type-badge type-${t.type}">${t.type}</span>
    </label>`;
  }).join('');
}

function getSelectedDeps() {
  return [...document.querySelectorAll('.dep-checkbox:checked')].map(el => el.value);
}

// Patch saveTask to handle dependencies and scope addition
const _origSaveTask = saveTask;
saveTask = function(id, defaultSprintId) {
  const title   = document.getElementById('ft-title')?.value.trim();
  const sprint  = document.getElementById('ft-sprint')?.value;
  const assignee= document.getElementById('ft-assignee')?.value;
  const type    = document.getElementById('ft-type')?.value;
  const prio    = document.getElementById('ft-priority')?.value;
  const status  = document.getElementById('ft-status')?.value;
  const sp      = parseInt(document.getElementById('ft-sp')?.value) || 0;
  const est     = parseFloat(document.getElementById('ft-est')?.value) || 0;
  const log     = parseFloat(document.getElementById('ft-log')?.value) || 0;
  const desc    = document.getElementById('ft-desc')?.value.trim();
  const deps    = getSelectedDeps();

  if (!title) { showToast('Task title is required', 'error'); return; }
  if (!sprint) { showToast('Select a sprint', 'error'); return; }

  const sprintObj = getSprint(sprint);
  const isActiveSprint = sprintObj && sprintObj.status === 'active';

  if (id) {
    const t = state.tasks.find(x => x.id === id);
    Object.assign(t, { title, description: desc, sprintId: sprint, assigneeId: assignee,
      type, priority: prio, status, storyPoints: sp, estimatedHours: est, loggedHours: log, dependsOn: deps });
    addLog(LOG_TYPES.STATUS_CHANGED, { taskId: id, taskTitle: title, newStatus: status, assignee });
  } else {
    const newTask = {
      id: 't' + genId(), sprintId: sprint, title, description: desc,
      type, priority: prio, status, assigneeId: assignee,
      estimatedHours: est, loggedHours: log, storyPoints: sp,
      dependsOn: deps, delayReasons: [], scopeAddition: isActiveSprint, originalSprint: sprint,
    };
    state.tasks.push(newTask);
    addLog(LOG_TYPES.TASK_CREATED, { taskId: newTask.id, taskTitle: title, sprintId: sprint,
      assignee, estimatedHours: est });
    if (isActiveSprint) {
      addLog(LOG_TYPES.SCOPE_ADDED, { taskId: newTask.id, taskTitle: title, sprintId: sprint,
        estimatedHours: est });
      showToast(`⚠ Scope addition detected: +${est}h`, 'info');
    }
  }
  saveState();
  closeModal();
  showToast(id ? 'Task updated ✓' : 'Task added ✓', 'success');
  checkAndShowBanners();
  renderView(state.activeView);
};

// Patch moveTask to log and trigger delay reason if blocked
const _baseMoveTask = moveTask;
moveTask = function(taskId, newStatus) {
  const t = state.tasks.find(x => x.id === taskId);
  const oldStatus = t ? t.status : '';
  if (t) { t.status = newStatus; saveState(); }
  addLog(LOG_TYPES.STATUS_CHANGED, {
    taskId, taskTitle: t?.title, oldStatus, newStatus,
    assignee: getResource(t?.assigneeId)?.name || 'Unassigned'
  });
  showToast(`Moved to ${STATUS_LABEL[newStatus]} ✓`, 'success');
  closeModal();
  checkAndShowBanners();
  renderView(state.activeView);
  if (newStatus === 'done' && t) {
    setTimeout(() => checkSprintCompletion(t.sprintId), 300);
    // Unblock dependents
    getDependentTasks(taskId).forEach(dep => {
      if (!isTaskBlocked(dep.id)) {
        addLog(LOG_TYPES.DEPENDENCY_OPEN, { taskId: dep.id, taskTitle: dep.title, unlockedBy: t.title });
        showToast(`🔓 ${dep.title} is now unblocked!`, 'info');
      }
    });
  }
  if (newStatus === 'blocked') {
    setTimeout(() => openDelayReasonModal(taskId), 400);
  }
};

// Patch updateLoggedHours to log
const _baseUpdateLogged = updateLoggedHours;
updateLoggedHours = function(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  const newHrs = parseFloat(document.getElementById('det-log')?.value) || 0;
  if (t) {
    const old = t.loggedHours || 0;
    t.loggedHours = newHrs;
    addLog(LOG_TYPES.HOURS_LOGGED, {
      taskId, taskTitle: t.title,
      oldHours: old, newHours: newHrs, delta: newHrs - old,
      assignee: getResource(t.assigneeId)?.name || 'Unassigned'
    });
    saveState();
    showToast('Hours updated ✓', 'success');
    closeModal();
    checkAndShowBanners();
    renderView(state.activeView);
  }
};

// Patch saveSprint to log
const _origSaveSprint = saveSprint;
saveSprint = function(id) {
  const statusBefore = id ? getSprint(id)?.status : null;
  _origSaveSprint(id);
  const s = id ? getSprint(id) : state.sprints[state.sprints.length - 1];
  if (!id) {
    addLog(LOG_TYPES.SPRINT_STARTED, { sprintId: s?.id, sprintName: s?.name });
  } else if (statusBefore !== s?.status && s?.status === 'active') {
    addLog(LOG_TYPES.SPRINT_STARTED, { sprintId: s.id, sprintName: s.name });
  } else if (statusBefore !== s?.status && s?.status === 'completed') {
    addLog(LOG_TYPES.SPRINT_DONE, { sprintId: s.id, sprintName: s.name });
  }
  checkAndShowBanners();
};
