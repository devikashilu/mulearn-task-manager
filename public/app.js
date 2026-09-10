/* ══════════════════════════════════════════════════════════════════
   CLUB TASK MANAGER — app.js (Premium UI & Performance)
══════════════════════════════════════════════════════════════════ */

const state = {
  currentView: 'dashboard',
  assigneeFilter: 'all', // 'all' or specific assignee name
  weeks: { current: null, next: null },
  tasksCache: { current: [], next: [], archive: [] },
  knownLeads: [],
  config: { weekStartDay: 0, clubName: 'Club Tasks' },
  archiveWeek: null,
  editingTaskId: null,
  addingToWeek: 'current'
};

const el = id => document.getElementById(id);

// ── Performance / Caching / API ───────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(path, opts);
    if (res.status === 401) { showLogin(); return null; }
    return res.json();
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

const GET = path => api('GET', path);
const POST = (path, body) => api('POST', path, body);
const PUT = (path, body) => api('PUT', path, body);
const DEL = path => api('DELETE', path);

// ── Boot & Login ──────────────────────────────────────────────────────
async function boot() {
  const auth = await GET('/api/auth-check');
  if (auth && auth.authenticated) {
    await loadConfigAndShow();
  } else {
    showLogin();
  }
}

function showLogin() {
  el('initial-loader').classList.add('hidden');
  el('app').classList.add('hidden');
  el('login-screen').classList.remove('hidden');
}

async function loadConfigAndShow() {
  const cfg = await GET('/api/config');
  if (cfg) state.config = cfg;
  el('login-club-name').textContent = state.config.clubName || 'Club Tasks';
  
  el('login-screen').classList.add('hidden');
  el('app').classList.remove('hidden');
  
  await loadWeeks();
  await refreshTasks('current');
  await refreshTasks('next');
  renderView('dashboard');
  
  setTimeout(() => el('initial-loader').classList.add('hidden'), 300);
}

el('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = el('password-input').value;
  const btn = el('login-btn');
  btn.disabled = true; btn.querySelector('span').textContent = 'Checking...';
  
  const res = await POST('/api/login', { password: pw });
  if (res && res.success) {
    el('login-error').classList.add('hidden');
    el('password-input').value = '';
    el('initial-loader').classList.remove('hidden');
    await loadConfigAndShow();
  } else {
    el('login-error').classList.remove('hidden');
  }
  btn.disabled = false; btn.querySelector('span').textContent = 'Unlock';
});

el('toggle-pw').addEventListener('click', () => {
  const inp = el('password-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

el('logout-btn').addEventListener('click', async () => {
  await POST('/api/logout');
  showLogin();
});

// ── Data Loading ──────────────────────────────────────────────────────
async function loadWeeks() {
  const data = await GET('/api/tasks/weeks');
  if (data) {
    state.weeks.current = data.currentWeekKey;
    state.weeks.next = data.nextWeekKey;
  }
}

async function refreshTasks(weekType) {
  const weekKey = state.weeks[weekType];
  if (!weekKey) return;
  const data = await GET(`/api/tasks?week=${weekKey}`);
  if (data) {
    state.tasksCache[weekType] = data.tasks;
    state.knownLeads = data.knownLeads;
    updateFilterDropdown();
  }
}

// ── View Management ───────────────────────────────────────────────────
function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
  
  if (view === 'dashboard' || view === 'nextweek') {
    el('view-tasks').classList.remove('hidden');
    el('week-strip').classList.remove('hidden');
    el('header-progress').style.display = 'flex';
    el('filter-container').classList.remove('hidden');
  } else if (view === 'archive') {
    el('view-archive').classList.remove('hidden');
    el('week-strip').classList.add('hidden');
    el('header-progress').style.display = 'none';
    el('filter-container').classList.add('hidden');
  } else if (view === 'settings') {
    el('view-settings').classList.remove('hidden');
    el('week-strip').classList.add('hidden');
    el('header-progress').style.display = 'none';
    el('filter-container').classList.add('hidden');
  }
  
  const tab = document.querySelector(`.view-tab[data-view="${view}"]`);
  if (tab) tab.classList.add('active');
}

async function renderView(view) {
  setView(view);
  const titleEl = el('main-view-title');
  const subEl = el('main-view-subtitle');
  
  if (view === 'dashboard') {
    titleEl.textContent = 'This Week';
    const { start, end } = weekBounds(state.weeks.current);
    subEl.textContent = `${fmtShort(start)} – ${fmtShort(end)}`;
    renderWeekStrip(start, state.tasksCache.current);
    renderTasks('tasks-content', state.tasksCache.current, false);
    updateProgress(state.tasksCache.current);
  } else if (view === 'nextweek') {
    titleEl.textContent = 'Next Week';
    const { start, end } = weekBounds(state.weeks.next);
    subEl.textContent = `${fmtShort(start)} – ${fmtShort(end)}`;
    renderWeekStrip(start, state.tasksCache.next);
    renderTasks('tasks-content', state.tasksCache.next, false);
    updateProgress(state.tasksCache.next);
  } else if (view === 'archive') {
    titleEl.textContent = 'Archive';
    subEl.textContent = 'Past weeks (read only)';
    await renderArchiveList();
  } else if (view === 'settings') {
    titleEl.textContent = 'Settings';
    subEl.textContent = 'Configure workspace';
    renderSettings();
  }
}

document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => renderView(btn.dataset.view));
});
el('nav-settings-btn').addEventListener('click', () => renderView('settings'));

