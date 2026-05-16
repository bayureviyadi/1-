/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           MULAI DULU — Anti-Procrastination App          ║
 * ║                      app.js v1.0                         ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  Data disimpan di LocalStorage dengan struktur yang      ║
 * ║  siap dimigrasikan ke Firebase/Supabase.                 ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ──────────────────────────────────────────────────────────────
// 1. SCHEMA & DEFAULT DATA
//    Dokumentasi struktur data agar mudah dimigrasikan ke DB.
// ──────────────────────────────────────────────────────────────

/**
 * SCHEMA: users
 * Koleksi tunggal (single-document) karena ini aplikasi lokal.
 * Di Firebase: /users/{userId}
 * Di Supabase: tabel `users` dengan kolom di bawah.
 *
 * {
 *   id:             string,   // UUID v4 — foreign key ke semua entitas
 *   displayName:    string,   // Nama pengguna (opsional)
 *   createdAt:      string,   // ISO 8601 datetime
 *   streak:         number,   // Jumlah hari berturut-turut aktif
 *   lastActiveDate: string,   // "YYYY-MM-DD" — tanggal terakhir minimal 1 start
 *   streakShields:  number,   // Jumlah shield tersisa (default 2, max 3)
 *   totalStarts:    number,   // Total kumulatif semua kali "Mulai 5 Menit" ditekan
 *   totalCompleted: number,   // Total kumulatif tugas diselesaikan
 * }
 */

/**
 * SCHEMA: tasks
 * Di Firebase: /users/{userId}/tasks/{taskId}
 * Di Supabase: tabel `tasks` dengan kolom `user_id` sebagai FK.
 *
 * {
 *   id:           string,    // UUID v4
 *   userId:       string,    // FK → users.id
 *   title:        string,    // Judul tugas (max 200 karakter)
 *   description:  string,    // Deskripsi opsional
 *   status:       "pending" | "in_progress" | "completed",
 *   startedCount: number,    // Berapa kali tombol "Mulai 5 Menit" ditekan untuk tugas ini
 *   createdAt:    string,    // ISO 8601
 *   updatedAt:    string,    // ISO 8601
 *   completedAt:  string | null,  // ISO 8601, null jika belum selesai
 *   order:        number,    // Urutan tampil (untuk drag-reorder nanti)
 * }
 */

/**
 * SCHEMA: daily_logs
 * Di Firebase: /users/{userId}/daily_logs/{dateString}
 * Di Supabase: tabel `daily_logs` dengan PK komposit (user_id, date).
 *
 * {
 *   id:              string,  // UUID v4 (atau "{userId}_{date}")
 *   userId:          string,  // FK → users.id
 *   date:            string,  // "YYYY-MM-DD" — 1 dokumen per hari
 *   totalStarts:     number,  // Jumlah "Mulai 5 Menit" pada hari ini
 *   completedTasks:  number,  // Jumlah tugas diselesaikan pada hari ini
 *   shieldUsed:      boolean, // Apakah streak shield dipakai pada hari ini
 *   reflection: {
 *     mood:          number | null,  // 1–5 (emoji mood scale)
 *     wentWell:      string,         // Refleksi positif
 *     obstacle:      string,         // Hambatan / kesulitan
 *     tomorrow:      string,         // Niat untuk hari berikutnya
 *     savedAt:       string | null,  // ISO 8601, null jika belum disimpan
 *   },
 *   sessions: [                 // Array sesi "Mulai 5 Menit" pada hari ini
 *     {
 *       taskId:    string,      // FK → tasks.id
 *       taskTitle: string,      // Snapshot judul (denormalized, aman untuk history)
 *       startedAt: string,      // ISO 8601
 *       durationSeconds: number // Berapa detik timer berjalan sebelum berhenti
 *     }
 *   ]
 * }
 */

// ──────────────────────────────────────────────────────────────
// 2. CONSTANTS & HELPERS
// ──────────────────────────────────────────────────────────────

const LS_KEYS = {
  USER:       'mulaidulu_user',
  TASKS:      'mulaidulu_tasks',
  DAILY_LOGS: 'mulaidulu_daily_logs',
};

