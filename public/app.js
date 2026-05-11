// ============================================================
//  SprintForge — App.js
//  Complete sprint management with resources, timeline, reports
// ============================================================

// ── Helpers ──────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const genId = () => Math.random().toString(36).slice(2, 9);
const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN',{month:'short',day:'numeric'}) : '—';
const today = () => new Date().toISOString().slice(0,10);
const daysBetween = (a,b) => Math.round((new Date(b)-new Date(a))/(1000*86400));
const clamp = (v,min,max) => Math.min(max, Math.max(min, v));

// ── RESOURCE COLORS ───────────────────────────────────────────
const COLORS = ['#FF6B35','#00CFFF','#10D991','#FFD60A','#BD93F9','#FF4757',
                '#26de81','#fd9644','#45aaf2','#a55eea','#fc5c65','#20bf6b'];

// ── PRIORITY / STATUS / TYPE MAPS ────────────────────────────
const PRIORITIES   = ['critical','high','medium','low'];
const STATUSES     = ['todo','inprogress','done','blocked'];
const TASK_TYPES   = ['story','bug','task','subtask'];
const STATUS_LABEL = { todo:'To Do', inprogress:'In Progress', done:'Done', blocked:'Blocked' };
const SPRINT_STATUS = ['planning','active','completed'];

// ── STATE ─────────────────────────────────────────────────────
let state = {
  sprints       : [],
  tasks         : [],
  resources     : [],
  activityLog   : [],
  retrospectives: {},
  activeView    : 'dashboard',
};

// ── UNDO STACK ────────────────────────────────────────────────
const _undoStack = [];
const MAX_UNDO   = 10;
function pushUndo() {
  _undoStack.push(JSON.stringify({ sprints:state.sprints, tasks:state.tasks, resources:state.resources }));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
}
function undo() {
  if (!_undoStack.length) { showToast('Nothing to undo','info'); return; }
  const snap = JSON.parse(_undoStack.pop());
  state.sprints   = snap.sprints;
  state.tasks     = snap.tasks;
  state.resources = snap.resources;
  saveState();
  renderView(state.activeView);
  showToast('↩ Undo applied','success');
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    const tag = document.activeElement.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); undo(); }
  }
});

// ── PERSISTENCE ───────────────────────────────────────────────
// Debounced full-state sync (used as fallback / compatibility layer).
// Targeted mutations use the REST endpoints directly.
let _saveTimer;
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_doSave, 600);
}
function _doSave() {
  // Sync all mutations to server via targeted endpoints (fire-and-forget)
  // The state object is the in-memory source of truth; server is persisted store.
  // Individual CRUD operations already call their own endpoints,
  // so this acts as a catch-all safety net.
  localStorage.setItem('sf_state_backup', JSON.stringify({
    sprints: state.sprints, tasks: state.tasks,
    resources: state.resources, retrospectives: state.retrospectives,
    ts: Date.now()
  }));
}

async function loadState() {
  try {
    const res = await fetch('/api/all');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loaded = await res.json();
    if (loaded && loaded.sprints) {
      state.sprints    = loaded.sprints    || [];
      state.tasks      = loaded.tasks      || [];
      state.resources  = loaded.resources  || [];
      // Ensure new fields exist on every task
      state.tasks.forEach(t => {
        if (!t.dependsOn)    t.dependsOn    = [];
        if (!t.delayReasons) t.delayReasons = [];
        if (!t.tags)         t.tags         = [];
        if (!t.comments)     t.comments     = [];
        if (t.scopeAddition  === undefined) t.scopeAddition  = false;
        if (t.originalSprint === undefined) t.originalSprint = t.sprintId;
        if (!t.dueDate)      t.dueDate      = '';
        if (!t.doneDate)     t.doneDate     = '';
      });
      // Restore retrospectives via state compat
      state.retrospectives = {};
      return true;
    }
  } catch (e) {
    console.warn('API load failed, trying localStorage backup:', e.message);
    try {
      const bk = localStorage.getItem('sf_state_backup');
      if (bk) {
        const snap = JSON.parse(bk);
        state.sprints       = snap.sprints       || [];
        state.tasks         = snap.tasks         || [];
        state.resources     = snap.resources     || [];
        state.retrospectives = snap.retrospectives || {};
        showToast('⚠ Loaded from local backup — server unavailable','info');
        return true;
      }
    } catch (_) {}
    showToast('Could not load data — starting fresh','error');
  }
  return false;
}

