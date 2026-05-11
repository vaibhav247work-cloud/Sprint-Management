// ============================================================
//  SprintForge — server.js  (v4.0 — Relational Backend)
//  Proper SQLite tables · RESTful API · CORS secured · Validated
// ============================================================

const express    = require('express');
const sqlite3    = require('sqlite3').verbose();
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — restrict to localhost only ─────────────────────────
const ALLOWED = [
  `http://localhost:${PORT}`,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.ALLOWED_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, same-tab)
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE SETUP ────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, 'sprintforge.sqlite'));

// Promisified helpers
const dbRun = (sql, p = []) => new Promise((res, rej) =>
  db.run(sql, p, function (err) { err ? rej(err) : res(this); }));
const dbGet = (sql, p = []) => new Promise((res, rej) =>
  db.get(sql, p, (err, row) => err ? rej(err) : res(row)));
const dbAll = (sql, p = []) => new Promise((res, rej) =>
  db.all(sql, p, (err, rows) => err ? rej(err) : res(rows)));

function genId() { return Math.random().toString(36).slice(2, 9); }
function now()   { return new Date().toISOString(); }

// ── INIT TABLES ───────────────────────────────────────────────
async function initDB() {
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  await dbRun(`CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, goal TEXT DEFAULT '',
    start_date TEXT DEFAULT '', end_date TEXT DEFAULT '',
    status TEXT DEFAULT 'planning',
    created_at TEXT DEFAULT (datetime('now')))`);

  await dbRun(`CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT DEFAULT '',
    initials TEXT DEFAULT '', color TEXT DEFAULT '#6366f1',
    capacity_per_day REAL DEFAULT 6)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, sprint_id TEXT DEFAULT '',
    title TEXT NOT NULL, description TEXT DEFAULT '',
    type TEXT DEFAULT 'story', priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'todo', assignee_id TEXT DEFAULT '',
    estimated_hours REAL DEFAULT 0, logged_hours REAL DEFAULT 0,
    story_points INTEGER DEFAULT 0, due_date TEXT DEFAULT '',
    done_date TEXT DEFAULT '', depends_on TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]', scope_addition INTEGER DEFAULT 0,
    original_sprint TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')))`);

  await dbRun(`CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
    author TEXT DEFAULT 'Manager', text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')))`);

  await dbRun(`CREATE TABLE IF NOT EXISTS delay_reasons (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
    type TEXT DEFAULT 'Other', description TEXT NOT NULL,
    added_by TEXT DEFAULT 'Manager', date TEXT DEFAULT '',
    expected_resolution TEXT DEFAULT '')`);

  await dbRun(`CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY, type TEXT NOT NULL,
    timestamp TEXT NOT NULL, sprint_id TEXT DEFAULT '',
    task_id TEXT DEFAULT '', data TEXT DEFAULT '{}')`);

  await dbRun(`CREATE TABLE IF NOT EXISTS retrospectives (
    sprint_id TEXT PRIMARY KEY, went_well TEXT DEFAULT '',
    went_wrong TEXT DEFAULT '', improvements TEXT DEFAULT '',
    action_items TEXT DEFAULT '', saved_at TEXT DEFAULT '')`);

  await dbRun(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT DEFAULT '')`);

  await migrateLegacy();
}

// ── LEGACY BLOB MIGRATION ─────────────────────────────────────
async function migrateLegacy() {
  try {
    const oldTbl = await dbGet(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'`);
    if (!oldTbl) return;
    const done = await dbGet(`SELECT value FROM app_settings WHERE key='migrated_v4'`);
    if (done?.value === '1') return;

    const row = await dbGet(`SELECT state_data FROM app_state ORDER BY id DESC LIMIT 1`);
    if (!row?.state_data) return;

    const old = JSON.parse(row.state_data);

    for (const r of (old.resources || [])) {
      await dbRun(`INSERT OR IGNORE INTO resources VALUES (?,?,?,?,?,?)`,
        [r.id, r.name, r.role||'', r.initials||'', r.color||'#6366f1', r.capacityPerDay||6]);
    }
    for (const s of (old.sprints || [])) {
      await dbRun(`INSERT OR IGNORE INTO sprints (id,name,goal,start_date,end_date,status) VALUES (?,?,?,?,?,?)`,
        [s.id, s.name, s.goal||'', s.startDate||'', s.endDate||'', s.status||'planning']);
    }
    for (const t of (old.tasks || [])) {
      await dbRun(`INSERT OR IGNORE INTO tasks
        (id,sprint_id,title,description,type,priority,status,assignee_id,
         estimated_hours,logged_hours,story_points,due_date,done_date,
         depends_on,tags,scope_addition,original_sprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [t.id, t.sprintId, t.title, t.description||'', t.type||'story',
         t.priority||'medium', t.status||'todo', t.assigneeId||'',
         t.estimatedHours||0, t.loggedHours||0, t.storyPoints||0,
         t.dueDate||'', t.doneDate||'',
         JSON.stringify(t.dependsOn||[]), JSON.stringify(t.tags||[]),
         t.scopeAddition?1:0, t.originalSprint||t.sprintId||'']);
      for (const dr of (t.delayReasons||[])) {
        await dbRun(`INSERT OR IGNORE INTO delay_reasons VALUES (?,?,?,?,?,?,?)`,
          [dr.id||genId(), t.id, dr.type||'Other', dr.description||'',
           dr.addedBy||'Manager', dr.date||'', dr.expectedResolution||'']);
      }
    }
    for (const l of (old.activityLog||[])) {
      const { id, type, timestamp, sprintId, taskId, ...rest } = l;
      await dbRun(`INSERT OR IGNORE INTO activity_log VALUES (?,?,?,?,?,?)`,
        [id||genId(), type, timestamp, sprintId||'', taskId||'', JSON.stringify(rest)]);
    }
    for (const [sid, retro] of Object.entries(old.retrospectives||{})) {
      await dbRun(`INSERT OR IGNORE INTO retrospectives VALUES (?,?,?,?,?,?)`,
        [sid, retro.wentWell||'', retro.wentWrong||'',
         retro.improvements||'', retro.actionItems||'', retro.savedAt||'']);
    }
    await dbRun(`INSERT OR REPLACE INTO app_settings VALUES ('migrated_v4','1')`);
    console.log('✅ Legacy data migrated to relational tables');
  } catch (e) {
    console.error('Migration warning (non-fatal):', e.message);
  }
}

// ── VALIDATION ────────────────────────────────────────────────
const SPRINT_STATUSES = ['planning','active','completed'];
const TASK_TYPES      = ['story','bug','task','subtask'];
const TASK_PRIORITIES = ['critical','high','medium','low'];
const TASK_STATUSES   = ['todo','inprogress','done','blocked'];

function validateSprint(b) {
  if (!b.name?.trim()) return 'Sprint name is required';
  if (b.status && !SPRINT_STATUSES.includes(b.status)) return 'Invalid status';
  if (b.startDate && b.endDate && b.startDate > b.endDate) return 'End date must be after start';
  return null;
}
function validateTask(b) {
  if (!b.title?.trim()) return 'Task title is required';
  if (b.type     && !TASK_TYPES.includes(b.type))         return 'Invalid type';
  if (b.priority && !TASK_PRIORITIES.includes(b.priority)) return 'Invalid priority';
  if (b.status   && !TASK_STATUSES.includes(b.status))     return 'Invalid status';
  return null;
}
function validateResource(b) {
  if (!b.name?.trim()) return 'Name is required';
  return null;
}

// ── ASYNC HANDLER ─────────────────────────────────────────────
const wrap = fn => (req, res, next) => fn(req, res).catch(e => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// ── SERIALIZERS ───────────────────────────────────────────────
function serializeSprint(r) {
  return { id:r.id, name:r.name, goal:r.goal, startDate:r.start_date,
           endDate:r.end_date, status:r.status };
}
function serializeResource(r) {
  return { id:r.id, name:r.name, role:r.role, initials:r.initials,
           color:r.color, capacityPerDay:r.capacity_per_day };
}
function serializeTask(r, comments=[], delays=[]) {
  return {
    id:r.id, sprintId:r.sprint_id, title:r.title, description:r.description,
    type:r.type, priority:r.priority, status:r.status, assigneeId:r.assignee_id,
    estimatedHours:r.estimated_hours, loggedHours:r.logged_hours,
    storyPoints:r.story_points, dueDate:r.due_date, doneDate:r.done_date,
    dependsOn:JSON.parse(r.depends_on||'[]'), tags:JSON.parse(r.tags||'[]'),
    scopeAddition:!!r.scope_addition, originalSprint:r.original_sprint,
    comments: comments.map(c=>({id:c.id,author:c.author,text:c.text,createdAt:c.created_at})),
    delayReasons: delays.map(d=>({id:d.id,type:d.type,description:d.description,
      addedBy:d.added_by, date:d.date, expectedResolution:d.expected_resolution}))
  };
}

async function enrichTasks(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const ph  = ids.map(() => '?').join(',');
  const comments = await dbAll(`SELECT * FROM task_comments WHERE task_id IN (${ph}) ORDER BY created_at`, ids);
  const delays   = await dbAll(`SELECT * FROM delay_reasons  WHERE task_id IN (${ph}) ORDER BY date`, ids);
  return rows.map(r => serializeTask(r,
    comments.filter(c => c.task_id === r.id),
    delays.filter(d => d.task_id === r.id)));
}

// ── SPRINTS API ───────────────────────────────────────────────
app.get('/api/sprints', wrap(async (req, res) => {
  const rows = await dbAll(`SELECT * FROM sprints ORDER BY created_at`);
  res.json(rows.map(serializeSprint));
}));

app.post('/api/sprints', wrap(async (req, res) => {
  const err = validateSprint(req.body); if (err) return res.status(400).json({ error: err });
  const { name, goal='', startDate='', endDate='', status='planning' } = req.body;
  const id = 's'+genId();
  await dbRun(`INSERT INTO sprints (id,name,goal,start_date,end_date,status) VALUES (?,?,?,?,?,?)`,
    [id, name.trim(), goal.trim(), startDate, endDate, status]);
  res.json(serializeSprint({ id, name:name.trim(), goal:goal.trim(),
    start_date:startDate, end_date:endDate, status }));
}));

app.put('/api/sprints/:id', wrap(async (req, res) => {
  const err = validateSprint(req.body); if (err) return res.status(400).json({ error: err });
  const { name, goal='', startDate='', endDate='', status='planning' } = req.body;
  await dbRun(`UPDATE sprints SET name=?,goal=?,start_date=?,end_date=?,status=? WHERE id=?`,
    [name.trim(), goal.trim(), startDate, endDate, status, req.params.id]);
  res.json({ success: true });
}));

app.delete('/api/sprints/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const taskIds = (await dbAll(`SELECT id FROM tasks WHERE sprint_id=?`,[id])).map(r=>r.id);
  if (taskIds.length) {
    const ph = taskIds.map(()=>'?').join(',');
    await dbRun(`DELETE FROM task_comments  WHERE task_id IN (${ph})`, taskIds);
    await dbRun(`DELETE FROM delay_reasons  WHERE task_id IN (${ph})`, taskIds);
    await dbRun(`DELETE FROM tasks          WHERE sprint_id=?`, [id]);
  }
  await dbRun(`DELETE FROM retrospectives WHERE sprint_id=?`, [id]);
  await dbRun(`DELETE FROM sprints        WHERE id=?`, [id]);
  res.json({ success: true });
}));

// ── TASKS API ─────────────────────────────────────────────────
app.get('/api/tasks', wrap(async (req, res) => {
  const rows = req.query.sprintId
    ? await dbAll(`SELECT * FROM tasks WHERE sprint_id=? ORDER BY created_at`, [req.query.sprintId])
    : await dbAll(`SELECT * FROM tasks ORDER BY created_at`);
  res.json(await enrichTasks(rows));
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const err = validateTask(req.body); if (err) return res.status(400).json({ error: err });
  const {
    sprintId='', title, description='', type='story', priority='medium', status='todo',
    assigneeId='', estimatedHours=0, loggedHours=0, storyPoints=0,
    dueDate='', doneDate='', dependsOn=[], tags=[], scopeAddition=false, originalSprint=''
  } = req.body;
  const id = 't'+genId();
  await dbRun(`INSERT INTO tasks
    (id,sprint_id,title,description,type,priority,status,assignee_id,
     estimated_hours,logged_hours,story_points,due_date,done_date,
     depends_on,tags,scope_addition,original_sprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,sprintId,title.trim(),description.trim(),type,priority,status,assigneeId,
     estimatedHours,loggedHours,storyPoints,dueDate,doneDate,
     JSON.stringify(dependsOn),JSON.stringify(tags),scopeAddition?1:0,originalSprint||sprintId]);
  res.json(serializeTask({
    id,sprint_id:sprintId,title:title.trim(),description:description.trim(),type,priority,status,
    assignee_id:assigneeId,estimated_hours:estimatedHours,logged_hours:loggedHours,
    story_points:storyPoints,due_date:dueDate,done_date:doneDate,
    depends_on:JSON.stringify(dependsOn),tags:JSON.stringify(tags),
    scope_addition:scopeAddition?1:0,original_sprint:originalSprint||sprintId
  },[],[]));
}));