// ── Filters ───────────────────────────────────────────────────────────
el('assignee-filter').addEventListener('change', (e) => {
  state.assigneeFilter = e.target.value;
  if (state.currentView === 'dashboard') renderTasks('tasks-content', state.tasksCache.current, false);
  if (state.currentView === 'nextweek') renderTasks('tasks-content', state.tasksCache.next, false);
  if (state.currentView === 'archive') renderTasks('archive-tasks-content', state.tasksCache.archive || [], true);
});

function updateFilterDropdown() {
  const select = el('assignee-filter');
  if (!select) return;
  const currentVal = select.value;
  let html = `<option value="all">Everyone</option>`;
  state.knownLeads.forEach(lead => {
    html += `<option value="${esc(lead)}">${esc(lead)}</option>`;
  });
  select.innerHTML = html;
  if (state.knownLeads.includes(currentVal)) select.value = currentVal;
  else state.assigneeFilter = 'all';
}

// ── Date Helpers ──────────────────────────────────────────────────────
function weekBounds(weekKey) {
  const start = new Date(weekKey + 'T00:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return { start, end };
}
function fmtShort(d) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function isOverdue(task) {
  if (!task.dueDate || task.status === 'Done') return false;
  return new Date(task.dueDate + 'T23:59:59') < new Date();
}

// ── Header UI (Progress & Week Strip) ─────────────────────────────────
function updateProgress(tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'Done').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  
  el('progress-text').textContent = `${pct}%`;
  const circle = document.querySelector('.progress-ring__circle');
  const offset = 125.6 - (pct / 100) * 125.6; // 125.6 is approx circumference for r=20
  circle.style.strokeDashoffset = offset;
}

function renderWeekStrip(startDate, tasks) {
  const strip = el('week-strip');
  const todayStr = new Date().toISOString().split('T')[0];
  let html = '';
  
  const days = ['S','M','T','W','T','F','S']; // Fallbacks
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const letter = d.toLocaleDateString('en-US', { weekday: 'narrow' });
    const num = d.getDate();
    
    const isToday = dateStr === todayStr;
    const hasTask = tasks.some(t => t.dueDate === dateStr);
    
    html += `
      <div class="day-col ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <span class="day-letter">${letter}</span>
        <div class="day-number">
          ${num}
          ${hasTask ? '<div class="day-dot"></div>' : ''}
        </div>
      </div>
    `;
  }
  strip.innerHTML = html;
  
  // Optional: click to filter, skipping for now to keep it simple, just visuals
}

// ── Rendering Tasks ───────────────────────────────────────────────────
function renderTasks(containerId, tasks, readOnly) {
  const container = el(containerId);
  
  // Apply Filter
  let filtered = tasks;
  if (state.assigneeFilter !== 'all') {
    filtered = tasks.filter(t => t.campusLead === state.assigneeFilter);
  }

  if (!filtered.length) {
    container.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-tertiary);">No tasks found.</div>`;
    return;
  }

  // Sort by nearest due date
  filtered.sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  container.innerHTML = filtered.map(t => renderCard(t, readOnly)).join('');
  
  if (!readOnly) {
    container.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.move-btn')) {
          e.stopPropagation();
          confirmMove(card.dataset.id);
        } else {
          openModal(card.dataset.id);
        }
      });
    });
  }
}