// ── TARGETED API HELPERS ──────────────────────────────────────
const api = {
  async post(url, body)   { const r=await fetch(url,{method:'POST',  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); },
  async put(url, body)    { const r=await fetch(url,{method:'PUT',   headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); },
  async delete(url)       { const r=await fetch(url,{method:'DELETE'}); return r.json(); },
};

// ── LOG TO SERVER ────────────────────────────────────────────
function postLog(type, data) {
  api.post('/api/activity-log', { type, timestamp: new Date().toISOString(), ...data })
    .catch(e => console.warn('Log failed', e));
}

// ── SAMPLE DATA ───────────────────────────────────────────────
function seedData() {
  const today_str = today();
  const d = (offset) => {
    const dt = new Date(); dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0,10);
  };

  state.resources = [
    { id:'r1', name:'Priya Sharma',   role:'Backend Dev',    initials:'PS', color:'#FF6B35', capacityPerDay:6 },
    { id:'r2', name:'Arjun Mehta',    role:'Frontend Dev',   initials:'AM', color:'#00CFFF', capacityPerDay:7 },
    { id:'r3', name:'Sneha Patel',    role:'Full Stack Dev', initials:'SP', color:'#10D991', capacityPerDay:6 },
    { id:'r4', name:'Rahul Kapoor',   role:'QA Engineer',    initials:'RK', color:'#FFD60A', capacityPerDay:5 },
    { id:'r5', name:'Aisha Verma',    role:'UI/UX Designer', initials:'AV', color:'#BD93F9', capacityPerDay:6 },
  ];

  state.sprints = [
    { id:'s1', name:'Sprint 1 — Foundation', goal:'Setup core architecture and auth flows', startDate:d(-20), endDate:d(-7),  status:'completed' },
    { id:'s2', name:'Sprint 2 — Dashboard',  goal:'Build main dashboard and reporting module', startDate:d(-6), endDate:d(7),  status:'active'    },
    { id:'s3', name:'Sprint 3 — API Layer',  goal:'Expose REST APIs and integrate 3rd party services', startDate:d(8),  endDate:d(21), status:'planning'  },
  ];

  state.tasks = [
    // Sprint 1 — completed
    { id:'t1',  sprintId:'s1', title:'Project scaffolding & CI/CD pipeline',   type:'task',    priority:'high',     status:'done',       assigneeId:'r1', estimatedHours:12, loggedHours:14, storyPoints:5, description:'Set up monorepo, GitHub Actions, Docker configs.' },
    { id:'t2',  sprintId:'s1', title:'Database schema design',                 type:'task',    priority:'critical', status:'done',       assigneeId:'r1', estimatedHours:8,  loggedHours:9,  storyPoints:3, description:'PostgreSQL schema with migrations.' },
    { id:'t3',  sprintId:'s1', title:'JWT authentication backend',             type:'story',   priority:'critical', status:'done',       assigneeId:'r3', estimatedHours:10, loggedHours:12, storyPoints:5, description:'' },
    { id:'t4',  sprintId:'s1', title:'Login / Signup UI',                      type:'story',   priority:'high',     status:'done',       assigneeId:'r2', estimatedHours:8,  loggedHours:7,  storyPoints:3, description:'' },
    { id:'t5',  sprintId:'s1', title:'Auth flow QA & bug fixes',               type:'bug',     priority:'high',     status:'done',       assigneeId:'r4', estimatedHours:6,  loggedHours:5,  storyPoints:2, description:'' },
    { id:'t6',  sprintId:'s1', title:'Landing page design system',             type:'story',   priority:'medium',   status:'done',       assigneeId:'r5', estimatedHours:10, loggedHours:11, storyPoints:4, description:'' },

    // Sprint 2 — active
    { id:'t7',  sprintId:'s2', title:'Dashboard layout & navigation',          type:'story',   priority:'critical', status:'done',       assigneeId:'r2', estimatedHours:10, loggedHours:10, storyPoints:5, description:'Main app shell with sidebar, header.' },
    { id:'t8',  sprintId:'s2', title:'Analytics chart components',             type:'story',   priority:'high',     status:'inprogress', assigneeId:'r2', estimatedHours:12, loggedHours:5,  storyPoints:5, description:'Bar, line, pie charts using Chart.js or D3.' },
    { id:'t9',  sprintId:'s2', title:'Reports API endpoints',                  type:'story',   priority:'high',     status:'inprogress', assigneeId:'r1', estimatedHours:10, loggedHours:4,  storyPoints:5, description:'' },
    { id:'t10', sprintId:'s2', title:'Data table with filters & export',       type:'story',   priority:'medium',   status:'todo',       assigneeId:'r3', estimatedHours:8,  loggedHours:0,  storyPoints:3, description:'' },
    { id:'t11', sprintId:'s2', title:'Dark mode UI design tokens',             type:'task',    priority:'medium',   status:'inprogress', assigneeId:'r5', estimatedHours:6,  loggedHours:3,  storyPoints:2, description:'' },
    { id:'t12', sprintId:'s2', title:'Dashboard responsive layout',            type:'task',    priority:'low',      status:'todo',       assigneeId:'r5', estimatedHours:6,  loggedHours:0,  storyPoints:2, description:'' },
    { id:'t13', sprintId:'s2', title:'Login redirect bug fix',                 type:'bug',     priority:'critical', status:'done',       assigneeId:'r4', estimatedHours:3,  loggedHours:2,  storyPoints:1, description:'' },
    { id:'t14', sprintId:'s2', title:'E2E tests for dashboard flows',          type:'task',    priority:'medium',   status:'todo',       assigneeId:'r4', estimatedHours:8,  loggedHours:0,  storyPoints:3, description:'' },

    // Sprint 3 — planning
    { id:'t15', sprintId:'s3', title:'REST API scaffolding & versioning',      type:'story',   priority:'critical', status:'todo',       assigneeId:'r1', estimatedHours:10, loggedHours:0,  storyPoints:5, description:'' },
    { id:'t16', sprintId:'s3', title:'Stripe payment integration',             type:'story',   priority:'high',     status:'todo',       assigneeId:'r3', estimatedHours:14, loggedHours:0,  storyPoints:8, description:'' },
    { id:'t17', sprintId:'s3', title:'Email notification service',             type:'story',   priority:'medium',   status:'todo',       assigneeId:'r1', estimatedHours:8,  loggedHours:0,  storyPoints:3, description:'' },
    { id:'t18', sprintId:'s3', title:'API documentation (Swagger)',            type:'task',    priority:'medium',   status:'todo',       assigneeId:'r3', estimatedHours:5,  loggedHours:0,  storyPoints:2, description:'' },
    { id:'t19', sprintId:'s3', title:'API integration test suite',             type:'task',    priority:'high',     status:'todo',       assigneeId:'r4', estimatedHours:10, loggedHours:0,  storyPoints:5, description:'' },
    { id:'t20', sprintId:'s3', title:'UI components for API settings page',    type:'story',   priority:'low',      status:'todo',       assigneeId:'r2', estimatedHours:8,  loggedHours:0,  storyPoints:3, description:'' },
  ];

  saveState();
}

// ── COMPUTED HELPERS ──────────────────────────────────────────
function sprintTasks(sprintId) {
  return state.tasks.filter(t => t.sprintId === sprintId);
}
function tasksByStatus(sprintId, status) {
  return sprintTasks(sprintId).filter(t => t.status === status);
}
function sprintTotalEstHours(sprintId) {
  return sprintTasks(sprintId).reduce((s,t) => s + (t.estimatedHours||0), 0);
}
function sprintLoggedHours(sprintId) {
  return sprintTasks(sprintId).reduce((s,t) => s + (t.loggedHours||0), 0);
}
function sprintDoneHours(sprintId) {
  return sprintTasks(sprintId).filter(t=>t.status==='done').reduce((s,t)=>s+(t.estimatedHours||0),0);
}
function sprintProgress(sprintId) {
  const total = sprintTotalEstHours(sprintId);
  if (!total) return 0;
  return Math.round((sprintDoneHours(sprintId) / total) * 100);
}
function sprintWorkingDays(sprint) {
  if (!sprint.startDate || !sprint.endDate) return 10;
  return Math.max(1, Math.round(daysBetween(sprint.startDate, sprint.endDate) * 5/7));
}
function resourceAllocHours(resourceId, sprintId) {
  return state.tasks
    .filter(t => t.assigneeId === resourceId && t.sprintId === sprintId)
    .reduce((s,t) => s + (t.estimatedHours||0), 0);
}
function resourceCapacityInSprint(resourceId, sprintId) {
  const r = state.resources.find(r=>r.id===resourceId);
  if (!r) return 0;
  const s = state.sprints.find(sp=>sp.id===sprintId);
  if (!s) return 0;
  return r.capacityPerDay * sprintWorkingDays(s);
}
function getResource(id) { return state.resources.find(r=>r.id===id); }
function getSprint(id)   { return state.sprints.find(s=>s.id===id); }

// ── NAVIGATION ────────────────────────────────────────────────
function setView(view) {
  state.activeView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-tab').forEach(t => t.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  $(`.nav-tab[data-view="${view}"]`).classList.add('active');
  renderView(view);
}
function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  if (view === 'sprints')   renderSprints();
  if (view === 'timeline')  renderTimeline();
  if (view === 'resources') renderResources();
}

