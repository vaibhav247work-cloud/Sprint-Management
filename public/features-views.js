// ============================================================
//  SprintForge v3.0 — features-views.js
//  Reports Tab · Logs Tab · Retrospective
// ============================================================

// ── REPORTS VIEW ──────────────────────────────────────────────
function renderReports() {
  const el = document.getElementById('view-reports');
  const sprintOpts = state.sprints.map(s =>
    `<option value="${s.id}">${escHtml(s.name)} [${s.status}]</option>`
  ).join('');

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Reports & Analytics</div>
        <div class="section-subtitle">Auto-generated sprint insights · estimation accuracy · retrospectives</div>
      </div>
      <div style="display:flex;gap:8px">
        <select class="form-select" id="report-sprint-select" onchange="renderSprintReport(this.value)" style="width:260px">
          <option value="">— Select Sprint —</option>${sprintOpts}
        </select>
        <button class="btn-ghost" onclick="exportReportCSV()">Export CSV</button>
        <button class="btn-primary" onclick="printReport()">Print Report</button>
      </div>
    </div>
    <div id="report-overview">${renderAllSprintsOverview()}</div>
    <div id="report-detail"></div>`;
}

function renderAllSprintsOverview() {
  const rows = state.sprints.map(s => {
    const tasks = sprintTasks(s.id);
    const est   = sprintTotalEstHours(s.id);
    const logged= sprintLoggedHours(s.id);
    const done  = tasks.filter(t => t.status === 'done').length;
    const scope = sprintScopeAdditions(s.id).length;
    const overrun = logged > est ? `<span class="badge-overrun">+${(logged-est)}h over</span>` : `<span class="badge-ok">On budget</span>`;
    const pct   = sprintProgress(s.id);
    const tent  = sprintTentativeEnd(s.id);
    const tStatus = tentativeStatus(tent, s.endDate);
    return `<tr>
      <td><span class="sprint-badge badge-${s.status}" style="font-size:9px">${s.status}</span> ${escHtml(s.name)}</td>
      <td>${tasks.length}</td>
      <td>${done}</td>
      <td>${scope > 0 ? `<span class="badge-scope">+${scope}</span>` : '—'}</td>
      <td>${est}h est · ${logged}h logged</td>
      <td>${overrun}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:80px;height:5px;background:var(--surface2);border-radius:99px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:var(--green);border-radius:99px"></div>
          </div>
          <span style="font-size:11px;font-family:var(--mono)">${pct}%</span>
        </div>
      </td>
      <td>
        ${tent ? `<span class="tent-date tent-${tStatus}">${fmt(tent)}</span>` : '—'}
      </td>
      <td>
        <button class="btn-sm" onclick="document.getElementById('report-sprint-select').value='${s.id}';renderSprintReport('${s.id}')">View</button>
        ${s.status === 'completed' ? `<button class="btn-sm accent" onclick="openRetroModal('${s.id}')">Retro</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `<div class="report-card" style="margin-bottom:24px">
    <div class="report-card-title">Sprint Overview — All Sprints</div>
    <div style="overflow-x:auto">
      <table class="report-table">
        <thead><tr>
          <th>Sprint</th><th>Tasks</th><th>Done</th><th>Scope+</th>
          <th>Hours</th><th>Budget</th><th>Progress</th><th>Tent. End</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:var(--text3)">No sprints yet</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

function renderSprintReport(sprintId) {
  const el = document.getElementById('report-detail');
  if (!sprintId) { el.innerHTML = ''; return; }
  const s = getSprint(sprintId);
  if (!s) return;

  const tasks   = sprintTasks(sprintId);
  const est     = sprintTotalEstHours(sprintId);
  const logged  = sprintLoggedHours(sprintId);
  const origEst = sprintOriginalHours(sprintId);
  const scopeHrs= scopeAddedHours(sprintId);
  const varPct  = est > 0 ? Math.round(((logged - est) / est) * 100) : 0;
  const retro   = state.retrospectives[sprintId];

  // Resource breakdown
  const resRows = state.resources.map(r => {
    const rTasks = tasks.filter(t => t.assigneeId === r.id);
    if (!rTasks.length) return '';
    const rEst  = rTasks.reduce((s,t) => s+(t.estimatedHours||0), 0);
    const rLog  = rTasks.reduce((s,t) => s+(t.loggedHours||0), 0);
    const ratio = rEst ? ((rLog/rEst)*100).toFixed(0) : 0;
    const perf  = ratio <= 100 ? 'ok' : ratio <= 120 ? 'warn' : 'over';
    return `<tr>
      <td><span style="color:${r.color}">${r.initials}</span> ${escHtml(r.name)}</td>
      <td>${rTasks.length}</td>
      <td>${rEst}h</td>
      <td>${rLog}h</td>
      <td><span class="perf-badge perf-${perf}">${ratio}%</span></td>
      <td>${rTasks.filter(t=>t.status==='done').length} / ${rTasks.length}</td>
    </tr>`;
  }).filter(Boolean).join('');

  // Task breakdown
  const taskRows = tasks.map(t => {
    const r = getResource(t.assigneeId);
    const over = (t.loggedHours||0) > (t.estimatedHours||0);
    const scope = t.scopeAddition ? '<span class="badge-scope" style="font-size:8px">SCOPE+</span>' : '';
    const delays = (t.delayReasons||[]).length;
    return `<tr>
      <td>${escHtml(t.title)} ${scope}</td>
      <td><span class="task-type-badge type-${t.type}">${t.type}</span></td>
      <td><span class="priority-chip p-${t.priority}" style="font-size:9px">${t.priority}</span></td>
      <td>${r ? escHtml(r.name) : '—'}</td>
      <td>${t.estimatedHours||0}h</td>
      <td class="${over?'cell-over':'cell-ok'}">${t.loggedHours||0}h</td>
      <td><span class="sprint-badge badge-${t.status}" style="font-size:9px">${t.status}</span></td>
      <td>${delays > 0 ? `<span class="badge-delay">${delays} delay(s)</span>` : '—'}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<div class="report-card" id="printable-report">
    <div class="report-card-title">Sprint Report — ${escHtml(s.name)}</div>
    <div class="report-meta-row">
      <div class="report-meta-item"><div class="stat-label">Period</div><div class="report-meta-val">${fmt(s.startDate)} → ${fmt(s.endDate)}</div></div>
      <div class="report-meta-item"><div class="stat-label">Original Estimate</div><div class="report-meta-val">${origEst}h</div></div>
      <div class="report-meta-item"><div class="stat-label">Scope Added</div><div class="report-meta-val ${scopeHrs>0?'text-warn':''}">${scopeHrs > 0 ? '+'+scopeHrs+'h' : '0h'}</div></div>
      <div class="report-meta-item"><div class="stat-label">Total Estimated</div><div class="report-meta-val">${est}h</div></div>
      <div class="report-meta-item"><div class="stat-label">Total Logged</div><div class="report-meta-val">${logged}h</div></div>
      <div class="report-meta-item"><div class="stat-label">Variance</div><div class="report-meta-val ${varPct>0?'text-red':'text-green'}">${varPct > 0 ? '+' : ''}${varPct}%</div></div>
    </div>

    <div class="report-section-title">Resource Performance</div>
    <table class="report-table" style="margin-bottom:20px">
      <thead><tr><th>Resource</th><th>Tasks</th><th>Estimated</th><th>Logged</th><th>Efficiency</th><th>Completion</th></tr></thead>
      <tbody>${resRows || '<tr><td colspan="6" style="color:var(--text3);text-align:center">No resources assigned</td></tr>'}</tbody>
    </table>

    <div class="report-section-title">Task Breakdown</div>
    <table class="report-table" style="margin-bottom:20px">
      <thead><tr><th>Task</th><th>Type</th><th>Priority</th><th>Assignee</th><th>Estimated</th><th>Logged</th><th>Status</th><th>Delays</th></tr></thead>
      <tbody>${taskRows || '<tr><td colspan="8" style="color:var(--text3);text-align:center">No tasks</td></tr>'}</tbody>
    </table>

    ${retro ? renderRetroSummary(retro) : `<div class="retro-cta">
      <span>No retrospective yet for this sprint.</span>
      <button class="btn-primary" onclick="openRetroModal('${sprintId}')">Start Retrospective</button>
    </div>`}
  </div>`;
}

function renderRetroSummary(retro) {
  return `<div class="report-section-title">Retrospective</div>
    <div class="retro-summary-grid">
      <div class="retro-box retro-good"><div class="retro-box-title">✅ What went well</div><p>${escHtml(retro.wentWell||'—')}</p></div>
      <div class="retro-box retro-bad"><div class="retro-box-title">❌ What went wrong</div><p>${escHtml(retro.wentWrong||'—')}</p></div>
      <div class="retro-box retro-improve"><div class="retro-box-title">🔧 Improvements</div><p>${escHtml(retro.improvements||'—')}</p></div>
      <div class="retro-box retro-actions"><div class="retro-box-title">📋 Action Items</div><p>${escHtml(retro.actionItems||'—')}</p></div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text3)">Saved: ${fmt(retro.savedAt)}</div>`;
}

// ── RETROSPECTIVE MODAL ───────────────────────────────────────
function openRetroModal(sprintId) {
  const s = getSprint(sprintId);
  const existing = state.retrospectives[sprintId] || {};
  openModal(`<div class="modal-content">
    <div class="modal-title">📋 Sprint Retrospective</div>
    <div class="modal-sub">${escHtml(s?.name || sprintId)}</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label retro-label good">✅ What went well?</label>
        <textarea class="form-textarea retro-textarea" id="rt-good" placeholder="Things that worked, wins, achievements...">${escHtml(existing.wentWell||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label retro-label bad">❌ What went wrong?</label>
        <textarea class="form-textarea retro-textarea" id="rt-bad" placeholder="Blockers, issues, failures...">${escHtml(existing.wentWrong||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label retro-label improve">🔧 What to improve?</label>
        <textarea class="form-textarea retro-textarea" id="rt-improve" placeholder="Process changes, tooling improvements...">${escHtml(existing.improvements||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label retro-label actions">📋 Action items for next sprint</label>
        <textarea class="form-textarea retro-textarea" id="rt-actions" placeholder="Concrete next steps with owners...">${escHtml(existing.actionItems||'')}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveRetro('${sprintId}')">Save Retrospective</button>
      </div>
    </div>
  </div>`);
}

function saveRetro(sprintId) {
  const retro = {
    wentWell    : document.getElementById('rt-good')?.value.trim(),
    wentWrong   : document.getElementById('rt-bad')?.value.trim(),
    improvements: document.getElementById('rt-improve')?.value.trim(),
    actionItems : document.getElementById('rt-actions')?.value.trim(),
    savedAt     : today(),
  };
  state.retrospectives[sprintId] = retro;
  addLog(LOG_TYPES.RETRO_SAVED, { sprintId, sprintName: getSprint(sprintId)?.name });
  saveState();
  closeModal();
  showToast('Retrospective saved ✓', 'success');
  renderView(state.activeView);
}

// ── LOGS VIEW ─────────────────────────────────────────────────
let logFilter = { type: 'all', resource: 'all', sprint: 'all' };

function renderLogs() {
  const el = document.getElementById('view-logs');
  const typeOpts = ['all', ...Object.values(LOG_TYPES)].map(t =>
    `<button class="filter-chip ${logFilter.type===t?'active':''}" onclick="setLogFilter('type','${t}')">${t==='all'?'All Types':logLabel(t)}</button>`
  ).join('');
  const resOpts = [{ id:'all', name:'All Members' }, ...state.resources].map(r =>
    `<button class="filter-chip ${logFilter.resource===r.id?'active':''}" onclick="setLogFilter('resource','${r.id}')">${escHtml(r.name||r.id)}</button>`
  ).join('');
  const sprintOpts = [{ id:'all', name:'All Sprints' }, ...state.sprints].map(s =>
    `<button class="filter-chip ${logFilter.sprint===s.id?'active':''}" onclick="setLogFilter('sprint','${s.id}')">${escHtml(s.name||s.id)}</button>`
  ).join('');

  let logs = [...state.activityLog];
  if (logFilter.type !== 'all')     logs = logs.filter(l => l.type === logFilter.type);
  if (logFilter.sprint !== 'all')   logs = logs.filter(l => l.sprintId === logFilter.sprint || l.taskId && state.tasks.find(t => t.id===l.taskId)?.sprintId === logFilter.sprint);
  if (logFilter.resource !== 'all') {
    const rName = getResource(logFilter.resource)?.name;
    logs = logs.filter(l => l.assignee === rName || l.addedBy === rName);
  }

  const logItems = logs.slice(0, 100).map(l => {
    const sprintId = l.sprintId || state.tasks.find(t => t.id===l.taskId)?.sprintId;
    const sprint   = getSprint(sprintId);
    const time = new Date(l.timestamp).toLocaleString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const details = buildLogDetails(l);
    return `<div class="log-entry log-${l.type}">
      <div class="log-icon">${logIconFor(l.type)}</div>
      <div class="log-body">
        <div class="log-title">${logLabel(l.type)}</div>
        <div class="log-details">${details}</div>
        ${sprint ? `<span class="log-sprint-tag">${escHtml(sprint.name)}</span>` : ''}
      </div>
      <div class="log-time">${time}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Activity Logs</div>
        <div class="section-subtitle">${state.activityLog.length} events · real-time audit trail</div>
      </div>
      <button class="btn-sm danger" onclick="confirmClearLogs()">Clear Logs</button>
    </div>
    <div class="filter-bar" style="flex-direction:column;gap:10px">
      <div class="filter-group"><span class="filter-label">Type</span><div class="filter-chips">${typeOpts}</div></div>
      <div class="filter-group"><span class="filter-label">Resource</span><div class="filter-chips">${resOpts}</div></div>
      <div class="filter-group"><span class="filter-label">Sprint</span><div class="filter-chips">${sprintOpts}</div></div>
    </div>
    <div class="log-feed">${logItems || '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No activity yet</div><div class="empty-desc">Actions you take will appear here</div></div>'}</div>`;
}

function buildLogDetails(l) {
  if (l.type === LOG_TYPES.STATUS_CHANGED)
    return `<b>${escHtml(l.taskTitle||'')}</b> → <span class="sprint-badge badge-${l.newStatus}" style="font-size:9px">${l.newStatus}</span> by ${escHtml(l.assignee||'—')}`;
  if (l.type === LOG_TYPES.HOURS_LOGGED)
    return `<b>${escHtml(l.taskTitle||'')}</b> · ${l.oldHours}h → ${l.newHours}h (${l.delta>=0?'+':''}${l.delta}h) by ${escHtml(l.assignee||'—')}`;
  if (l.type === LOG_TYPES.TASK_CREATED)
    return `<b>${escHtml(l.taskTitle||'')}</b> · ${l.estimatedHours}h est · ${escHtml(l.assignee||'Unassigned')}`;
  if (l.type === LOG_TYPES.DELAY_REASON)
    return `<b>${escHtml(l.taskTitle||'')}</b> · ${escHtml(l.type2||l.type)} by ${escHtml(l.addedBy||'—')}: ${escHtml(l.description||'')}`;
  if (l.type === LOG_TYPES.SCOPE_ADDED)
    return `<b>${escHtml(l.taskTitle||'')}</b> added mid-sprint · +${l.estimatedHours}h impact`;
  if (l.type === LOG_TYPES.DEPENDENCY_OPEN)
    return `<b>${escHtml(l.taskTitle||'')}</b> unblocked after <b>${escHtml(l.unlockedBy||'')}</b> completed`;
  if (l.type === LOG_TYPES.SPRINT_STARTED || l.type === LOG_TYPES.SPRINT_DONE)
    return `<b>${escHtml(l.sprintName||'')}</b>`;
  if (l.type === LOG_TYPES.RETRO_SAVED)
    return `Retrospective saved for <b>${escHtml(l.sprintName||'')}</b>`;
  return JSON.stringify(l).slice(0, 80);
}

function logIconFor(type) {
  return { task_created:'✦', status_changed:'↕', hours_logged:'⏱', dependency_open:'🔓',
    scope_added:'⚠', delay_reason:'🚧', sprint_started:'🚀', sprint_completed:'🎉', retro_saved:'📋' }[type] || '●';
}

function setLogFilter(key, val) {
  logFilter[key] = val;
  renderLogs();
}

function confirmClearLogs() {
  openModal(`<div class="modal-content">
    <div class="modal-title">Clear Activity Logs</div>
    <div class="modal-sub">This cannot be undone</div>
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">All ${state.activityLog.length} log entries will be deleted.</p>
    <div class="form-actions">
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" style="background:var(--red)" onclick="clearLogs()">Clear All Logs</button>
    </div>
  </div>`);
}

function clearLogs() {
  state.activityLog = [];
  saveState();
  closeModal();
  showToast('Logs cleared', 'error');
  renderLogs();
}

function printReport() {
  const el = document.getElementById('printable-report');
  if (!el) { showToast('Select a sprint first', 'error'); return; }
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>SprintForge Report</title>
    <style>body{font-family:Inter,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse}
    th,td{padding:8px;border:1px solid #ddd;font-size:12px}th{background:#f5f5f5}</style></head>
    <body>${el.innerHTML}</body></html>`);
  w.document.close();
  w.print();
}

function exportReportCSV() {
  const selectEl = document.getElementById('report-sprint-select');
  const sprintId = selectEl?.value;
  if (!sprintId) { showToast('Select a sprint first', 'error'); return; }
  const tasks = sprintTasks(sprintId);
  const rows = [['Task','Type','Priority','Assignee','Estimated','Logged','Variance','Status','Scope Addition','Delays']];
  tasks.forEach(t => {
    const r = getResource(t.assigneeId);
    rows.push([t.title, t.type, t.priority, r?.name||'Unassigned',
      t.estimatedHours||0, t.loggedHours||0,
      (t.loggedHours||0)-(t.estimatedHours||0),
      t.status, t.scopeAddition?'Yes':'No', (t.delayReasons||[]).length]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sprint-report-${sprintId}-${today()}.csv`;
  a.click();
  showToast('Report exported ✓', 'success');
}
