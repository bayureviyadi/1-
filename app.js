/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║        MULAI DULU — Dashboard app.js (Minimal UI)        ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Schema  ▸  see schema comments at top of each DB section
 * Storage ▸  LocalStorage (keyed by LS_KEYS)
 * Ready for migration to Firebase / Supabase:
 *   – all reads/writes go through DB.* functions
 *   – IDs are UUID v4
 *   – dates are ISO-8601 strings or "YYYY-MM-DD"
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const LS = {
  USER:  'md_user',
  TASKS: 'md_tasks',
  LOGS:  'md_logs',
};

const TIMER_SEC     = 5 * 60;   // 5 minutes
const MAX_TODAY     = 5;        // max pending tasks shown in Today View
const MAX_SHIELDS   = 3;
const XP_PER_START  = 10;
const XP_PER_DONE   = 25;
const XP_PER_LEVEL  = 100;

const MOTIVATIONS = [
  'Tidak perlu selesai — cukup mulai.',
  '5 menit sekarang > 1 jam nanti.',
  'Gerakan kecil mengalahkan rencana besar.',
  'Otak butuh bukti, bukan janji.',
  'Progres, bukan kesempurnaan.',
  'Satu langkah sudah cukup untuk hari ini.',
];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const toDateStr  = (d = new Date()) => d.toISOString().split('T')[0];
const daysDiff   = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

let _toastTimer = null;
function toast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
// DATA ACCESS LAYER
// ─────────────────────────────────────────────────────────────

/**
 * SCHEMA · users
 * {
 *   id, displayName, createdAt,
 *   streak, lastActiveDate,
 *   streakShields,             // 0–3
 *   totalStarts, totalDone,
 *   xp, level
 * }
 */

/**
 * SCHEMA · tasks
 * {
 *   id, userId, title, category,   // category: kuliah|kerja|pribadi
 *   status,                        // 'pending' | 'done'
 *   startedCount,
 *   createdAt, updatedAt, doneAt   // ISO-8601 or null
 * }
 */

/**
 * SCHEMA · daily_logs  (keyed by "YYYY-MM-DD")
 * {
 *   id, userId, date,
 *   totalStarts, totalDone,
 *   shieldUsed,
 *   sessions: [{ taskId, taskTitle, startedAt, durationSec }],
 *   reflection: { mood, wentWell, obstacle, tomorrow, savedAt }
 * }
 */