// ── TOAST ─────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, type='info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ── MODAL ─────────────────────────────────────────────────────
function openModal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}
function closeModalOnOverlay(e) {
  if (e.target === $('#modal-overlay')) closeModal();
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const el = $('#view-dashboard');
  const totalSprints   = state.sprints.length;
  const activeSprints  = state.sprints.filter(s=>s.status==='active').length;
  const totalResources = state.resources.length;
  const totalTasks     = state.tasks.length;
  const doneTasks      = state.tasks.filter(t=>t.status==='done').length;
  const totalEstHours  = state.tasks.reduce((s,t)=>s+(t.estimatedHours||0),0);
  const totalLogged    = state.tasks.reduce((s,t)=>s+(t.loggedHours||0),0);
  const blocker        = state.tasks.filter(t=>t.status==='blocked').length;

  const activeSprint = state.sprints.filter(s=>s.status==='active');
  const sprintRows = activeSprint.length ? activeSprint.map(s => {
    const pct = sprintProgress(s.id);
    return `<div class="dash-sprint-row">
      <div>
        <div class="dash-sprint-name">${escHtml(s.name)}</div>
        <div class="dash-sprint-dates">${fmt(s.startDate)} → ${fmt(s.endDate)}</div>
      </div>
      <div class="dash-sprint-bar-track">
        <div class="dash-sprint-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="dash-sprint-pct">${pct}%</div>
    </div>`;
  }).join('') : '<div class="empty-state" style="padding:24px"><div class="empty-desc">No active sprints</div></div>';

  const resRows = state.resources.map(r => {
    const totalAlloc = activeSprint.reduce((s,sp) => s + resourceAllocHours(r.id, sp.id), 0);
    const totalCap   = activeSprint.reduce((s,sp) => s + resourceCapacityInSprint(r.id, sp.id), 0);
    const pct = totalCap ? clamp(Math.round((totalAlloc/totalCap)*100),0,200) : 0;
    const color = pct > 110 ? 'var(--red)' : pct > 85 ? 'var(--yellow)' : 'var(--green)';
    return `<div class="dash-res-row">
      <div class="dash-res-avatar" style="background:${r.color}22;color:${r.color}">${r.initials}</div>
      <div class="dash-res-name">${escHtml(r.name)}</div>
      <div class="dash-res-bar-track">
        <div class="dash-res-bar-fill" style="width:${Math.min(pct,100)}%;background:${color}"></div>
      </div>
      <div class="dash-res-pct">${pct}%</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Dashboard</div>
        <div class="section-subtitle">Tech Manager Overview · ${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card orange">
        <div class="stat-label">Total Sprints</div>
        <div class="stat-value">${totalSprints}</div>
        <div class="stat-meta">${activeSprints} active</div>
      </div>
      <div class="stat-card cyan">
        <div class="stat-label">Team Members</div>
        <div class="stat-value">${totalResources}</div>
        <div class="stat-meta">resources allocated</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Tasks Completed</div>
        <div class="stat-value">${doneTasks}</div>
        <div class="stat-meta">of ${totalTasks} total</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">Est. Hours</div>
        <div class="stat-value">${totalEstHours}</div>
        <div class="stat-meta">${totalLogged} logged</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Blockers</div>
        <div class="stat-value">${blocker}</div>
        <div class="stat-meta">tasks blocked</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">Velocity</div>
        <div class="stat-value">${(() => {
          const completed = state.sprints.filter(s=>s.status==='completed');
          if (!completed.length) return '—';
          const pts = completed.map(s => sprintTasks(s.id).filter(t=>t.status==='done').reduce((a,t)=>a+(t.storyPoints||0),0));
          return Math.round(pts.reduce((a,v)=>a+v,0)/pts.length);
        })()}</div>
        <div class="stat-meta">avg pts/sprint</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-panel">
        <div class="dash-panel-title">Active Sprint Progress</div>
        ${sprintRows}
      </div>
      <div class="dash-panel">
        <div class="dash-panel-title">Resource Load (Active Sprints)</div>
        ${resRows || '<div class="empty-state" style="padding:16px"><div class="empty-desc">No resources added</div></div>'}
      </div>
    </div>
  `;
}

// ── SPRINTS VIEW ──────────────────────────────────────────────
let expandedSprints = new Set();

function renderSprints() {
  const el = $('#view-sprints');

  const cards = state.sprints.length ? state.sprints.map(s => renderSprintCard(s)).join('') :
    `<div class="empty-state">
      <div class="empty-icon">◉</div>
      <div class="empty-title">No sprints yet</div>
      <div class="empty-desc">Click "New Sprint" to plan your first sprint</div>
    </div>`;

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Sprints</div>
        <div class="section-subtitle">${state.sprints.length} sprints · ${state.tasks.length} tasks</div>
      </div>
      <button class="btn-primary" onclick="openSprintModal()">+ New Sprint</button>
    </div>
    <div class="sprint-list" id="sprint-list">${cards}</div>
  `;
}

function renderSprintCard(s) {
  const tasks   = sprintTasks(s.id);
  const pct     = sprintProgress(s.id);
  const estHrs  = sprintTotalEstHours(s.id);
  const logHrs  = sprintLoggedHours(s.id);
  const isExp   = expandedSprints.has(s.id);
  const days    = s.startDate && s.endDate ? `${daysBetween(s.startDate, s.endDate)} days` : '—';

  const board = isExp ? `
    <div class="sprint-board">
      <div class="sprint-board-header">
        <div class="sprint-goal">"${escHtml(s.goal || 'No goal defined')}"</div>
        <div class="sprint-board-meta">
          <span>${tasks.length} tasks</span>
          <span>${estHrs}h est.</span>
          <span>${logHrs}h logged</span>
        </div>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="btn-sm accent" onclick="event.stopPropagation();openTaskModal('${s.id}')">+ Task</button>
        </div>
      </div>
      ${renderKanban(s.id)}
    </div>` : '';

  return `
    <div class="sprint-card status-${s.status} ${isExp?'expanded':''}" id="sc-${s.id}">
      <div class="sprint-progress-bar">
        <div class="sprint-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="sprint-card-header" onclick="toggleSprint('${s.id}')">
        <div class="sprint-status-dot"></div>
        <div class="sprint-card-title">
          ${escHtml(s.name)}
          <span class="sprint-badge badge-${s.status}">${s.status}</span>
        </div>
        <div class="sprint-card-meta">
          <span>${fmt(s.startDate)}</span>
          <span class="sep">→</span>
          <span>${fmt(s.endDate)}</span>
          <span class="sep">|</span>
          <span>${days}</span>
          <span class="sep">|</span>
          <span>${pct}% done</span>
          <span class="sep">|</span>
          <span>${tasks.length} tasks</span>
        </div>
        <div class="sprint-actions" onclick="event.stopPropagation()">
          <button class="btn-sm" onclick="openSprintModal('${s.id}')">Edit</button>
          <button class="btn-sm danger" onclick="confirmDeleteSprint('${s.id}')">Delete</button>
        </div>
        <span class="sprint-chevron">▶</span>
      </div>
      ${board}
    </div>
  `;
}

function toggleSprint(id) {
  if (expandedSprints.has(id)) expandedSprints.delete(id);
  else expandedSprints.add(id);
  renderSprints();
}

function renderKanban(sprintId) {
  const cols = [
    { key:'todo',       cls:'col-todo' },
    { key:'inprogress', cls:'col-inprogress' },
    { key:'done',       cls:'col-done' },
    { key:'blocked',    cls:'col-blocked' },
  ];

  const colsHtml = cols.map(({key,cls}) => {
    const tasks = tasksByStatus(sprintId, key);
    const cards = tasks.map(t => renderTaskCard(t)).join('');
    return `
      <div class="kanban-col ${cls}">
        <div class="kanban-col-header">
          <span class="kanban-col-title">${STATUS_LABEL[key]}</span>
          <span class="kanban-col-count">${tasks.length}</span>
        </div>
        <div class="task-cards">${cards}</div>
        <button class="add-task-btn" onclick="openTaskModal('${sprintId}','${key}')">+ Add Task</button>
      </div>`;
  }).join('');

  return `<div class="kanban-columns">${colsHtml}</div>`;
}

function renderTaskCard(t) {
  const r = getResource(t.assigneeId);
  const avatarHtml = r ? `<div class="task-assignee" style="background:${r.color}22;color:${r.color}">${r.initials}</div>` : '';
  const pct = t.estimatedHours ? Math.min(100,Math.round((t.loggedHours||0)/t.estimatedHours*100)) : 0;
  return `
    <div class="task-card priority-${t.priority}" onclick="openTaskDetail('${t.id}')">
      <div class="task-card-title">${escHtml(t.title)}</div>
      <div class="task-card-footer">
        <span class="task-type-badge type-${t.type}">${t.type}</span>
        ${avatarHtml}
        <div class="task-hrs">⏱ <span>${t.loggedHours||0}</span>/${t.estimatedHours||0}h</div>
      </div>
      ${pct > 0 ? `<div style="margin-top:6px"><div style="height:2px;background:var(--surface2);border-radius:99px;overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--green);border-radius:99px"></div></div></div>` : ''}
    </div>`;
}

// ── SPRINT MODAL ──────────────────────────────────────────────
function openSprintModal(id) {
  const s = id ? getSprint(id) : null;
  const title = s ? 'Edit Sprint' : 'New Sprint';
  const statusOpts = SPRINT_STATUS.map(st =>
    `<option value="${st}" ${s?.status===st?'selected':''}>${st.charAt(0).toUpperCase()+st.slice(1)}</option>`
  ).join('');

  openModal(`
    <div class="modal-content">
      <div class="modal-title">${title}</div>
      <div class="modal-sub">${s ? `Editing · ${s.id}` : 'Plan a new sprint iteration'}</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Sprint Name *</label>
          <input class="form-input" id="f-name" value="${escHtml(s?.name||'')}" placeholder="Sprint 4 — Feature X">
        </div>
        <div class="form-group">
          <label class="form-label">Goal / Objective</label>
          <input class="form-input" id="f-goal" value="${escHtml(s?.goal||'')}" placeholder="What should this sprint deliver?">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Start Date *</label>
            <input class="form-input" type="date" id="f-start" value="${s?.startDate||''}">
          </div>
          <div class="form-group">
            <label class="form-label">End Date *</label>
            <input class="form-input" type="date" id="f-end" value="${s?.endDate||''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" id="f-status">${statusOpts}</select>
        </div>
        <div class="form-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn-primary" onclick="saveSprint('${s?.id||''}')">
            ${s ? 'Save Changes' : 'Create Sprint'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveSprint(id) {
  const name  = $('#f-name').value.trim();
  const goal  = $('#f-goal').value.trim();
  const start = $('#f-start').value;
  const end   = $('#f-end').value;
  const status= $('#f-status').value;
  if (!name) { showToast('Sprint name is required','error'); return; }
  if (start && end && start > end) { showToast('End date must be after start date','error'); return; }
  pushUndo();
  if (id) {
    const s = getSprint(id);
    Object.assign(s, {name,goal,startDate:start,endDate:end,status});
    await api.put(`/api/sprints/${id}`, {name,goal,startDate:start,endDate:end,status}).catch(console.error);
  } else {
    const res = await api.post('/api/sprints', {name,goal,startDate:start,endDate:end,status}).catch(console.error);
    const newId = res?.id || 's'+genId();
    state.sprints.push({ id:newId, name, goal, startDate:start, endDate:end, status });
  }
  saveState(); closeModal();
  showToast(id ? 'Sprint updated ✓' : 'Sprint created ✓', 'success');
  renderView(state.activeView);
}

function confirmDeleteSprint(id) {
  const s = getSprint(id);
  const taskCount = sprintTasks(id).length;
  openModal(`
    <div class="modal-content">
      <div class="modal-title">Delete Sprint</div>
      <div class="modal-sub">This action cannot be undone</div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
        You are about to delete <strong>"${escHtml(s.name)}"</strong> and all <strong>${taskCount} tasks</strong> in it.
      </p>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" style="background:var(--red)" onclick="deleteSprint('${id}')">Delete Sprint</button>
      </div>
    </div>
  `);
}

async function deleteSprint(id) {
  pushUndo();
  state.sprints = state.sprints.filter(s=>s.id!==id);
  state.tasks   = state.tasks.filter(t=>t.sprintId!==id);
  expandedSprints.delete(id);
  await api.delete(`/api/sprints/${id}`).catch(console.error);
  saveState(); closeModal();
  showToast('Sprint deleted','error');
  renderView(state.activeView);
}

// ── TASK MODAL ────────────────────────────────────────────────
function openTaskModal(sprintId, defaultStatus='todo', taskId=null) {
  const t = taskId ? state.tasks.find(x=>x.id===taskId) : null;
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

  openModal(`
    <div class="modal-content">
      <div class="modal-title">${title}</div>
      <div class="modal-sub">${t ? `Task ID: ${t.id}` : 'Add a new task to the sprint'}</div>
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
            <input class="form-input" type="number" id="ft-sp" min="0" value="${t?.storyPoints||1}" placeholder="1">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Estimated Hours *</label>
            <input class="form-input" type="number" id="ft-est" min="0" step="0.5" value="${t?.estimatedHours||4}" placeholder="8">
          </div>
          <div class="form-group">
            <label class="form-label">Logged Hours</label>
            <input class="form-input" type="number" id="ft-log" min="0" step="0.5" value="${t?.loggedHours||0}" placeholder="0">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Due Date</label>
            <input class="form-input" type="date" id="ft-due" value="${t?.dueDate||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Tags <span style="font-size:10px;color:var(--text3)">(comma separated)</span></label>
            <input class="form-input" id="ft-tags" value="${escHtml((t?.tags||[]).join(', '))}" placeholder="frontend, api, urgent">
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn-primary" onclick="saveTask('${t?.id||''}','${sprintId}')">
            ${t ? 'Save Changes' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  `);
}

async function saveTask(id, defaultSprintId) {
  const title   = $('#ft-title').value.trim();
  const desc    = $('#ft-desc').value.trim();
  const sprint  = $('#ft-sprint').value;
  const assignee= $('#ft-assignee').value;
  const type    = $('#ft-type').value;
  const prio    = $('#ft-priority').value;
  const status  = $('#ft-status').value;
  const sp      = parseInt($('#ft-sp').value)||0;
  const est     = parseFloat($('#ft-est').value)||0;
  const log     = parseFloat($('#ft-log').value)||0;
  const dueDate = $('#ft-due')?.value || '';
  const tags    = ($('#ft-tags')?.value||'').split(',').map(s=>s.trim()).filter(Boolean);

  if (!title) { showToast('Task title is required','error'); return; }
  if (!sprint) { showToast('Select a sprint','error'); return; }
  pushUndo();

  if (id) {
    const t = state.tasks.find(x=>x.id===id);
    const doneDate = (status === 'done' && t?.status !== 'done') ? today() : (t?.doneDate || '');
    const updates = {title,description:desc,sprintId:sprint,assigneeId:assignee,type,
      priority:prio,status,storyPoints:sp,estimatedHours:est,loggedHours:log,
      dueDate, doneDate, tags,
      dependsOn:t?.dependsOn||[], scopeAddition:t?.scopeAddition||false, originalSprint:t?.originalSprint||sprint};
    Object.assign(t, updates);
    await api.put(`/api/tasks/${id}`, updates).catch(console.error);
  } else {
    const sprintObj = getSprint(sprint);
    const isActive  = sprintObj?.status === 'active';
    const res = await api.post('/api/tasks', {
      sprintId:sprint, title, description:desc, type, priority:prio, status,
      assigneeId:assignee, estimatedHours:est, loggedHours:log, storyPoints:sp,
      dueDate, doneDate:'', tags, dependsOn:[], scopeAddition:isActive, originalSprint:sprint
    }).catch(console.error);
    const newId = res?.id || 't'+genId();
    state.tasks.push({ id:newId, sprintId:sprint, title, description:desc, type,
      priority:prio, status, assigneeId:assignee, estimatedHours:est, loggedHours:log,
      storyPoints:sp, dueDate, doneDate:'', tags, dependsOn:[], delayReasons:[],
      comments:[], scopeAddition:isActive, originalSprint:sprint });
  }
  saveState(); closeModal();
  showToast(id ? 'Task updated ✓':'Task added ✓','success');
  renderView(state.activeView);
}

// ── TASK DETAIL ───────────────────────────────────────────────
function openTaskDetail(taskId) {
  const t = state.tasks.find(x=>x.id===taskId);
  if (!t) return;
  const r = getResource(t.assigneeId);
  const s = getSprint(t.sprintId);
  const pct = t.estimatedHours ? Math.min(100, Math.round((t.loggedHours||0)/t.estimatedHours*100)) : 0;
  const fillColor = pct > 90 ? 'var(--green)' : pct > 50 ? 'var(--yellow)' : 'var(--accent2)';

  const moveButtons = STATUSES.filter(st=>st!==t.status).map(st =>
    `<button class="btn-sm" onclick="moveTask('${t.id}','${st}')">→ ${STATUS_LABEL[st]}</button>`
  ).join('');

  openModal(`
    <div class="modal-content">
      <div class="task-detail-header">
        <div class="task-detail-type-priority">
          <span class="task-type-badge type-${t.type}">${t.type}</span>
          <span class="priority-chip p-${t.priority}">${t.priority}</span>
          <span class="info-chip">${s?.name||'Unknown Sprint'}</span>
        </div>
        <div class="task-detail-title">${escHtml(t.title)}</div>
        ${t.description ? `<div class="task-detail-desc">${escHtml(t.description)}</div>` : ''}
      </div>

      <div class="task-meta-grid">
        <div class="task-meta-item">
          <div class="task-meta-label">Assignee</div>
          <div class="task-meta-value" style="font-size:13px;font-family:var(--font)">
            ${r ? `<span style="color:${r.color}">${r.initials}</span> ${r.name}` : '—'}
          </div>
        </div>
        <div class="task-meta-item">
          <div class="task-meta-label">Status</div>
          <div class="task-meta-value" style="font-size:13px;font-family:var(--font)">${STATUS_LABEL[t.status]}</div>
        </div>
        <div class="task-meta-item">
          <div class="task-meta-label">Estimated</div>
          <div class="task-meta-value">${t.estimatedHours||0}<span style="font-size:11px;color:var(--text3)">h</span></div>
        </div>
        <div class="task-meta-item">
          <div class="task-meta-label">Logged</div>
          <div class="task-meta-value">${t.loggedHours||0}<span style="font-size:11px;color:var(--text3)">h</span></div>
        </div>
        <div class="task-meta-item">
          <div class="task-meta-label">Story Points</div>
          <div class="task-meta-value">${t.storyPoints||0}</div>
        </div>
        <div class="task-meta-item">
          <div class="task-meta-label">Remaining</div>
          <div class="task-meta-value" style="color:var(--accent)">${Math.max(0,(t.estimatedHours||0)-(t.loggedHours||0))}<span style="font-size:11px;color:var(--text3)">h</span></div>
        </div>
      </div>

      <div class="task-progress-section">
        <div class="task-progress-header">
          <span>Progress</span><span>${pct}%</span>
        </div>
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

      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn-sm danger" onclick="confirmDeleteTask('${t.id}')">Delete</button>
        <button class="btn-primary" onclick="closeModal();openTaskModal('${t.sprintId}','${t.status}','${t.id}')">Edit Task</button>
      </div>
    </div>
  `);
}

function updateLoggedHours(taskId) {
  const t = state.tasks.find(x=>x.id===taskId);
  if (!t) return;
  t.loggedHours = parseFloat($('#det-log').value)||0;
  saveState();
  showToast('Hours updated ✓','success');
  closeModal();
  renderView(state.activeView);
}

async function moveTask(taskId, newStatus) {
  const t = state.tasks.find(x=>x.id===taskId);
  if (t) {
    const doneDate = newStatus === 'done' ? today() : t.doneDate || '';
    t.status   = newStatus;
    t.doneDate = doneDate;
    await api.put(`/api/tasks/${taskId}`, { ...t, status: newStatus, doneDate }).catch(console.error);
    saveState();
  }
  showToast(`Moved to ${STATUS_LABEL[newStatus]} ✓`,'success');
  closeModal();
  renderView(state.activeView);
}

function confirmDeleteTask(id) {
  const t = state.tasks.find(x=>x.id===id);
  openModal(`
    <div class="modal-content">
      <div class="modal-title">Delete Task</div>
      <div class="modal-sub">Cannot be undone</div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Delete task: <strong>"${escHtml(t?.title||'')}"</strong>?</p>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" style="background:var(--red)" onclick="deleteTask('${id}')">Delete</button>
      </div>
    </div>
  `);
}

async function deleteTask(id) {
  pushUndo();
  state.tasks = state.tasks.filter(t=>t.id!==id);
  await api.delete(`/api/tasks/${id}`).catch(console.error);
  saveState(); closeModal();
  showToast('Task deleted','error');
  renderView(state.activeView);
}

// ── TIMELINE VIEW ─────────────────────────────────────────────
function renderTimeline() {
  const el = $('#view-timeline');
  const allSprints = state.sprints.filter(s=>s.startDate && s.endDate);

  if (!allSprints.length) {
    el.innerHTML = `<div class="section-header"><div class="section-title">Timeline</div></div>
      <div class="empty-state"><div class="empty-icon">▷</div><div class="empty-title">No sprints with dates</div><div class="empty-desc">Add start/end dates to your sprints to see the timeline</div></div>`;
    return;
  }

  // Calculate date range
  const minDate = new Date(Math.min(...allSprints.map(s => new Date(s.startDate))));
  const maxDate = new Date(Math.max(...allSprints.map(s => new Date(s.endDate))));
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);
  const totalDays = Math.max(1, daysBetween(minDate.toISOString().slice(0,10), maxDate.toISOString().slice(0,10)));
  const todayStr = today();
  const todayOffset = clamp(daysBetween(minDate.toISOString().slice(0,10), todayStr), 0, totalDays);
  const todayPct = (todayOffset / totalDays * 100).toFixed(2);

  // Generate weekly date headers
  const dateHeaders = [];
  let d = new Date(minDate);
  while (d <= maxDate) {
    dateHeaders.push({ label: d.toLocaleDateString('en-IN',{month:'short',day:'numeric'}), date: d.toISOString().slice(0,10) });
    d.setDate(d.getDate() + 7);
  }

  const headCells = dateHeaders.map(dh => {
    const isT = dh.date === todayStr || (dh.date < todayStr && dateHeaders[dateHeaders.indexOf(dh)+1]?.date > todayStr);
    return `<div class="gantt-date-cell ${isT?'today-marker':''}">${dh.label}</div>`;
  }).join('');

  // Gantt rows for each sprint + tasks
  let ganttRows = '';
  for (const s of allSprints) {
    const spStart = daysBetween(minDate.toISOString().slice(0,10), s.startDate);
    const spLen   = daysBetween(s.startDate, s.endDate);
    const spLeft  = (spStart/totalDays*100).toFixed(2);
    const spW     = Math.max(1,(spLen/totalDays*100)).toFixed(2);
    const statusColor = s.status === 'completed' ? 'var(--text3)' : s.status === 'active' ? 'var(--accent)' : 'var(--yellow)';

    ganttRows += `
      <div class="gantt-group-header">
        <span style="color:${statusColor}">◉</span>&nbsp;&nbsp;
        ${escHtml(s.name)}
        <span style="color:var(--text3);font-size:9px;margin-left:10px">${fmt(s.startDate)} → ${fmt(s.endDate)}</span>
      </div>
      <div class="gantt-row">
        <div class="gantt-row-label">
          <span style="color:${statusColor}">▬</span>
          <span>Sprint Bar</span>
        </div>
        <div class="gantt-chart-area">
          ${dateHeaders.map((_,i) => `<div class="gantt-grid-line" style="left:${(i/dateHeaders.length*100).toFixed(1)}%"></div>`).join('')}
          <div class="gantt-today-line" style="left:${todayPct}%"></div>
          <div class="gantt-bar bar-sprint" style="left:${spLeft}%;width:${spW}%" title="${s.name}">
            ${parseFloat(spW) > 8 ? escHtml(s.name) : ''}
          </div>
        </div>
      </div>
    `;

    // Resource rows for this sprint
    const assignedResources = [...new Set(sprintTasks(s.id).map(t=>t.assigneeId).filter(Boolean))];
    for (const rId of assignedResources) {
      const r = getResource(rId);
      if (!r) continue;
      const rTasks = state.tasks.filter(t=>t.sprintId===s.id && t.assigneeId===rId);
      const alloc  = rTasks.reduce((sum,t)=>sum+(t.estimatedHours||0),0);
      const cap    = resourceCapacityInSprint(rId, s.id);
      const pct    = cap ? Math.round(alloc/cap*100) : 0;
      const loadColor = pct > 110 ? 'var(--red)' : pct > 85 ? 'var(--yellow)' : r.color;

      // Task bars spread within the sprint period
      const taskBars = rTasks.map((t,idx) => {
        // Distribute tasks evenly within sprint as visual bands
        const slotW = Math.max(0.5, spLen / Math.max(rTasks.length,1));
        const tLeft = spStart + idx * slotW;
        const tW    = Math.max(0.5, slotW * 0.85);
        const leftPct = (tLeft/totalDays*100).toFixed(2);
        const wPct    = (tW/totalDays*100).toFixed(2);
        const taskColor = t.status==='done' ? 'var(--green)' : t.priority==='critical' ? 'var(--red)' : r.color;
        return `<div class="gantt-bar bar-task"
          style="left:${leftPct}%;width:${wPct}%;background:${taskColor}22;color:${taskColor};border:1px solid ${taskColor}55"
          title="${t.title} (${t.estimatedHours}h)"
          onclick="openTaskDetail('${t.id}')">
          ${parseFloat(wPct) > 5 ? escHtml(t.title.substring(0,20)) : ''}
        </div>`;
      }).join('');

      ganttRows += `
        <div class="gantt-row">
          <div class="gantt-row-label">
            <div class="task-assignee" style="background:${r.color}22;color:${r.color};width:22px;height:22px;font-size:8px;font-weight:700;border-radius:50%;display:flex;align-items:center;justify-content:center">${r.initials}</div>
            <div>
              <div style="font-size:12px;font-weight:600">${r.name}</div>
              <div class="gantt-row-sub">${alloc}h / ${cap}h (${pct}%)</div>
            </div>
          </div>
          <div class="gantt-chart-area" style="position:relative">
            ${dateHeaders.map((_,i)=>`<div class="gantt-grid-line" style="left:${(i/dateHeaders.length*100).toFixed(1)}%"></div>`).join('')}
            <div class="gantt-today-line" style="left:${todayPct}%"></div>
            <div class="gantt-bar bar-sprint" style="left:${spLeft}%;width:${spW}%;opacity:0.15;pointer-events:none"></div>
            ${taskBars}
          </div>
        </div>
      `;
    }
  }

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Timeline</div>
        <div class="section-subtitle">Gantt view across ${allSprints.length} sprints</div>
      </div>
      <div class="timeline-legend">
        <div class="legend-item"><div class="legend-dot" style="background:var(--accent);opacity:0.4"></div> Sprint</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Done</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> Critical</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--accent)"></div> Today</div>
      </div>
    </div>
    <div class="timeline-container">
      <div class="gantt-wrapper">
        <div class="gantt-head">
          <div class="gantt-label-col">Resource / Sprint</div>
          <div class="gantt-dates">${headCells}</div>
        </div>
        <div class="gantt-body">${ganttRows}</div>
      </div>
    </div>
  `;
}

// ── RESOURCES VIEW ────────────────────────────────────────────
function renderResources() {
  const el = $('#view-resources');

  const cards = state.resources.map(r => renderResourceCard(r)).join('');

  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Resources</div>
        <div class="section-subtitle">${state.resources.length} team members · capacity & allocation planning</div>
      </div>
      <button class="btn-primary" onclick="openResourceModal()">+ Add Resource</button>
    </div>
    <div class="resource-grid">
      ${cards}
      <div class="add-resource-card" onclick="openResourceModal()">
        <div class="plus-icon">+</div>
        <div>Add Team Member</div>
      </div>
    </div>
  `;
}

function renderResourceCard(r) {
  const sprintBreakdown = state.sprints.map(s => {
    const alloc = resourceAllocHours(r.id, s.id);
    if (alloc === 0) return '';
    const cap  = resourceCapacityInSprint(r.id, s.id);
    const pct  = cap ? clamp(Math.round(alloc/cap*100),0,200) : 0;
    const cls  = pct > 110 ? 'fill-over' : pct > 85 ? 'fill-warn' : 'fill-ok';
    return `<div class="rsb-row">
      <div class="rsb-sprint-name">${escHtml(s.name)}</div>
      <div class="rsb-bar-track"><div class="rsb-bar-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
      <div class="rsb-hours">${alloc}h / ${cap}h</div>
    </div>`;
  }).filter(Boolean).join('');

  const totalAlloc = state.sprints.reduce((s,sp) => s + resourceAllocHours(r.id, sp.id), 0);
  const totalCap   = state.sprints.reduce((s,sp) => s + resourceCapacityInSprint(r.id, sp.id), 0);
  const totalPct   = totalCap ? clamp(Math.round(totalAlloc/totalCap*100),0,200) : 0;
  const totalCls   = totalPct > 110 ? 'fill-over' : totalPct > 85 ? 'fill-warn' : 'fill-ok';

  return `
    <div class="resource-card">
      <div class="resource-card-header">
        <div class="resource-avatar" style="background:${r.color}22;color:${r.color}">${r.initials}</div>
        <div class="resource-info">
          <div class="resource-name">${escHtml(r.name)}</div>
          <div class="resource-role">${escHtml(r.role)}</div>
        </div>
        <div class="resource-capacity">
          <strong>${r.capacityPerDay}</strong><br>hrs/day
        </div>
      </div>
      <div class="resource-sprint-breakdown">
        <div class="rsb-title">Sprint Allocation</div>
        ${sprintBreakdown || '<div style="font-size:11px;color:var(--text3);padding:6px 0">No tasks assigned yet</div>'}
      </div>
      <div class="resource-total">
        <span>Total Load</span>
        <div class="resource-total-bar">
          <div class="rsb-bar-fill ${totalCls}" style="width:${Math.min(totalPct,100)}%;height:100%;border-radius:99px"></div>
        </div>
        <span>${totalAlloc}h / ${totalCap}h (${totalPct}%)</span>
      </div>
      <div class="resource-card-actions">
        <button class="btn-sm" style="flex:1" onclick="openResourceModal('${r.id}')">Edit</button>
        <button class="btn-sm accent" onclick="openAvailabilityModal('${r.id}')">📅 When Free?</button>
        <button class="btn-sm danger" onclick="confirmDeleteResource('${r.id}')">Remove</button>
      </div>
    </div>
  `;
}

// ── RESOURCE MODAL ────────────────────────────────────────────
function openResourceModal(id) {
  const r = id ? getResource(id) : null;
  const selectedColor = r?.color || COLORS[state.resources.length % COLORS.length];

  const swatches = COLORS.map(c =>
    `<div class="color-swatch ${c===selectedColor?'selected':''}" style="background:${c}"
      onclick="selectColor('${c}',this)" data-color="${c}"></div>`
  ).join('');

  openModal(`
    <div class="modal-content">
      <div class="modal-title">${r ? 'Edit Resource' : 'Add Resource'}</div>
      <div class="modal-sub">${r ? `Editing ${r.name}` : 'Add a new team member'}</div>
      <div class="form-grid">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Full Name *</label>
            <input class="form-input" id="fr-name" value="${escHtml(r?.name||'')}" placeholder="Priya Sharma">
          </div>
          <div class="form-group">
            <label class="form-label">Initials *</label>
            <input class="form-input" id="fr-init" maxlength="3" value="${escHtml(r?.initials||'')}" placeholder="PS">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Role / Designation</label>
            <input class="form-input" id="fr-role" value="${escHtml(r?.role||'')}" placeholder="Backend Dev">
          </div>
          <div class="form-group">
            <label class="form-label">Capacity (hrs/day)</label>
            <input class="form-input" type="number" id="fr-cap" min="1" max="12" step="0.5" value="${r?.capacityPerDay||6}" placeholder="6">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-row" id="color-row">${swatches}</div>
          <input type="hidden" id="fr-color" value="${selectedColor}">
        </div>
        <div class="form-actions">
          <button class="btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn-primary" onclick="saveResource('${r?.id||''}')">
            ${r ? 'Save Changes' : 'Add Resource'}
          </button>
        </div>
      </div>
    </div>
  `);
}

function selectColor(color, el) {
  $$('.color-swatch').forEach(s=>s.classList.remove('selected'));
  el.classList.add('selected');
  $('#fr-color').value = color;
}

async function saveResource(id) {
  const name  = $('#fr-name').value.trim();
  const init  = $('#fr-init').value.trim().toUpperCase();
  const role  = $('#fr-role').value.trim();
  const cap   = parseFloat($('#fr-cap').value)||6;
  const color = $('#fr-color').value;
  if (!name) { showToast('Name is required','error'); return; }
  const initials = init || name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  if (id) {
    const r = getResource(id);
    Object.assign(r, {name, initials, role, capacityPerDay:cap, color});
    await api.put(`/api/resources/${id}`, {name,initials,role,capacityPerDay:cap,color}).catch(console.error);
  } else {
    const res = await api.post('/api/resources', {name,initials,role,capacityPerDay:cap,color}).catch(console.error);
    const newId = res?.id || 'r'+genId();
    state.resources.push({ id:newId, name, role, color, capacityPerDay:cap, initials });
  }
  saveState(); closeModal();
  showToast(id ? 'Resource updated ✓':'Resource added ✓','success');
  renderView(state.activeView);
}

function confirmDeleteResource(id) {
  const r = getResource(id);
  const taskCount = state.tasks.filter(t=>t.assigneeId===id).length;
  openModal(`
    <div class="modal-content">
      <div class="modal-title">Remove Resource</div>
      <div class="modal-sub">This cannot be undone</div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
        Remove <strong>${escHtml(r?.name)}</strong>?
        They are assigned to <strong>${taskCount}</strong> tasks (tasks will become unassigned).
      </p>
      <div class="form-actions">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" style="background:var(--red)" onclick="deleteResource('${id}')">Remove</button>
      </div>
    </div>
  `);
}

async function deleteResource(id) {
  pushUndo();
  state.resources = state.resources.filter(r=>r.id!==id);
  state.tasks.forEach(t => { if (t.assigneeId===id) t.assigneeId=''; });
  await api.delete(`/api/resources/${id}`).catch(console.error);
  saveState(); closeModal();
  showToast('Resource removed','error');
  renderView(state.activeView);
}

// ── CSV EXPORT ────────────────────────────────────────────────
function exportCSV() {
  const rows = [['Sprint','Task ID','Title','Type','Priority','Status','Assignee','Role',
    'Story Points','Est. Hours','Logged Hours','Remaining Hours']];

  for (const t of state.tasks) {
    const s = getSprint(t.sprintId);
    const r = getResource(t.assigneeId);
    rows.push([
      s?.name||'',
      t.id, t.title, t.type, t.priority, t.status,
      r?.name||'Unassigned', r?.role||'',
      t.storyPoints||0, t.estimatedHours||0, t.loggedHours||0,
      Math.max(0,(t.estimatedHours||0)-(t.loggedHours||0))
    ]);
  }

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sprintforge-export-${today()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Exported to CSV âœ“','success');
}

async function syncUnsyncedTasks() {
  return syncUnsyncedTasksInternal(false);
}

let _syncInFlight = false;
let _syncInterval = null;

async function fetchServerTaskIds() {
  const existing = await fetch('/api/tasks');
  if (!existing.ok) throw new Error(`HTTP ${existing.status}`);
  const serverTasks = await existing.json();
  return new Set((serverTasks || []).map(t => t.id));
}

function setSyncAlert(isUnsynced) {
  const btn = $('#btn-sync');
  if (!btn) return;
  btn.classList.toggle('sync-alert', !!isUnsynced);
}

async function refreshSyncIndicator() {
  try {
    const serverIds = await fetchServerTaskIds();
    const hasUnsynced = state.tasks.some(t => t && t.id && !serverIds.has(t.id));
    setSyncAlert(hasUnsynced);
  } catch (e) {
    console.warn('Could not refresh sync indicator:', e.message);
  }
}

async function syncUnsyncedTasksInternal(silent) {
  if (_syncInFlight) return;
  _syncInFlight = true;
  const btn = $('#btn-sync');
  if (btn) btn.disabled = true;
  try {
    const serverIds = await fetchServerTaskIds();

    const unsynced = state.tasks.filter(t => t && t.id && !serverIds.has(t.id));
    if (!unsynced.length) {
      setSyncAlert(false);
      if (!silent) showToast('Everything already synced','info');
      return;
    }

    let synced = 0;
    let failed = 0;
    for (const t of unsynced) {
      try {
        const res = await api.post('/api/tasks', {
          sprintId: t.sprintId || '',
          title: t.title || 'Untitled',
          description: t.description || '',
          type: t.type || 'task',
          priority: t.priority || 'medium',
          status: t.status || 'todo',
          assigneeId: t.assigneeId || '',
          estimatedHours: t.estimatedHours || 0,
          loggedHours: t.loggedHours || 0,
          storyPoints: t.storyPoints || 0,
          dueDate: t.dueDate || '',
          doneDate: t.doneDate || '',
          dependsOn: t.dependsOn || [],
          tags: t.tags || [],
          scopeAddition: !!t.scopeAddition,
          originalSprint: t.originalSprint || t.sprintId || ''
        });
        if (res && res.id) t.id = res.id;
        synced += 1;
      } catch (e) {
        failed += 1;
        console.error('Task sync failed:', e);
      }
    }

    saveState();
    renderView(state.activeView);
    await refreshSyncIndicator();
    if (!silent) {
      showToast(failed ? `Synced ${synced}, failed ${failed}` : `Synced ${synced} task(s)`, failed ? 'info' : 'success');
    }
  } catch (e) {
    console.error(e);
    if (!silent) showToast('Sync failed: server unavailable','error');
  } finally {
    if (btn) btn.disabled = false;
    _syncInFlight = false;
  }
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === 'Escape') { closeModal(); clearSearch(); }
  if (isTyping) return;
  if (e.key === '/' ) { e.preventDefault(); focusSearch(); }
  if (e.key === '?' ) { openShortcutsModal(); }
  if (e.key === 'n' ) { setView('sprints'); setTimeout(() => openSprintModal(), 100); }
  if (e.key === '1' ) setView('dashboard');
  if (e.key === '2' ) setView('sprints');
  if (e.key === '3' ) setView('timeline');
  if (e.key === '4' ) setView('resources');
});

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  await loadState();

  // Nav tabs
  $$('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });
  $('#btn-new-sprint').addEventListener('click', () => {
    setView('sprints');
    setTimeout(() => openSprintModal(), 100);
  });
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-sync')?.addEventListener('click', syncUnsyncedTasks);
  $('#btn-shortcuts').addEventListener('click', openShortcutsModal);

  // Global search
  initSearch();

  await refreshSyncIndicator();
  if (_syncInterval) clearInterval(_syncInterval);
  _syncInterval = setInterval(async () => {
    await syncUnsyncedTasksInternal(true);
    await refreshSyncIndicator();
  }, 30000);

  // Initial render
  renderView('dashboard');
}

init();

// ── GLOBAL SEARCH ─────────────────────────────────────────────
let searchResultsEl = null;

function initSearch() {
  const input = $('#global-search');
  const kbd   = $('#search-kbd');
  if (!input) return;

  input.addEventListener('input', debounce(runSearch, 180));
  input.addEventListener('focus', () => { kbd && (kbd.style.display = 'none'); runSearch(); });
  input.addEventListener('blur',  () => {
    setTimeout(() => { closeSearchResults(); kbd && (kbd.style.display = ''); }, 200);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { clearSearch(); input.blur(); }
  });
}

function focusSearch() {
  const input = $('#global-search');
  if (input) { input.focus(); input.select(); }
}

function clearSearch() {
  const input = $('#global-search');
  if (input) input.value = '';
  closeSearchResults();
}

function closeSearchResults() {
  if (searchResultsEl) { searchResultsEl.remove(); searchResultsEl = null; }
}

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function runSearch() {
  const input = $('#global-search');
  if (!input) return;
  const q = input.value.trim().toLowerCase();
  closeSearchResults();
  if (!q) return;

  const results = state.tasks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    (t.description||'').toLowerCase().includes(q) ||
    (getResource(t.assigneeId)?.name||'').toLowerCase().includes(q)
  ).slice(0, 8);

  const wrap = document.createElement('div');
  wrap.className = 'search-results';
  wrap.innerHTML = results.length ? results.map(t => {
    const s = getSprint(t.sprintId);
    const r = getResource(t.assigneeId);
    return `<div class="search-result-item" onclick="handleSearchClick('${t.id}')">
      <span class="task-type-badge type-${t.type}">${t.type}</span>
      <div class="search-result-text">
        <div class="search-result-title">${highlight(escHtml(t.title), q)}</div>
        <div class="search-result-meta">${escHtml(s?.name||'')} ${r ? `· ${escHtml(r.name)}` : ''}</div>
      </div>
      <span class="sprint-badge badge-${t.status}" style="flex-shrink:0">${t.status}</span>
    </div>`;
  }).join('') : `<div class="search-empty">No tasks matching "<strong>${escHtml(q)}</strong>"</div>`;

  const searchWrap = input.closest('.search-wrap') || input.parentElement;
  searchWrap.style.position = 'relative';
  searchWrap.appendChild(wrap);
  searchResultsEl = wrap;
}