app.put('/api/tasks/:id', wrap(async (req, res) => {
  const err = validateTask(req.body); if (err) return res.status(400).json({ error: err });
  const {
    sprintId='', title, description='', type='story', priority='medium', status='todo',
    assigneeId='', estimatedHours=0, loggedHours=0, storyPoints=0,
    dueDate='', doneDate='', dependsOn=[], tags=[], scopeAddition=false, originalSprint=''
  } = req.body;
  await dbRun(`UPDATE tasks SET
    sprint_id=?,title=?,description=?,type=?,priority=?,status=?,assignee_id=?,
    estimated_hours=?,logged_hours=?,story_points=?,due_date=?,done_date=?,
    depends_on=?,tags=?,scope_addition=?,original_sprint=? WHERE id=?`,
    [sprintId,title.trim(),description.trim(),type,priority,status,assigneeId,
     estimatedHours,loggedHours,storyPoints,dueDate,doneDate,
     JSON.stringify(dependsOn),JSON.stringify(tags),scopeAddition?1:0,originalSprint,req.params.id]);
  res.json({ success: true });
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  const id = req.params.id;
  await dbRun(`DELETE FROM task_comments WHERE task_id=?`,[id]);
  await dbRun(`DELETE FROM delay_reasons  WHERE task_id=?`,[id]);
  await dbRun(`DELETE FROM tasks          WHERE id=?`,[id]);
  res.json({ success: true });
}));