const TIMER_DURATION = 5 * 60; // 5 menit dalam detik
const MAX_SHIELDS    = 3;

/** Generate UUID v4 sederhana (cukup untuk LocalStorage) */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Format Date ke "YYYY-MM-DD" */
function toDateStr(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/** Format tanggal ke lokal Indonesia */
function formatDateID(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Hitung selisih hari antara dua date string */
function daysDiff(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + 'T00:00:00');
  const d2 = new Date(dateStr2 + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000);
}

/** Tampilkan toast notifikasi */
let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/** Konfirmasi modal promise */
function confirmDialog(text) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-text').textContent = text;
    modal.classList.remove('hidden');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const cleanup = (val) => {
      modal.classList.add('hidden');
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
      resolve(val);
    };
    document.getElementById('confirm-yes').onclick = () => cleanup(true);
    document.getElementById('confirm-no').onclick  = () => cleanup(false);
  });
}

// ──────────────────────────────────────────────────────────────
// 3. DATA ACCESS LAYER (LocalStorage CRUD)
//    Interface ini bisa diswap ke Firebase/Supabase nantinya.
// ──────────────────────────────────────────────────────────────

const DB = {
  /* ── USER ── */
  getUser() {
    const raw = localStorage.getItem(LS_KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  },
  saveUser(user) {
    localStorage.setItem(LS_KEYS.USER, JSON.stringify(user));
  },

  /* ── TASKS ── */
  getTasks() {
    const raw = localStorage.getItem(LS_KEYS.TASKS);
    return raw ? JSON.parse(raw) : [];
  },
  saveTasks(tasks) {
    localStorage.setItem(LS_KEYS.TASKS, JSON.stringify(tasks));
  },
  addTask(task) {
    const tasks = this.getTasks();
    tasks.unshift(task); // prepend — tugas baru di atas
    this.saveTasks(tasks);
  },
  updateTask(id, patch) {
    const tasks = this.getTasks().map(t =>
      t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
    );
    this.saveTasks(tasks);
  },
  deleteTask(id) {
    this.saveTasks(this.getTasks().filter(t => t.id !== id));
  },

  /* ── DAILY LOGS ── */
  getLogs() {
    const raw = localStorage.getItem(LS_KEYS.DAILY_LOGS);
    return raw ? JSON.parse(raw) : {};
  },
  getLog(dateStr) {
    return this.getLogs()[dateStr] || null;
  },
  saveLog(dateStr, log) {
    const logs = this.getLogs();
    logs[dateStr] = log;
    localStorage.setItem(LS_KEYS.DAILY_LOGS, JSON.stringify(logs));
  },
  getTodayLog() {
    return this.getLog(toDateStr());
  },
};

// ──────────────────────────────────────────────────────────────
// 4. INITIALIZATION
// ──────────────────────────────────────────────────────────────

function initData() {
  /* Buat user default jika belum ada */
  if (!DB.getUser()) {
    const user = {
      id:             uuid(),
      displayName:    'Pengguna',
      createdAt:      new Date().toISOString(),
      streak:         0,
      lastActiveDate: null,
      streakShields:  2,
      totalStarts:    0,
      totalCompleted: 0,
    };
    DB.saveUser(user);
    // Tampilkan welcome banner untuk pengguna baru
    document.getElementById('welcome-banner').classList.remove('hidden');
  }

  /* Pastikan log hari ini ada */
  ensureTodayLog();

  /* Periksa & update streak berdasarkan tanggal */
  checkAndUpdateStreak();
}

function ensureTodayLog() {
  const today = toDateStr();
  if (!DB.getLog(today)) {
    const user = DB.getUser();
    const log = {
      id:             `${user.id}_${today}`,
      userId:         user.id,
      date:           today,
      totalStarts:    0,
      completedTasks: 0,
      shieldUsed:     false,
      reflection: {
        mood:      null,
        wentWell:  '',
        obstacle:  '',
        tomorrow:  '',
        savedAt:   null,
      },
      sessions: [],
    };
    DB.saveLog(today, log);
  }
}

/**
 * Logika streak:
 * - Jika lastActiveDate === kemarin → streak lanjut (tidak berubah sampai ada start baru)
 * - Jika lastActiveDate === 2+ hari lalu → periksa shield
 * - Jika ada shield tersisa → pakai shield, streak tetap, shieldUsed = true di log kemarin
 * - Jika tidak ada shield → streak reset ke 0
 */
function checkAndUpdateStreak() {
  const user  = DB.getUser();
  const today = toDateStr();
  if (!user.lastActiveDate) return; // belum pernah aktif

  const diff = daysDiff(user.lastActiveDate, today);
  if (diff <= 1) return; // hari ini atau kemarin — normal

  // Melewatkan ≥ 1 hari
  if (diff === 2 && user.streakShields > 0) {
    // Satu hari dilewati → pakai shield
    const missedDate = toDateStr(new Date(Date.now() - 86400000));
    const missedLog  = DB.getLog(missedDate) || {
      id: `${user.id}_${missedDate}`, userId: user.id, date: missedDate,
      totalStarts: 0, completedTasks: 0, shieldUsed: true,
      reflection: { mood: null, wentWell: '', obstacle: '', tomorrow: '', savedAt: null },
      sessions: [],
    };
    missedLog.shieldUsed = true;
    DB.saveLog(missedDate, missedLog);

    user.streakShields--;
    DB.saveUser(user);
    showToast('🛡️ Shield digunakan untuk melindungi streak-mu!', 3500);
  } else if (diff > 2 || (diff === 2 && user.streakShields === 0)) {
    // Streak putus
    user.streak = 0;
    DB.saveUser(user);
  }
}

// ──────────────────────────────────────────────────────────────
// 5. TASK LOGIC
// ──────────────────────────────────────────────────────────────

function createTask(title) {
  if (!title.trim()) return null;
  const user = DB.getUser();
  return {
    id:           uuid(),
    userId:       user.id,
    title:        title.trim(),
    description:  '',
    status:       'pending',
    startedCount: 0,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    completedAt:  null,
    order:        Date.now(),
  };
}

function recordStart(taskId) {
  const today = toDateStr();
  const task  = DB.getTasks().find(t => t.id === taskId);
  if (!task) return;

  // Tambah startedCount ke task
  DB.updateTask(taskId, {
    startedCount: task.startedCount + 1,
    status: task.status === 'pending' ? 'in_progress' : task.status,
  });

  // Catat sesi di daily log
  const log = DB.getTodayLog();
  log.totalStarts++;
  log.sessions.push({
    taskId:          taskId,
    taskTitle:       task.title,
    startedAt:       new Date().toISOString(),
    durationSeconds: 0, // akan diperbarui saat timer berhenti
  });
  DB.saveLog(today, log);

  // Update user stats + streak
  const user = DB.getUser();
  user.totalStarts++;
  const todayStr = toDateStr();
  if (user.lastActiveDate !== todayStr) {
    // Hari baru yang aktif → tambah streak
    const diff = user.lastActiveDate ? daysDiff(user.lastActiveDate, todayStr) : 0;
    if (diff <= 1) {
      user.streak++;
    }
    // (Jika diff > 1, streak sudah di-handle checkAndUpdateStreak())
    user.lastActiveDate = todayStr;
  }
  DB.saveUser(user);
}

function completeTask(taskId) {
  const today = toDateStr();
  DB.updateTask(taskId, {
    status:      'completed',
    completedAt: new Date().toISOString(),
  });

  const log = DB.getTodayLog();
  log.completedTasks++;
  DB.saveLog(today, log);

  const user = DB.getUser();
  user.totalCompleted++;
  DB.saveUser(user);
}

// ──────────────────────────────────────────────────────────────
// 6. RENDER FUNCTIONS
// ──────────────────────────────────────────────────────────────

let currentFilter = 'all';

function renderAll() {
  renderHeader();
  renderTaskList();
  renderFocusView();
  renderLogView();
  renderStatsView();
}

function renderHeader() {
  const user = DB.getUser();
  document.getElementById('streak-count').textContent  = user.streak;
  document.getElementById('shield-count').textContent  = user.streakShields;
  document.getElementById('modal-streak').textContent  = user.streak;
  document.getElementById('modal-shields').textContent = user.streakShields;
  document.getElementById('stats-streak').textContent  = user.streak;
  document.getElementById('stats-shields').textContent = user.streakShields;

  const lastActive = user.lastActiveDate
    ? formatDateID(user.lastActiveDate)
    : 'Belum pernah';
  document.getElementById('stats-last-active').textContent = lastActive;
}

function renderTaskList() {
  const allTasks = DB.getTasks();
  const filtered = currentFilter === 'all'
    ? allTasks
    : allTasks.filter(t => t.status === currentFilter);

  const container = document.getElementById('task-list');
  const emptyEl   = document.getElementById('empty-tasks');
  container.innerHTML = '';

  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
  }

  // Progress bar
  const todayLog = DB.getTodayLog();
  const total    = allTasks.length;
  const pct      = total > 0 ? Math.round((todayLog.totalStarts / Math.max(total, 1)) * 100) : 0;
  document.getElementById('daily-progress-bar').style.width  = Math.min(pct, 100) + '%';
  document.getElementById('daily-progress-text').textContent =
    `${todayLog.totalStarts} mulai · ${todayLog.completedTasks} selesai`;

  filtered.forEach(task => {
    const card = buildTaskCard(task);
    container.appendChild(card);
  });
}