function highlight(text, q) {
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re, '<mark class="search-highlight">$1</mark>');
}

function handleSearchClick(taskId) {
  closeSearchResults();
  clearSearch();
  openTaskDetail(taskId);
}

// ── SPRINT FILTER (Sprints view) ───────────────────────────────
let sprintFilter = { priority: 'all', assignee: 'all', search: '' };

function renderSprintFilterBar() {
  const priorityOpts = ['all','critical','high','medium','low'].map(p =>
    `<button class="filter-chip ${sprintFilter.priority===p?'active':''}" onclick="setSprintFilter('priority','${p}')">${p==='all'?'All Priority':p}</button>`
  ).join('');

  const assigneeOpts = [{ id:'all', name:'All Members' }, ...state.resources].map(r =>
    `<button class="filter-chip ${sprintFilter.assignee===r.id?'active':''}" onclick="setSprintFilter('assignee','${r.id}')">${escHtml(r.name||r.id)}</button>`
  ).join('');

  return `<div class="filter-bar">
    <div class="filter-group">
      <span class="filter-label">Priority</span>
      <div class="filter-chips">${priorityOpts}</div>
    </div>
    <div class="filter-group">
      <span class="filter-label">Assignee</span>
      <div class="filter-chips">${assigneeOpts}</div>
    </div>
    <button class="filter-reset ${(sprintFilter.priority!=='all'||sprintFilter.assignee!=='all')?'visible':''}" onclick="resetSprintFilter()">Reset filters</button>
  </div>`;
}