app.post('/api/tasks/:id/comments', wrap(async (req, res) => {
  const { author='Manager', text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });
  const id = 'c'+genId(), createdAt = now();
  await dbRun(`INSERT INTO task_comments (id,task_id,author,text,created_at) VALUES (?,?,?,?,?)`,
    [id, req.params.id, author, text.trim(), createdAt]);
  res.json({ id, taskId:req.params.id, author, text:text.trim(), createdAt });
}));

app.post('/api/tasks/:id/delay-reasons', wrap(async (req, res) => {
  const { type='Other', description, addedBy='Manager', date='', expectedResolution='' } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'Description required' });
  const id = 'dr'+genId();
  await dbRun(`INSERT INTO delay_reasons (id,task_id,type,description,added_by,date,expected_resolution) VALUES (?,?,?,?,?,?,?)`,
    [id,req.params.id,type,description.trim(),addedBy,date,expectedResolution]);
  res.json({ id, taskId:req.params.id, type, description:description.trim(), addedBy, date, expectedResolution });
}));

// ── RESOURCES API ─────────────────────────────────────────────
app.get('/api/resources', wrap(async (req, res) => {
  res.json((await dbAll(`SELECT * FROM resources ORDER BY rowid`)).map(serializeResource));
}));

app.post('/api/resources', wrap(async (req, res) => {
  const err = validateResource(req.body); if (err) return res.status(400).json({ error: err });
  const { name, role='', initials='', color='#6366f1', capacityPerDay=6 } = req.body;
  const id = 'r'+genId();
  const auto = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  await dbRun(`INSERT INTO resources (id,name,role,initials,color,capacity_per_day) VALUES (?,?,?,?,?,?)`,
    [id,name.trim(),role.trim(),(initials||auto).toUpperCase(),color,capacityPerDay]);
  res.json(serializeResource({ id,name:name.trim(),role:role.trim(),
    initials:(initials||auto).toUpperCase(),color,capacity_per_day:capacityPerDay }));
}));