function buildTaskCard(task) {
  const statusMeta = {
    pending:     { label: 'Tertunda',       color: 'bg-amber-100 text-amber-700' },
    in_progress: { label: 'Sedang Jalan',   color: 'bg-blue-100 text-blue-700' },
    completed:   { label: 'Selesai',        color: 'bg-green-100 text-green-700' },
  };
  const meta = statusMeta[task.status];

  const div = document.createElement('div');
  div.className = `task-card p-4 rounded-2xl bg-white/80 border border-amber-100 shadow-sm
    ${task.status === 'completed' ? 'opacity-60' : ''}`;
  div.dataset.taskId = task.id;

  div.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-slate-800 leading-snug ${task.status === 'completed' ? 'line-through' : ''}">${escapeHtml(task.title)}</p>
        <div class="flex items-center gap-2 mt-1.5 flex-wrap">
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}">${meta.label}</span>
          ${task.startedCount > 0
            ? `<span class="text-xs text-slate-400">🚀 ${task.startedCount}× dimulai</span>`
            : ''}
        </div>
      </div>
      <button class="delete-task-btn text-slate-300 hover:text-red-400 text-lg transition-colors flex-shrink-0 mt-0.5"
        data-id="${task.id}" title="Hapus tugas">×</button>
    </div>

    ${task.status !== 'completed' ? `
    <div class="flex gap-2 mt-3">
      <button class="start-5min-btn flex-1 py-2 rounded-xl bg-terra-600 text-white text-xs font-semibold
        hover:bg-terra-800 active:scale-[0.97] transition-all" data-id="${task.id}" data-title="${escapeHtml(task.title)}">
        🚀 Mulai 5 Menit
      </button>
      <button class="complete-task-btn py-2 px-3 rounded-xl bg-green-50 text-green-700 text-xs font-medium
        hover:bg-green-100 active:scale-[0.97] transition-all" data-id="${task.id}">
        ✓ Selesai
      </button>
    </div>
    ` : `
    <p class="text-xs text-green-600 mt-2">✓ Diselesaikan ${task.completedAt ? formatDateID(task.completedAt.split('T')[0]) : ''}</p>
    `}
  `;

  return div;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderFocusView() {
  // Populate task selector
  const select = document.getElementById('focus-task-select');
  const prevVal = select.value;
  select.innerHTML = '<option value="">— Pilih tugas —</option>';
  DB.getTasks()
    .filter(t => t.status !== 'completed')
    .forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      if (t.id === prevVal) opt.selected = true;
      select.appendChild(opt);
    });

  // Session history chips
  const log = DB.getTodayLog();
  const hist = document.getElementById('session-history');
  if (log.sessions.length === 0) {
    hist.innerHTML = '<span class="text-xs text-slate-400 italic">Belum ada sesi</span>';
  } else {
    hist.innerHTML = log.sessions.map(s => `
      <span class="text-xs px-2.5 py-1 rounded-full bg-terra-100 text-terra-700 font-medium">
        🚀 ${escapeHtml(s.taskTitle)}
      </span>
    `).join('');
  }
}

function renderLogView() {
  const today = toDateStr();
  document.getElementById('log-date').textContent = formatDateID(today);

  const log = DB.getTodayLog();
  document.getElementById('log-total-starts').textContent = log.totalStarts;
  document.getElementById('log-completed').textContent    = log.completedTasks;
  document.getElementById('log-shield-used').textContent  = log.shieldUsed ? '🛡️ Ya' : '—';

  // Restore reflection fields
  document.getElementById('reflection-good').value     = log.reflection.wentWell  || '';
  document.getElementById('reflection-obstacle').value = log.reflection.obstacle   || '';
  document.getElementById('reflection-tomorrow').value = log.reflection.tomorrow   || '';

  // Mood selector highlight
  document.querySelectorAll('.mood-btn').forEach(btn => {
    const active = parseInt(btn.dataset.mood) === log.reflection.mood;
    btn.classList.toggle('ring-2',       active);
    btn.classList.toggle('ring-terra-400', active);
    btn.classList.toggle('bg-terra-100',   active);
    btn.classList.toggle('scale-110',      active);
  });
}

function renderStatsView() {
  const user = DB.getUser();
  document.getElementById('stats-total-starts').textContent    = user.totalStarts;
  document.getElementById('stats-total-completed').textContent = user.totalCompleted;

  renderWeeklyChart();
  renderRecentLogs();
}

function renderWeeklyChart() {
  const chart  = document.getElementById('weekly-chart');
  const labels = document.getElementById('weekly-labels');
  const days   = 7;
  const data   = [];

  for (let i = days - 1; i >= 0; i--) {
    const d   = new Date(Date.now() - i * 86400000);
    const str = toDateStr(d);
    const log = DB.getLog(str);
    data.push({ dateStr: str, starts: log ? log.totalStarts : 0 });
  }

  const maxVal = Math.max(...data.map(d => d.starts), 1);
  chart.innerHTML  = '';
  labels.innerHTML = '';

  data.forEach(d => {
    const pct     = Math.round((d.starts / maxVal) * 100);
    const isToday = d.dateStr === toDateStr();
    const bar = document.createElement('div');
    bar.className = 'flex-1 flex flex-col items-center justify-end gap-1';
    bar.innerHTML = `
      <span class="text-xs font-semibold ${d.starts > 0 ? 'text-terra-600' : 'text-slate-300'}">${d.starts || ''}</span>
      <div class="w-full rounded-t-lg ${isToday ? 'bg-terra-600' : 'bg-terra-200'} transition-all"
        style="height: ${Math.max(pct, 4)}%"></div>
    `;
    chart.appendChild(bar);

    const lbl = document.createElement('div');
    lbl.className = `flex-1 text-center text-xs ${isToday ? 'font-semibold text-terra-600' : 'text-slate-400'}`;
    lbl.textContent = new Date(d.dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'narrow' });
    labels.appendChild(lbl);
  });
}

function renderRecentLogs() {
  const logs = DB.getLogs();
  const list = document.getElementById('recent-logs-list');
  const sorted = Object.values(logs)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  if (sorted.length === 0) {
    list.innerHTML = '<span class="text-xs text-slate-400 italic">Belum ada log</span>';
    return;
  }

  list.innerHTML = sorted.map(log => `
    <div class="flex items-center justify-between py-2 border-b border-amber-50 last:border-0">
      <div class="flex items-center gap-2">
        ${log.shieldUsed ? '<span title="Shield digunakan">🛡️</span>' : '<span class="w-4"></span>'}
        <span class="text-sm text-slate-700">${formatDateID(log.date)}</span>
        ${log.date === toDateStr() ? '<span class="text-xs bg-terra-100 text-terra-700 rounded-full px-2">hari ini</span>' : ''}
      </div>
      <div class="flex gap-3 text-xs text-slate-500">
        <span>🚀 ${log.totalStarts}</span>
        <span>✓ ${log.completedTasks}</span>
        ${log.reflection.mood ? `<span>${['','😩','😕','😐','🙂','😄'][log.reflection.mood]}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────────────────────
// 7. TIMER LOGIC
// ──────────────────────────────────────────────────────────────

let timerInterval   = null;
let timerSecondsLeft = TIMER_DURATION;
let timerTaskId     = null;
let timerSessionIdx = null; // index sesi dalam log hari ini

const MOTIVATIONS = [
  'Kamu tidak perlu selesai. Cukup mulai.',
  'Lima menit sekarang lebih baik dari satu jam nanti.',
  'Mulai adalah satu-satunya cara melawan rasa malas.',
  'Gerakan kecil mengalahkan rencana besar.',
  'Otak butuh bukti, bukan janji. Buktikan dengan mulai.',
  'Progres, bukan kesempurnaan.',
];

function startTimer() {
  const select = document.getElementById('focus-task-select');
  const taskId = select.value;

  if (!taskId) {
    showToast('⚠️ Pilih tugas terlebih dahulu!');
    return;
  }

  timerTaskId = taskId;
  timerSecondsLeft = TIMER_DURATION;

  // Record start di data layer
  recordStart(taskId);
  timerSessionIdx = DB.getTodayLog().sessions.length - 1;

  // Update UI
  document.getElementById('start-timer-btn').classList.add('hidden');
  document.getElementById('stop-timer-btn').classList.remove('hidden');
  document.getElementById('pulse-rings').classList.remove('hidden');
  document.getElementById('focus-motivation').textContent =
    MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)];

  updateTimerDisplay();
  renderAll(); // Refresh task cards & header

  timerInterval = setInterval(() => {
    timerSecondsLeft--;
    updateTimerDisplay();

    // Update durasi sesi di log
    const log = DB.getTodayLog();
    if (log.sessions[timerSessionIdx]) {
      log.sessions[timerSessionIdx].durationSeconds = TIMER_DURATION - timerSecondsLeft;
      DB.saveLog(toDateStr(), log);
    }

    if (timerSecondsLeft <= 0) {
      stopTimer(true);
    }
  }, 1000);
}

function stopTimer(completed = false) {
  clearInterval(timerInterval);
  timerInterval = null;

  document.getElementById('start-timer-btn').classList.remove('hidden');
  document.getElementById('stop-timer-btn').classList.add('hidden');
  document.getElementById('pulse-rings').classList.add('hidden');

  // Reset ring
  timerSecondsLeft = TIMER_DURATION;
  updateTimerDisplay();

  if (completed) {
    showToast('🎉 5 menit selesai! Luar biasa — kamu sudah mulai!', 3500);
    document.getElementById('focus-motivation').textContent =
      'Kamu sudah membuktikan bahwa kamu bisa mulai. Terus lakukan!';
  } else {
    showToast('✋ Sesi dihentikan. Setiap detik tetap berarti!', 2500);
    document.getElementById('focus-motivation').textContent =
      'Tidak apa-apa berhenti. Yang penting kamu sudah memulai.';
  }

  renderAll();
}

function updateTimerDisplay() {
  const m   = Math.floor(timerSecondsLeft / 60);
  const s   = timerSecondsLeft % 60;
  document.getElementById('timer-display').textContent =
    `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  // Update ring
  const pct    = timerSecondsLeft / TIMER_DURATION;
  const offset = 283 * (1 - pct);
  document.getElementById('timer-ring').style.strokeDashoffset = offset;
}