const DB = {
  /* USER */
  user()          { const r = localStorage.getItem(LS.USER); return r ? JSON.parse(r) : null; },
  saveUser(u)     { localStorage.setItem(LS.USER, JSON.stringify(u)); },

  /* TASKS */
  tasks()         { const r = localStorage.getItem(LS.TASKS); return r ? JSON.parse(r) : []; },
  saveTasks(arr)  { localStorage.setItem(LS.TASKS, JSON.stringify(arr)); },
  addTask(t)      { const a = this.tasks(); a.unshift(t); this.saveTasks(a); },
  updateTask(id, patch) {
    this.saveTasks(this.tasks().map(t =>
      t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
  },
  deleteTask(id)  { this.saveTasks(this.tasks().filter(t => t.id !== id)); },

  /* LOGS */
  logs()          { const r = localStorage.getItem(LS.LOGS); return r ? JSON.parse(r) : {}; },
  log(date)       { return this.logs()[date] || null; },
  saveLog(date, l){ const all = this.logs(); all[date] = l; localStorage.setItem(LS.LOGS, JSON.stringify(all)); },
  todayLog()      { return this.log(toDateStr()); },
};

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

function init() {
  if (!DB.user()) {
    DB.saveUser({
      id: uuid(), displayName: 'Pejuang', createdAt: new Date().toISOString(),
      streak: 0, lastActiveDate: null, streakShields: 2,
      totalStarts: 0, totalDone: 0, xp: 0, level: 1,
    });
    document.getElementById('welcome-banner') &&
      document.getElementById('welcome-banner').classList.remove('hidden');
  }
  ensureTodayLog();
  checkStreak();

  // Staggered reveal
  requestAnimationFrame(() => {
    document.querySelectorAll('.reveal-item').forEach(el => el.classList.add('go'));
  });
}

function ensureTodayLog() {
  const today = toDateStr();
  if (!DB.log(today)) {
    const u = DB.user();
    DB.saveLog(today, {
      id: `${u.id}_${today}`, userId: u.id, date: today,
      totalStarts: 0, totalDone: 0, shieldUsed: false,
      sessions: [],
      reflection: { mood: null, wentWell: '', obstacle: '', tomorrow: '', savedAt: null },
    });
  }
}

function checkStreak() {
  const u = DB.user();
  if (!u.lastActiveDate) return;
  const today = toDateStr();
  const diff  = daysDiff(u.lastActiveDate, today);
  if (diff <= 1) return;

  if (diff === 2 && u.streakShields > 0) {
    u.streakShields--;
    const missed = toDateStr(new Date(Date.now() - 86400000));
    const ml = DB.log(missed) || {
      id: `${u.id}_${missed}`, userId: u.id, date: missed,
      totalStarts: 0, totalDone: 0, shieldUsed: true,
      sessions: [], reflection: { mood: null, wentWell: '', obstacle: '', tomorrow: '', savedAt: null },
    };
    ml.shieldUsed = true;
    DB.saveLog(missed, ml);
    DB.saveUser(u);
    toast('🛡️ Shield melindungi streak-mu!', 3000);
  } else if (diff > 1) {
    u.streak = 0;
    DB.saveUser(u);
  }
}

// ─────────────────────────────────────────────────────────────
// TASK LOGIC
// ─────────────────────────────────────────────────────────────

let selectedTaskId = null;

function makeTask(title, category) {
  const u = DB.user();
  return {
    id: uuid(), userId: u.id, title: title.trim(), category,
    status: 'pending', startedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
  };
}

function addTask(title, category) {
  if (!title.trim()) { toast('⚠ Judul tugas tidak boleh kosong'); return; }
  DB.addTask(makeTask(title, category));
  renderAll();
  toast('✓ Tugas ditambahkan');
}

function markDone(id) {
  DB.updateTask(id, { status: 'done', doneAt: new Date().toISOString() });
  const u  = DB.user();
  const lg = DB.todayLog();
  lg.totalDone++;
  DB.saveLog(toDateStr(), lg);
  u.totalDone++;
  u.xp = (u.xp || 0) + XP_PER_DONE;
  checkLevelUp(u);
  DB.saveUser(u);
  if (selectedTaskId === id) clearFocus();
  renderAll();
  toast('🌿 Quest selesai! +25 XP');
}

function deleteTask(id) {
  if (selectedTaskId === id) clearFocus();
  DB.deleteTask(id);
  renderAll();
}

function selectTask(id) {
  if (timerRunning) return;
  selectedTaskId = id;
  renderAll();
}

function clearFocus() {
  selectedTaskId = null;
}

// ─────────────────────────────────────────────────────────────
// TIMER LOGIC
// ─────────────────────────────────────────────────────────────

let timerRunning  = false;
let timerSec      = TIMER_SEC;
let timerInterval = null;
let sessionStart  = null;

function startTimer() {
  if (!selectedTaskId) return;
  timerRunning = true;
  timerSec     = TIMER_SEC;
  sessionStart = new Date().toISOString();

  // Record start
  const task = DB.tasks().find(t => t.id === selectedTaskId);
  if (!task) return;
  DB.updateTask(selectedTaskId, { startedCount: task.startedCount + 1 });

  const today = toDateStr();
  const lg    = DB.todayLog();
  lg.totalStarts++;
  lg.sessions.push({ taskId: selectedTaskId, taskTitle: task.title, startedAt: sessionStart, durationSec: 0 });
  DB.saveLog(today, lg);

  const u = DB.user();
  u.totalStarts++;
  u.xp = (u.xp || 0) + XP_PER_START;
  if (u.lastActiveDate !== today) {
    const diff = u.lastActiveDate ? daysDiff(u.lastActiveDate, today) : 0;
    if (diff <= 1) u.streak = (u.streak || 0) + 1;
    u.lastActiveDate = today;
  }
  checkLevelUp(u);
  DB.saveUser(u);

  updateTimerUI();
  renderAll();

  timerInterval = setInterval(() => {
    timerSec--;
    // update session duration
    const lg2 = DB.todayLog();
    if (lg2.sessions.length) {
      lg2.sessions[lg2.sessions.length - 1].durationSec = TIMER_SEC - timerSec;
      DB.saveLog(today, lg2);
    }
    updateTimerUI();
    if (timerSec <= 0) stopTimer(true);
  }, 1000);
}

function stopTimer(finished = false) {
  clearInterval(timerInterval);
  timerRunning = false;
  timerSec     = TIMER_SEC;
  updateTimerUI();
  renderAll();
  if (finished) toast('🎉 5 menit selesai! Kamu sudah mulai!', 3500);
  else          toast('✋ Sesi dihentikan — setiap detik tetap berarti');
}

function updateTimerUI() {
  const m = String(Math.floor(timerSec / 60)).padStart(2,'0');
  const s = String(timerSec % 60).padStart(2,'0');

  const disp   = document.getElementById('timer-display');
  const status = document.getElementById('timer-status');
  const btn    = document.getElementById('start-btn');
  const icon   = document.getElementById('start-icon');
  const label  = document.getElementById('start-label');

  disp.textContent = `${m}:${s}`;
  disp.classList.toggle('running', timerRunning);

  if (timerRunning) {
    status.textContent = 'Fokus…  jangan berhenti dulu';
    btn.classList.add('running');
    icon.innerHTML = '<rect x="6" y="6" width="5" height="16" rx="1" fill="white"/><rect x="17" y="6" width="5" height="16" rx="1" fill="white"/>';
    label.innerHTML = 'Berhenti';
    // hide pulse rings while running
    ['ring1','ring2','ring3'].forEach(id => {
      document.getElementById(id).style.animationPlayState = 'paused';
      document.getElementById(id).style.opacity = '0';
    });
  } else {
    status.textContent = '5 menit · cukup untuk memulai';
    btn.classList.remove('running');
    icon.innerHTML = '<path d="M10 7l12 7-12 7V7z" fill="white"/>';
    label.innerHTML = 'Mulai 5 Menit<br/>Sekarang';
    ['ring1','ring2','ring3'].forEach(id => {
      document.getElementById(id).style.animationPlayState = '';
      document.getElementById(id).style.opacity = '';
    });
  }
}

// ─────────────────────────────────────────────────────────────
// LEVEL UP
// ─────────────────────────────────────────────────────────────

function checkLevelUp(u) {
  const newLevel = Math.floor((u.xp || 0) / XP_PER_LEVEL) + 1;
  if (newLevel > (u.level || 1)) {
    u.level = newLevel;
    // brief visual indicator via toast (full modal overkill for minimal UI)
    setTimeout(() => toast(`⭐ Level ${newLevel} tercapai! Luar biasa!`, 3000), 400);
  }
}

// ─────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────

function renderAll() {
  renderHeader();
  renderTaskList();
  renderFocus();
  renderProgress();
}

/* ── Header ── */
function renderHeader() {
  const u = DB.user();

  // Greeting
  const h = new Date().getHours();
  const greet = h < 12 ? 'Selamat pagi' : h < 17 ? 'Selamat siang' : 'Selamat malam';
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = greet;

  // Date
  const dateEl = document.getElementById('date-text');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }

  // Nav streak
  const ns = document.getElementById('nav-streak-num');
  if (ns) ns.textContent = u ? u.streak : 0;
}

/* ── Task list (Today View) ── */
function renderTaskList() {
  const allTasks  = DB.tasks();
  const pending   = allTasks.filter(t => t.status === 'pending');
  const shown     = pending.slice(0, MAX_TODAY);
  const warehouse = pending.slice(MAX_TODAY).length + allTasks.filter(t => t.status === 'done').length;

  // Pending count
  const pc = document.getElementById('pending-count');
  if (pc) pc.textContent = pending.length ? `(${pending.length})` : '';

  // Warehouse count
  const wc = document.getElementById('warehouse-count');
  if (wc) wc.textContent = allTasks.length - shown.filter(t=>t.status==='pending').length +
    allTasks.filter(t=>t.status==='done').length;

  // Clear-done button
  const cd = document.getElementById('clear-done-btn');
  if (cd) cd.classList.toggle('hidden', allTasks.every(t => t.status !== 'done'));

  const list  = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');
  if (!list) return;

  list.innerHTML = '';

  if (shown.length === 0) {
    empty && empty.classList.remove('hidden');
  } else {
    empty && empty.classList.add('hidden');
    shown.forEach((task, i) => {
      const row = buildTaskRow(task, i);
      list.appendChild(row);
    });
  }
}

function buildTaskRow(task, idx) {
  const isSelected = task.id === selectedTaskId;
  const chipClass  = { kuliah:'chip-kuliah', kerja:'chip-kerja', pribadi:'chip-pribadi' }[task.category] || 'chip-pribadi';
  const chipLabel  = { kuliah:'Kuliah', kerja:'Kerja', pribadi:'Pribadi' }[task.category] || task.category;
  const emoji      = { kuliah:'🎓', kerja:'💼', pribadi:'🌱' }[task.category] || '';

  const row = document.createElement('div');
  row.className = `task-row px-2 rounded-lg ${isSelected ? 'selected bg-white' : ''}`;
  row.style.animationDelay = `${idx * 0.04}s`;
  row.dataset.id = task.id;

  row.innerHTML = `
    <div class="task-dot mt-1 flex-shrink-0 ${isSelected ? 'bg-forest' : ''}"></div>
    <div class="flex-1 min-w-0 py-0.5">
      <p class="task-title truncate">${escHtml(task.title)}</p>
      <div class="flex items-center gap-1.5 mt-1 flex-wrap">
        <span class="chip ${chipClass}">${emoji} ${chipLabel}</span>
        ${task.startedCount > 0 ? `<span class="font-mono text-[10px] text-ink4">▶ ${task.startedCount}×</span>` : ''}
      </div>
    </div>
    <div class="flex items-center gap-1 flex-shrink-0 self-center">
      <!-- Done check -->
      <button class="action-icon w-6 h-6 flex items-center justify-center rounded hover:bg-forest-pale text-ink4 hover:text-forest transition-colors done-btn" title="Tandai selesai" data-id="${task.id}">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7l3.5 3.5L11 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <!-- Delete -->
      <button class="action-icon w-6 h-6 flex items-center justify-center rounded hover:bg-rose-pale text-ink4 hover:text-rose transition-colors del-btn" title="Hapus" data-id="${task.id}">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;

  // Select on click (not on button)
  row.addEventListener('click', e => {
    if (e.target.closest('.done-btn') || e.target.closest('.del-btn')) return;
    selectTask(task.id);
  });
  row.querySelector('.done-btn').addEventListener('click', e => { e.stopPropagation(); markDone(task.id); });
  row.querySelector('.del-btn').addEventListener('click',  e => { e.stopPropagation(); deleteTask(task.id); });

  return row;
}

/* ── Focus zone ── */
function renderFocus() {
  const task     = DB.tasks().find(t => t.id === selectedTaskId);
  const nameEl   = document.getElementById('focus-task-name');
  const metaEl   = document.getElementById('focus-task-meta');
  const chipEl   = document.getElementById('focus-task-chip');
  const startBtn = document.getElementById('start-btn');

  if (!task) {
    if (nameEl) {
      nameEl.className = 'focus-placeholder';
      nameEl.textContent = 'Pilih tugas di kiri untuk mulai';
    }
    metaEl && metaEl.classList.add('hidden');
    if (startBtn) startBtn.disabled = true;
  } else {
    if (nameEl) {
      nameEl.className = 'font-serif text-xl text-ink leading-snug text-center max-w-sm';
      nameEl.textContent = task.title;
    }
    if (chipEl) {
      const chipClass = { kuliah:'chip-kuliah', kerja:'chip-kerja', pribadi:'chip-pribadi' }[task.category];
      const emoji     = { kuliah:'🎓', kerja:'💼', pribadi:'🌱' }[task.category] || '';
      const label     = { kuliah:'Kuliah', kerja:'Kerja', pribadi:'Pribadi' }[task.category] || task.category;
      chipEl.className  = `chip ${chipClass}`;
      chipEl.textContent = `${emoji} ${label}`;
    }
    metaEl && metaEl.classList.remove('hidden');
    if (startBtn) startBtn.disabled = false;
  }

  // Start/stop button state
  if (startBtn) {
    const isRunning = timerRunning;
    startBtn.onclick = isRunning ? () => stopTimer(false) : startTimer;
  }

  // Session chips
  renderSessionChips();
}

function renderSessionChips() {
  const lg   = DB.todayLog();
  const wrap = document.getElementById('session-chips');
  if (!wrap) return;

  if (!lg || lg.sessions.length === 0) {
    wrap.innerHTML = '<span class="font-mono text-xs text-ink4">Belum ada sesi dimulai</span>';
    return;
  }

  wrap.innerHTML = lg.sessions.map(s => `
    <span class="inline-flex items-center gap-1 bg-forest-mist border border-forest-pale text-forest font-mono text-[10px] rounded-full px-2.5 py-1" title="${escHtml(s.taskTitle)}">
      ▶ ${escHtml(s.taskTitle.length > 18 ? s.taskTitle.slice(0,18)+'…' : s.taskTitle)}
    </span>
  `).join('');
}

/* ── Progress column ── */
function renderProgress() {
  const u  = DB.user();
  const lg = DB.todayLog();

  // Streak
  const sd = document.getElementById('streak-display');
  if (sd) sd.textContent = u ? u.streak : 0;

  // Shields
  const sc = document.getElementById('shield-count');
  const shields = u ? u.streakShields : 2;
  if (sc) sc.textContent = shields;
  [1,2,3].forEach(n => {
    const el = document.getElementById(`shield-${n}`);
    if (el) el.classList.toggle('used', n > shields);
  });

  // Today summary
  const ts = document.getElementById('today-starts');
  const td = document.getElementById('today-done');
  if (ts) ts.textContent = lg ? lg.totalStarts : 0;
  if (td) td.textContent = lg ? lg.totalDone   : 0;

  // Progress ring
  const allTasks = DB.tasks();
  const total    = allTasks.length;
  const done     = allTasks.filter(t => t.status === 'done').length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  const ring     = document.getElementById('progress-ring');
  const pctTxt   = document.getElementById('progress-pct');
  const circum   = 94.25;
  if (ring)   ring.style.strokeDashoffset = circum - (circum * pct / 100);
  if (pctTxt) pctTxt.textContent = `${pct}%`;

  // Contribution calendar
  renderCalendar();
}

/* ── GitHub-style contribution calendar ── */
function renderCalendar() {
  const grid   = document.getElementById('contrib-grid');
  const months = document.getElementById('contrib-months');
  if (!grid) return;

  const logs    = DB.logs();
  const today   = toDateStr();
  const WEEKS   = 10;
  const DAYS    = WEEKS * 7;

  // Find the Sunday before DAYS ago
  const endDate   = new Date();
  // align to end of current week (Saturday)
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - DAYS + 1);

  // Build week columns
  // Group days by week (col = week index, row = day-of-week 0=Sun)
  const cols = [];
  let weekDays = [];
  const ptr = new Date(startDate);

  // Pad first week if doesn't start on Sunday
  const firstDow = ptr.getDay(); // 0=Sun
  for (let i = 0; i < firstDow; i++) weekDays.push(null);

  while (ptr <= endDate) {
    weekDays.push(toDateStr(new Date(ptr)));
    if (weekDays.length === 7) { cols.push(weekDays); weekDays = []; }
    ptr.setDate(ptr.getDate() + 1);
  }
  if (weekDays.length) {
    while (weekDays.length < 7) weekDays.push(null);
    cols.push(weekDays);
  }

  // Build month label map (week index → month abbr)
  const monthLabels = {};
  cols.forEach((week, wi) => {
    week.forEach(d => {
      if (!d) return;
      const dt = new Date(d + 'T00:00:00');
      if (dt.getDate() <= 7) {
        const abbr = dt.toLocaleDateString('id-ID', { month: 'short' });
        if (!monthLabels[wi]) monthLabels[wi] = abbr;
      }
    });
  });

  // Row labels (Mon, Wed, Fri on rows 1,3,5)
  const rowLabels = ['M','','R','','J','','M']; // Sen,Sel,Rab,Kam,Jum,Sab,Min in index order (Sun=0→last visual)
  const displayOrder = [1,2,3,4,5,6,0]; // Mon first visually

  // Render
  grid.innerHTML = '';

  // Day-of-week label column
  const labelCol = document.createElement('div');
  labelCol.className = 'flex flex-col gap-1 mr-0.5';
  displayOrder.forEach(dow => {
    const lb = document.createElement('div');
    lb.className = 'font-mono text-[9px] text-ink4 h-[11px] flex items-center justify-end pr-1';
    lb.style.width = '14px';
    lb.textContent = ['M','','R','','J','','M'][displayOrder.indexOf(dow)] || '';
    labelCol.appendChild(lb);
  });
  grid.appendChild(labelCol);

  // Week columns
  cols.forEach(week => {
    const col = document.createElement('div');
    col.className = 'flex flex-col gap-1';

    displayOrder.forEach(dow => {
      const dateStr = week[dow];
      const cell = document.createElement('div');
      cell.className = 'contrib-cell';

      if (!dateStr) {
        cell.style.opacity = '0';
      } else {
        const lg = logs[dateStr];
        const starts = lg ? lg.totalStarts : 0;
        const isToday = dateStr === today;

        if (isToday && starts === 0) {
          cell.classList.add('today-empty');
        } else if (starts >= 3) {
          cell.classList.add('active');
        } else if (starts === 2) {
          cell.classList.add('active-lt');
        } else if (starts === 1) {
          cell.classList.add('active-pl');
        }

        // Tooltip
        const label = isToday ? 'Hari ini' : new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        cell.title = `${label}: ${starts} start${starts !== 1 ? 's' : ''}`;
      }

      col.appendChild(cell);
    });

    grid.appendChild(col);
  });

  // Month labels
  if (months) {
    months.innerHTML = '';
    // spacer for label col
    const sp = document.createElement('div');
    sp.style.width = '18px';
    months.appendChild(sp);

    cols.forEach((_, wi) => {
      const lbl = document.createElement('div');
      lbl.className = 'font-mono text-[9px] text-ink4 flex-1 text-center truncate';
      lbl.style.minWidth = '11px';
      lbl.textContent = monthLabels[wi] || '';
      months.appendChild(lbl);
    });
  }
}

/* ── Warehouse modal ── */
let warehouseFilter = 'all';

function renderWarehouse() {
  const all   = DB.tasks();
  const shown = warehouseFilter === 'all'    ? all
              : warehouseFilter === 'pending' ? all.filter(t => t.status === 'pending')
              : all.filter(t => t.status === 'done');

  const list = document.getElementById('warehouse-list');
  if (!list) return;
  list.innerHTML = '';

  if (shown.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="6" y="4" width="20" height="24" rx="3" stroke="var(--ink5)" stroke-width="1.5"/><path d="M11 12h10M11 17h6" stroke="var(--ink5)" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="font-sans text-sm text-ink4">Tidak ada tugas</span>
      </div>`;
    return;
  }

  shown.forEach(task => {
    const chipClass = { kuliah:'chip-kuliah', kerja:'chip-kerja', pribadi:'chip-pribadi' }[task.category];
    const emoji     = { kuliah:'🎓', kerja:'💼', pribadi:'🌱' }[task.category] || '';
    const label     = { kuliah:'Kuliah', kerja:'Kerja', pribadi:'Pribadi' }[task.category] || task.category;
    const isDone    = task.status === 'done';
    const doneDate  = isDone && task.doneAt ? new Date(task.doneAt).toLocaleDateString('id-ID',{day:'numeric',month:'short'}) : '';

    const row = document.createElement('div');
    row.className = `flex items-center gap-3 py-3 border-b border-ink6 last:border-0 group`;
    row.innerHTML = `
      <div class="flex-1 min-w-0">
        <p class="text-sm ${isDone ? 'text-ink4 line-through' : 'text-ink2'} truncate">${escHtml(task.title)}</p>
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          <span class="chip ${chipClass}">${emoji} ${label}</span>
          ${task.startedCount > 0 ? `<span class="font-mono text-[10px] text-ink4">▶ ${task.startedCount}×</span>` : ''}
          ${isDone ? `<span class="font-mono text-[10px] text-ink4">✓ ${doneDate}</span>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        ${!isDone ? `
          <button class="w-7 h-7 flex items-center justify-center rounded hover:bg-forest-mist text-ink4 hover:text-forest transition-colors wdone-btn" data-id="${task.id}" title="Selesai">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7l3.5 3.5L11 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        ` : ''}
        <button class="w-7 h-7 flex items-center justify-center rounded hover:bg-rose-pale text-ink4 hover:text-rose transition-colors wdel-btn" data-id="${task.id}" title="Hapus">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.wdone-btn').forEach(b => b.addEventListener('click', () => { markDone(b.dataset.id); renderWarehouse(); }));
  list.querySelectorAll('.wdel-btn').forEach(b  => b.addEventListener('click', () => { deleteTask(b.dataset.id); renderWarehouse(); }));
}

// ─────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────

function setupEvents() {

  /* Add task */
  document.getElementById('add-btn').addEventListener('click', () => {
    const inp = document.getElementById('task-input');
    const cat = document.getElementById('category-select');
    addTask(inp.value, cat.value);
    inp.value = '';
  });
  document.getElementById('task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-btn').click();
  });

  /* Clear done */
  document.getElementById('clear-done-btn').addEventListener('click', () => {
    DB.saveTasks(DB.tasks().filter(t => t.status !== 'done'));
    renderAll();
    toast('🗑 Tugas selesai dihapus');
  });

  /* Open warehouse */
  document.getElementById('open-warehouse-btn').addEventListener('click', () => {
    document.getElementById('warehouse-modal').classList.remove('hidden');
    warehouseFilter = 'all';
    highlightWarehouseTab('all');
    renderWarehouse();
  });

  /* Close warehouse */
  document.getElementById('close-warehouse-btn').addEventListener('click', closeWarehouse);
  document.getElementById('warehouse-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeWarehouse();
  });

  /* Warehouse filter tabs */
  document.querySelectorAll('.wfilter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      warehouseFilter = btn.dataset.wfilter;
      highlightWarehouseTab(warehouseFilter);
      renderWarehouse();
    });
  });

  /* Clear all done from warehouse */
  document.getElementById('clear-all-done-btn').addEventListener('click', () => {
    DB.saveTasks(DB.tasks().filter(t => t.status !== 'done'));
    renderAll();
    renderWarehouse();
    toast('🗑 Semua tugas selesai dihapus');
  });

  /* Streak badge → tooltip/modal (simple toast for now) */
  document.getElementById('nav-streak-btn').addEventListener('click', () => {
    const u = DB.user();
    toast(`🔥 Streak ${u.streak} hari · 🛡️ ${u.streakShields} shield tersisa`);
  });

  /* Keyboard: Escape closes warehouse */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeWarehouse();
  });
}

function closeWarehouse() {
  document.getElementById('warehouse-modal').classList.add('hidden');
}

function highlightWarehouseTab(filter) {
  document.querySelectorAll('.wfilter-tab').forEach(btn => {
    const active = btn.dataset.wfilter === filter;
    btn.classList.toggle('border-forest', active);
    btn.classList.toggle('text-forest',   active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-ink4', !active);
  });
}

// ─────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupEvents();
  renderAll();

  // Seed demo tasks if first run (user just created → no tasks yet)
  if (DB.tasks().length === 0) {
    const demos = [
      { title: 'Review catatan kuliah semester ini', category: 'kuliah' },
      { title: 'Kirim email follow-up ke klien', category: 'kerja' },
      { title: 'Baca buku 10 halaman', category: 'pribadi' },
    ];
    demos.forEach(d => DB.addTask(makeTask(d.title, d.category)));
    renderAll();
  }

  console.info(
    '%cMulai Dulu%c — LocalStorage keys: md_user · md_tasks · md_logs',
    'color:#2D6A4F;font-weight:bold', 'color:#999'
  );
});