app.put('/api/resources/:id', wrap(async (req, res) => {
  const err = validateResource(req.body); if (err) return res.status(400).json({ error: err });
  const { name, role='', initials='', color='#6366f1', capacityPerDay=6 } = req.body;
  const auto = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  await dbRun(`UPDATE resources SET name=?,role=?,initials=?,color=?,capacity_per_day=? WHERE id=?`,
    [name.trim(),role.trim(),(initials||auto).toUpperCase(),color,capacityPerDay,req.params.id]);
  res.json({ success: true });
}));

app.delete('/api/resources/:id', wrap(async (req, res) => {
  await dbRun(`UPDATE tasks SET assignee_id='' WHERE assignee_id=?`,[req.params.id]);
  await dbRun(`DELETE FROM resources WHERE id=?`,[req.params.id]);
  res.json({ success: true });
}));

// ── ACTIVITY LOG API ──────────────────────────────────────────
app.get('/api/activity-log', wrap(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || 50), 200);
  const offset = parseInt(req.query.offset || 0);
  const total  = (await dbGet(`SELECT COUNT(*) AS c FROM activity_log`)).c;
  const rows   = await dbAll(`SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ? OFFSET ?`,[limit,offset]);
  res.json({
    total, limit, offset,
    items: rows.map(r => ({ id:r.id, type:r.type, timestamp:r.timestamp,
      sprintId:r.sprint_id, taskId:r.task_id, ...JSON.parse(r.data||'{}') }))
  });
}));