// ──────────────────────────────────────────────────────────────
// 8. EVENT LISTENERS
// ──────────────────────────────────────────────────────────────

function setupEventListeners() {

  /* ── Navigation tabs ── */
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.view).classList.add('active');
      renderAll(); // refresh aktif view
    });
  });

  /* ── Add task ── */
  document.getElementById('add-task-btn').addEventListener('click', handleAddTask);
  document.getElementById('new-task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddTask();
  });

  function handleAddTask() {
    const input = document.getElementById('new-task-input');
    const task  = createTask(input.value);
    if (!task) { showToast('⚠️ Judul tugas tidak boleh kosong!'); return; }
    DB.addTask(task);
    input.value = '';
    renderAll();
    showToast('✅ Tugas ditambahkan!');
  }

  /* ── Filter pills ── */
  document.querySelectorAll('.task-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-filter').forEach(b => {
        b.classList.remove('bg-terra-600', 'text-white', 'active-filter');
        b.classList.add('bg-cream-100', 'text-slate-600');
      });
      btn.classList.add('bg-terra-600', 'text-white', 'active-filter');
      btn.classList.remove('bg-cream-100', 'text-slate-600');
      currentFilter = btn.dataset.filter;
      renderTaskList();
    });
  });

  /* ── Task list delegated events ── */
  document.getElementById('task-list').addEventListener('click', async e => {
    // Start 5 min (from task card)
    const startBtn = e.target.closest('.start-5min-btn');
    if (startBtn) {
      const taskId = startBtn.dataset.id;
      // Switch to focus view and pre-select task
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelector('[data-view="view-focus"]').classList.add('active');
      document.getElementById('view-focus').classList.add('active');
      const select = document.getElementById('focus-task-select');
      renderFocusView();
      select.value = taskId;
      startTimer();
      return;
    }

    // Complete task
    const completeBtn = e.target.closest('.complete-task-btn');
    if (completeBtn) {
      completeTask(completeBtn.dataset.id);
      renderAll();
      showToast('🌿 Tugas diselesaikan! Hebat!');
      return;
    }

    // Delete task
    const deleteBtn = e.target.closest('.delete-task-btn');
    if (deleteBtn) {
      const ok = await confirmDialog('Hapus tugas ini? Tindakan tidak dapat dibatalkan.');
      if (ok) {
        DB.deleteTask(deleteBtn.dataset.id);
        renderAll();
        showToast('🗑 Tugas dihapus.');
      }
    }
  });

  /* ── Timer controls ── */
  document.getElementById('start-timer-btn').addEventListener('click', startTimer);
  document.getElementById('stop-timer-btn').addEventListener('click', () => stopTimer(false));

  /* ── Mood selector ── */
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const today = toDateStr();
      const log   = DB.getTodayLog();
      log.reflection.mood = parseInt(btn.dataset.mood);
      DB.saveLog(today, log);
      renderLogView();
    });
  });

  /* ── Save reflection ── */
  document.getElementById('save-reflection-btn').addEventListener('click', () => {
    const today = toDateStr();
    const log   = DB.getTodayLog();
    log.reflection.wentWell  = document.getElementById('reflection-good').value.trim();
    log.reflection.obstacle  = document.getElementById('reflection-obstacle').value.trim();
    log.reflection.tomorrow  = document.getElementById('reflection-tomorrow').value.trim();
    log.reflection.savedAt   = new Date().toISOString();
    DB.saveLog(today, log);
    showToast('💾 Refleksi tersimpan!');
    renderStatsView();
  });

  /* ── Streak badge → modal ── */
  document.getElementById('streak-badge').addEventListener('click', () => {
    renderHeader();
    document.getElementById('streak-modal').classList.remove('hidden');
  });
  document.getElementById('shield-badge').addEventListener('click', () => {
    renderHeader();
    document.getElementById('streak-modal').classList.remove('hidden');
  });
  document.getElementById('close-streak-modal').addEventListener('click', () => {
    document.getElementById('streak-modal').classList.add('hidden');
  });

  /* ── Welcome banner close ── */
  document.getElementById('close-welcome').addEventListener('click', () => {
    document.getElementById('welcome-banner').classList.add('hidden');
  });

  /* ── Reset all data ── */
  document.getElementById('reset-all-btn').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset semua data? Streak, tugas, dan log akan dihapus permanen.');
    if (ok) {
      Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });

  /* ── Close modals on backdrop click ── */
  document.getElementById('streak-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
}

// ──────────────────────────────────────────────────────────────
// 9. BOOTSTRAP
// ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initData();
  setupEventListeners();
  renderAll();

  console.info(
    '%c🔥 Mulai Dulu App%c — Data di LocalStorage\n' +
    'Keys: mulaidulu_user, mulaidulu_tasks, mulaidulu_daily_logs\n' +
    'Schema siap migrasi ke Firebase/Supabase.',
    'color:#c05328;font-weight:bold;font-size:14px',
    'color:#666'
  );
});