function renderCard(task, readOnly) {
  const overdue = isOverdue(task);
  const statusCls = `status-${(task.status || 'Not Started').replace(/\s+/g,'-')}`;
  
  const moveBtn = (!readOnly && task.status !== 'Carried Over') ? `
    <button class="move-btn" title="Move to next week">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  ` : '';

  return `
    <div class="task-card ${task.status === 'Done' ? 'status-done' : ''} ${overdue ? 'overdue' : ''}" data-id="${task.id}">
      <div class="task-header">
        <div class="task-title">${esc(task.title)}</div>
        ${moveBtn}
      </div>
      
      <div class="task-badges">
        <span class="badge badge-status ${esc(task.status)}">${esc(task.status)}</span>
        ${task.priority && task.priority !== 'Medium' ? `<span class="badge" style="background:var(--surface-secondary)">${task.priority}</span>` : ''}
        ${overdue ? `<span class="badge badge-overdue">Overdue</span>` : ''}
      </div>
      
      <div class="task-footer">
        <div class="task-meta">
          ${task.campusLead ? `<span><span class="lead-avatar">${task.campusLead.charAt(0).toUpperCase()}</span> ${esc(task.campusLead)}</span>` : ''}
          ${task.dueDate ? `<span ${overdue ? 'style="color:var(--error-text)"' : ''}>${fmtShort(task.dueDate)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ── Archive View ──────────────────────────────────────────────────────
async function renderArchiveList() {
  const data = await GET('/api/tasks/weeks');
  if (!data) return;
  const past = data.weeks.filter(w => w < data.currentWeekKey && w !== data.nextWeekKey).reverse();
  
  const list = el('archive-week-list');
  el('archive-tasks-container').classList.add('hidden');
  list.classList.remove('hidden');
  
  if (!past.length) {
    list.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-tertiary);">No archived weeks.</div>`;
    return;
  }
  
  list.innerHTML = past.map(w => {
    const { start, end } = weekBounds(w);
    return `
      <button class="archive-week-btn" data-week="${w}">
        <span>${fmtShort(start)} – ${fmtShort(end)}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-tertiary)"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    `;
  }).join('');
  
  list.querySelectorAll('.archive-week-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const wData = await GET(`/api/tasks?week=${btn.dataset.week}`);
      if (!wData) return;
      list.classList.add('hidden');
      el('archive-tasks-container').classList.remove('hidden');
      state.tasksCache.archive = wData.tasks;
      renderTasks('archive-tasks-content', wData.tasks, true);
    });
  });
}

el('archive-back-btn').addEventListener('click', () => {
  el('archive-tasks-container').classList.add('hidden');
  el('archive-week-list').classList.remove('hidden');
});

// ── Settings View ─────────────────────────────────────────────────────
function renderSettings() {
  el('setting-club-name').value = state.config.clubName || '';
  el('setting-week-start').value = String(state.config.weekStartDay ?? 0);
}

el('save-general-settings').addEventListener('click', async () => {
  const clubName = el('setting-club-name').value.trim();
  const weekStartDay = parseInt(el('setting-week-start').value);
  const res = await PUT('/api/config', { clubName, weekStartDay });
  if (res && res.success) {
    state.config.clubName = clubName;
    state.config.weekStartDay = weekStartDay;
    el('settings-general-msg').classList.remove('hidden');
    setTimeout(() => el('settings-general-msg').classList.add('hidden'), 3000);
    await loadWeeks();
    await refreshTasks('current');
    await refreshTasks('next');
  }
});

el('save-password-btn').addEventListener('click', async () => {
  const currentPassword = el('current-pw').value;
  const newPassword = el('new-pw').value;
  const confirm = el('confirm-pw').value;
  const msg = el('settings-pw-msg');
  
  if (!currentPassword || !newPassword || !confirm) return showMsg(msg, 'All fields required', false);
  if (newPassword !== confirm) return showMsg(msg, 'Passwords do not match', false);
  
  const res = await PUT('/api/config', { currentPassword, newPassword });
  if (res && res.success) {
    el('current-pw').value = ''; el('new-pw').value = ''; el('confirm-pw').value = '';
    showMsg(msg, 'Password updated!', true);
  } else {
    showMsg(msg, res?.error || 'Error', false);
  }
});