app.post('/api/activity-log', wrap(async (req, res) => {
  const { type, timestamp, sprintId='', taskId='', ...rest } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const id = genId();
  await dbRun(`INSERT INTO activity_log (id,type,timestamp,sprint_id,task_id,data) VALUES (?,?,?,?,?,?)`,
    [id, type, timestamp||now(), sprintId, taskId, JSON.stringify(rest)]);
  // Keep last 1000
  await dbRun(`DELETE FROM activity_log WHERE id NOT IN
    (SELECT id FROM activity_log ORDER BY timestamp DESC LIMIT 1000)`);
  res.json({ success: true, id });
}));

app.delete('/api/activity-log', wrap(async (req, res) => {
  await dbRun(`DELETE FROM activity_log`);
  res.json({ success: true });
}));

// ── RETROSPECTIVES API ────────────────────────────────────────
app.get('/api/retrospectives/:sprintId', wrap(async (req, res) => {
  const row = await dbGet(`SELECT * FROM retrospectives WHERE sprint_id=?`,[req.params.sprintId]);
  if (!row) return res.json(null);
  res.json({ sprintId:row.sprint_id, wentWell:row.went_well, wentWrong:row.went_wrong,
    improvements:row.improvements, actionItems:row.action_items, savedAt:row.saved_at });
}));