function setSprintFilter(key, val) {
  sprintFilter[key] = val;
  renderSprints();
}
function resetSprintFilter() {
  sprintFilter = { priority:'all', assignee:'all', search:'' };
  renderSprints();
}

// Override renderSprints to include filter bar
const _origRenderSprints = renderSprints;
renderSprints = function() {
  const el = $('#view-sprints');
  const cards = state.sprints.length ? state.sprints.map(s => renderSprintCard(s)).join('') :
    `<div class="empty-state">
      <div class="empty-icon">◉</div>
      <div class="empty-title">No sprints yet</div>
      <div class="empty-desc">Click "New Sprint" to plan your first sprint</div>
    </div>`;
  el.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Sprints</div>
        <div class="section-subtitle">${state.sprints.length} sprints · ${state.tasks.length} tasks</div>
      </div>
      <button class="btn-primary" onclick="openSprintModal()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        New Sprint
      </button>
    </div>
    ${renderSprintFilterBar()}
    <div class="sprint-list" id="sprint-list">${cards}</div>`;
};

// Override renderKanban to apply filters
const _origRenderKanban = renderKanban;
renderKanban = function(sprintId) {
  const cols = [
    { key:'todo',       cls:'col-todo' },
    { key:'inprogress', cls:'col-inprogress' },
    { key:'done',       cls:'col-done' },
    { key:'blocked',    cls:'col-blocked' },
  ];
  const colsHtml = cols.map(({key,cls}) => {
    let tasks = tasksByStatus(sprintId, key);
    if (sprintFilter.priority !== 'all') tasks = tasks.filter(t => t.priority === sprintFilter.priority);
    if (sprintFilter.assignee !== 'all') tasks = tasks.filter(t => t.assigneeId === sprintFilter.assignee);
    const cards = tasks.map(t => renderTaskCard(t)).join('');
    const allCount = tasksByStatus(sprintId, key).length;
    const filtered = tasks.length !== allCount ? `<span style="color:var(--accent);margin-left:4px">${tasks.length}/${allCount}</span>` : '';
    return `<div class="kanban-col ${cls}">
        <div class="kanban-col-header">
          <span class="kanban-col-title">${STATUS_LABEL[key]}</span>
          <span class="kanban-col-count">${tasks.length}${filtered}</span>
        </div>
        <div class="task-cards">${cards}</div>
        <button class="add-task-btn" onclick="openTaskModal('${sprintId}','${key}')">+ Add Task</button>
      </div>`;
  }).join('');
  return `<div class="kanban-columns">${colsHtml}</div>`;
};

// ── BURNDOWN CHART (dashboard) ────────────────────────────────
function renderBurndownChart(sprint) {
  if (!sprint || !sprint.startDate || !sprint.endDate) return '';
  const tasks = sprintTasks(sprint.id);
  const totalPts = tasks.reduce((s,t) => s+(t.storyPoints||0), 0);
  if (!totalPts) return '';

  const start = new Date(sprint.startDate);
  const end   = new Date(sprint.endDate);
  const days  = Math.max(1, daysBetween(sprint.startDate, sprint.endDate));
  const todayStr = today();

  // Build ideal line & actual points
  const W = 340, H = 120, PAD = 28;
  const chartW = W - PAD * 2, chartH = H - PAD * 2;

  const ideal = Array.from({length: days+1}, (_,i) => ({
    x: PAD + (i/days)*chartW,
    y: PAD + (i/days)*chartH,
    pts: totalPts - (totalPts/days)*i
  }));

  // Actual remaining by day
  const doneTasks = tasks.filter(t => t.status === 'done');
  const donePoints = doneTasks.reduce((s,t) => s+(t.storyPoints||0), 0);
  const elapsedDays = Math.min(days, Math.max(0, daysBetween(sprint.startDate, todayStr)));
  const actuals = [
    { x: PAD, y: PAD, pts: totalPts },
    { x: PAD + (elapsedDays/days)*chartW, y: PAD + ((totalPts-donePoints)/totalPts)*chartH, pts: totalPts-donePoints }
  ];

  const idealPath = ideal.map((p,i) => `${i===0?'M':'L'}${p.x.toFixed(1)} ${(PAD+((p.pts/totalPts)*chartH)).toFixed(1)}`).join(' ');
  const actualPath = actuals.map((p,i) => `${i===0?'M':'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const actualArea = actualPath + ` L${actuals[actuals.length-1].x.toFixed(1)} ${PAD+chartH} L${PAD} ${PAD+chartH} Z`;

  // Y axis labels
  const yLabels = [0, totalPts/2, totalPts].map(v => ({
    y: PAD + ((1 - v/totalPts)*chartH),
    label: Math.round(v)
  }));

  return `<div class="burndown-wrap">
    <div class="burndown-header">
      <span class="dash-panel-title" style="margin:0">Burndown · ${escHtml(sprint.name)}</span>
      <span style="font-size:10px;font-family:var(--mono);color:var(--text3)">${donePoints}/${totalPts} pts done</span>
    </div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="burndown-svg">
      <defs>
        <linearGradient id="burnActualGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent2)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--accent2)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <!-- grid lines -->
      ${yLabels.map(l => `
        <line x1="${PAD}" y1="${l.y.toFixed(1)}" x2="${PAD+chartW}" y2="${l.y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PAD-4}" y="${(l.y+4).toFixed(1)}" fill="var(--text3)" font-size="9" text-anchor="end" font-family="JetBrains Mono,monospace">${l.label}</text>
      `).join('')}
      <!-- ideal line -->
      <path d="${idealPath}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-dasharray="4 3"/>
      <!-- actual area -->
      <path d="${actualArea}" fill="url(#burnActualGrad)"/>
      <!-- actual line -->
      <path d="${actualPath}" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-linecap="round"/>
      <!-- today dot -->
      <circle cx="${actuals[1].x.toFixed(1)}" cy="${actuals[1].y.toFixed(1)}" r="4" fill="var(--accent2)" stroke="var(--bg)" stroke-width="2"/>
      <!-- legend -->
      <line x1="${PAD}" y1="${H-8}" x2="${PAD+20}" y2="${H-8}" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-dasharray="4 3"/>
      <text x="${PAD+25}" y="${H-4}" fill="var(--text3)" font-size="9" font-family="JetBrains Mono,monospace">Ideal</text>
      <line x1="${PAD+70}" y1="${H-8}" x2="${PAD+90}" y2="${H-8}" stroke="var(--accent2)" stroke-width="2"/>
      <text x="${PAD+95}" y="${H-4}" fill="var(--text3)" font-size="9" font-family="JetBrains Mono,monospace">Actual</text>
    </svg>
  </div>`;
}

// Patch renderDashboard to include burndown chart
const _origRenderDashboard = renderDashboard;
renderDashboard = function() {
  _origRenderDashboard();
  const el = $('#view-dashboard');
  const dashGrid = el.querySelector('.dash-grid');
  if (!dashGrid) return;
  const activeSprint = state.sprints.find(s => s.status === 'active');
  const burndown = renderBurndownChart(activeSprint);
  if (burndown) {
    const burnPanel = document.createElement('div');
    burnPanel.className = 'dash-panel burndown-panel';
    burnPanel.innerHTML = burndown;
    dashGrid.appendChild(burnPanel);
  }
};

// ── KEYBOARD SHORTCUTS MODAL ──────────────────────────────────
function openShortcutsModal() {
  openModal(`<div class="modal-content">
    <div class="modal-title">Keyboard Shortcuts</div>
    <div class="modal-sub">Speed up your workflow</div>
    <div class="shortcuts-grid">
      <div class="shortcut-section">
        <div class="shortcut-section-title">Navigation</div>
        <div class="shortcut-row"><kbd class="shortcut-key">1</kbd><span>Dashboard</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">2</kbd><span>Sprints</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">3</kbd><span>Timeline</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">4</kbd><span>Resources</span></div>
      </div>
      <div class="shortcut-section">
        <div class="shortcut-section-title">Actions</div>
        <div class="shortcut-row"><kbd class="shortcut-key">n</kbd><span>New Sprint</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">/</kbd><span>Focus Search</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">?</kbd><span>This panel</span></div>
        <div class="shortcut-row"><kbd class="shortcut-key">Esc</kbd><span>Close / Clear</span></div>
      </div>
    </div>
    <div class="form-actions" style="padding-top:16px;border-top:1px solid var(--border2);margin-top:8px">
      <button class="btn-ghost" onclick="closeModal()">Close</button>
    </div>
  </div>`);
}

// ── SPRINT COMPLETION CELEBRATION ─────────────────────────────
function checkSprintCompletion(sprintId) {
  const tasks = sprintTasks(sprintId);
  if (!tasks.length) return;
  const allDone = tasks.every(t => t.status === 'done');
  if (!allDone) return;
  const sprint = getSprint(sprintId);
  const totalPts = tasks.reduce((s,t) => s+(t.storyPoints||0), 0);
  const totalHrs = tasks.reduce((s,t) => s+(t.loggedHours||0), 0);
  showCelebration(sprint, tasks.length, totalPts, totalHrs);
}

function showCelebration(sprint, taskCount, pts, hrs) {
  openModal(`<div class="modal-content celebration-modal">
    <div class="celebration-emoji">🎉</div>
    <div class="modal-title" style="text-align:center;margin-top:12px">Sprint Complete!</div>
    <div class="modal-sub" style="text-align:center">${escHtml(sprint?.name||'Sprint')} — All tasks done</div>
    <div class="celebration-stats">
      <div class="cele-stat">
        <div class="cele-val">${taskCount}</div>
        <div class="cele-label">Tasks Shipped</div>
      </div>
      <div class="cele-stat">
        <div class="cele-val">${pts}</div>
        <div class="cele-label">Story Points</div>
      </div>
      <div class="cele-stat">
        <div class="cele-val">${hrs}h</div>
        <div class="cele-label">Hours Logged</div>
      </div>
    </div>
    <div class="form-actions" style="justify-content:center;padding-top:16px;border-top:1px solid var(--border2)">
      <button class="btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn-primary" onclick="closeModal();openSprintModal()">Plan Next Sprint</button>
    </div>
  </div>`);
}

// Patch moveTask and updateLoggedHours to check completion
const _origMoveTask = moveTask;
moveTask = function(taskId, newStatus) {
  const t = state.tasks.find(x => x.id === taskId);
  if (t) { t.status = newStatus; saveState(); }
  showToast(`Moved to ${STATUS_LABEL[newStatus]} ✓`, 'success');
  closeModal();
  renderView(state.activeView);
  if (newStatus === 'done' && t) setTimeout(() => checkSprintCompletion(t.sprintId), 300);
};