function showMsg(element, text, success) {
  element.textContent = text;
  element.style.color = success ? 'var(--status-done-text)' : 'var(--error-text)';
  element.classList.remove('hidden');
  setTimeout(() => element.classList.add('hidden'), 3000);
}

// ── Modals / Bottom Sheets ────────────────────────────────────────────
el('fab-add-task').addEventListener('click', () => {
  openModal(null, state.currentView === 'nextweek' ? 'next' : 'current');
});

function populateDatalist() {
  el('leads-datalist').innerHTML = state.knownLeads.map(l => `<option value="${esc(l)}">`).join('');
}

function openModal(taskId = null, weekTarget = 'current') {
  state.editingTaskId = taskId;
  el('task-form').reset();
  el('modal-delete-btn').classList.toggle('hidden', !taskId);
  populateDatalist();
  
  if (taskId) {
    el('modal-title').textContent = 'Edit Task';
    const task = [...state.tasksCache.current, ...state.tasksCache.next].find(t => t.id === taskId);
    if (task) {
      el('task-id').value = task.id;
      el('task-title').value = task.title;
      el('task-description').value = task.description || '';
      el('task-lead').value = task.campusLead || '';
      el('task-due').value = task.dueDate || '';
      el('task-status').value = task.status || 'Not Started';
      el('task-priority').value = task.priority || 'Medium';
    }
    el('week-field-group').classList.add('hidden');
  } else {
    el('modal-title').textContent = 'New Task';
    el('task-id').value = '';
    el('task-status').value = 'Not Started';
    el('task-priority').value = 'Medium';
    el('week-field-group').classList.remove('hidden');
    el('task-week').value = weekTarget;
  }
  
  el('task-modal').classList.remove('hidden');
}

function closeSheet() {
  el('task-modal').classList.add('hidden');
}
el('modal-close-btn').addEventListener('click', closeSheet);
el('task-modal').addEventListener('click', e => { if(e.target === el('task-modal')) closeSheet(); });

el('task-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = el('task-id').value;
  const body = {
    title: el('task-title').value.trim(),
    description: el('task-description').value.trim(),
    campusLead: el('task-lead').value.trim(),
    dueDate: el('task-due').value,
    status: el('task-status').value,
    priority: el('task-priority').value,
  };
  if (!body.title) return;
  
  el('modal-save-btn').disabled = true;
  if (id) {
    await PUT(`/api/tasks/${id}`, body);
  } else {
    body.weekKey = el('task-week').value === 'next' ? state.weeks.next : state.weeks.current;
    await POST('/api/tasks', body);
  }
  el('modal-save-btn').disabled = false;
  
  closeSheet();
  await refreshTasks('current'); await refreshTasks('next');
  renderView(state.currentView);
});

el('modal-delete-btn').addEventListener('click', async () => {
  if (!state.editingTaskId) return;
  closeSheet();
  const ok = await askConfirm('Delete Task', 'Permanently delete this task?');
  if (ok) {
    await DEL(`/api/tasks/${state.editingTaskId}`);
    await refreshTasks('current'); await refreshTasks('next');
    renderView(state.currentView);
  }
});

async function confirmMove(taskId) {
  const ok = await askConfirm('Move to Next Week', 'Move this task to next week?');
  if (ok) {
    await POST(`/api/tasks/${taskId}/move-next-week`);
    await refreshTasks('current'); await refreshTasks('next');
    renderView(state.currentView);
  }
}

// ── Confirm Modal ─────────────────────────────────────────────────────
let confirmResolver = null;
function askConfirm(title, msg) {
  return new Promise(resolve => {
    confirmResolver = resolve;
    el('confirm-title').textContent = title;
    el('confirm-message').textContent = msg;
    el('confirm-modal').classList.remove('hidden');
  });
}
function closeConfirm(res) {
  el('confirm-modal').classList.add('hidden');
  if (confirmResolver) confirmResolver(res);
  confirmResolver = null;
}
el('confirm-cancel-btn').addEventListener('click', () => closeConfirm(false));
el('confirm-ok-btn').addEventListener('click', () => closeConfirm(true));

// Utils
function esc(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[m]);
}

boot();