app.put('/api/retrospectives/:sprintId', wrap(async (req, res) => {
  const { wentWell='', wentWrong='', improvements='', actionItems='' } = req.body;
  await dbRun(`INSERT OR REPLACE INTO retrospectives
    (sprint_id,went_well,went_wrong,improvements,action_items,saved_at) VALUES (?,?,?,?,?,?)`,
    [req.params.sprintId, wentWell, wentWrong, improvements, actionItems, now().slice(0,10)]);
  res.json({ success: true });
}));

// ── SETTINGS ──────────────────────────────────────────────────
app.get('/api/settings', wrap(async (req, res) => {
  const rows = await dbAll(`SELECT key,value FROM app_settings`);
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
}));

app.put('/api/settings/:key', wrap(async (req, res) => {
  await dbRun(`INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)`,
    [req.params.key, req.body.value ?? '']);
  res.json({ success: true });
}));

// ── BULK LOAD (one-shot for initial page render) ───────────────
app.get('/api/all', wrap(async (req, res) => {
  const [sprints, resources, tasks, settings] = await Promise.all([
    dbAll(`SELECT * FROM sprints ORDER BY created_at`),
    dbAll(`SELECT * FROM resources ORDER BY rowid`),
    dbAll(`SELECT * FROM tasks ORDER BY created_at`),
    dbAll(`SELECT key,value FROM app_settings`),
  ]);
  const taskIds = tasks.map(r=>r.id);
  let comments = [], delays = [];
  if (taskIds.length) {
    const ph = taskIds.map(()=>'?').join(',');
    [comments, delays] = await Promise.all([
      dbAll(`SELECT * FROM task_comments WHERE task_id IN (${ph}) ORDER BY created_at`, taskIds),
      dbAll(`SELECT * FROM delay_reasons  WHERE task_id IN (${ph}) ORDER BY date`, taskIds),
    ]);
  }
  const settingsObj = {};
  settings.forEach(r => { settingsObj[r.key] = r.value; });
  res.json({
    sprints: sprints.map(serializeSprint),
    resources: resources.map(serializeResource),
    tasks: tasks.map(r => serializeTask(r,
      comments.filter(c=>c.task_id===r.id),
      delays.filter(d=>d.task_id===r.id))),
    settings: settingsObj,
  });
}));

// ── LEGACY COMPAT: old /api/state still works ────────────────
app.get('/api/state', wrap(async (req, res) => {
  const data = (await (fetch||null)) ? null : null; // forward to /api/all
  const [sprints,resources,tasks,retros,logs] = await Promise.all([
    dbAll(`SELECT * FROM sprints ORDER BY created_at`),
    dbAll(`SELECT * FROM resources ORDER BY rowid`),
    dbAll(`SELECT * FROM tasks ORDER BY created_at`),
    dbAll(`SELECT * FROM retrospectives`),
    dbAll(`SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 500`),
  ]);
  const taskIds = tasks.map(r=>r.id);
  let comments=[],delays=[];
  if (taskIds.length) {
    const ph=taskIds.map(()=>'?').join(',');
    [comments,delays]=await Promise.all([
      dbAll(`SELECT * FROM task_comments WHERE task_id IN (${ph})`,taskIds),
      dbAll(`SELECT * FROM delay_reasons  WHERE task_id IN (${ph})`,taskIds),
    ]);
  }
  const retrospectives={};
  retros.forEach(r=>{retrospectives[r.sprint_id]={wentWell:r.went_well,wentWrong:r.went_wrong,
    improvements:r.improvements,actionItems:r.action_items,savedAt:r.saved_at};});
  res.json({
    sprints:sprints.map(serializeSprint),
    resources:resources.map(serializeResource),
    tasks:tasks.map(r=>serializeTask(r,comments.filter(c=>c.task_id===r.id),delays.filter(d=>d.task_id===r.id))),
    retrospectives,
    activityLog:logs.map(r=>({id:r.id,type:r.type,timestamp:r.timestamp,sprintId:r.sprint_id,taskId:r.task_id,...JSON.parse(r.data||'{}')})),
    activeView:'dashboard',
  });
}));

// ── START ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 SprintForge running → http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
