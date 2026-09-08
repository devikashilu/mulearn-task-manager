/* ══════════════════════════════════════════════════════════════════
   CLUB TASK MANAGER — app.js
   Single-page app: login, dashboard, next week, archive, settings
══════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────
const state = {
  currentView: 'dashboard',
  groupBy: 'status',      // 'status' | 'lead'
  weeks: { current: null, next: null },
  tasks: [],
  knownLeads: [],
  config: { weekStartDay: 0, clubName: 'My Club' },
  archiveWeek: null,
  editingTaskId: null,
  addingToWeek: 'current', // 'current' | 'next'
};

// ── API helpers ────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showLogin();
    return null;
  }
  return res.json();
}

const GET  = (path)        => api('GET',    path);
const POST = (path, body)  => api('POST',   path, body);
const PUT  = (path, body)  => api('PUT',    path, body);
const DEL  = (path)        => api('DELETE', path);

// ── Boot ───────────────────────────────────────────────────────────
async function boot() {
  const auth = await GET('/api/auth-check');
  if (!auth) return;
  if (auth.authenticated) {
    await loadConfigAndShow();
  } else {
    showLogin();
  }
}

async function loadConfigAndShow() {
  const cfg = await GET('/api/config');
  if (!cfg) return;
  state.config = cfg;
  updateBranding();
  showApp();
  await loadWeeks();
  renderView('dashboard');
}

function updateBranding() {
  const name = state.config.clubName || 'Club Tasks';
  el('sidebar-club-name').textContent  = name;
  el('mobile-club-name').textContent   = name;
  el('login-club-name').textContent    = name;
}

// ── Login ──────────────────────────────────────────────────────────
function showLogin() {
  el('app').classList.add('hidden');
  el('login-screen').classList.remove('hidden');
  el('password-input').focus();
}

function showApp() {
  el('login-screen').classList.add('hidden');
  el('app').classList.remove('hidden');
}

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = el('password-input').value;
  const btn = el('login-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Checking...';
  const res = await POST('/api/login', { password: pw });
  if (res && res.success) {
    el('login-error').classList.add('hidden');
    el('password-input').value = '';
    await loadConfigAndShow();
  } else {
    el('login-error').classList.remove('hidden');
  }
  btn.disabled = false;
  btn.querySelector('span').textContent = 'Unlock';
});

el('toggle-pw').addEventListener('click', () => {
  const inp = el('password-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

el('logout-btn').addEventListener('click', async () => {
  await POST('/api/logout');
  showLogin();
});

// ── Navigation ─────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el(`view-${view}`).classList.add('active');
  el(`nav-${view}`).classList.add('active');
  closeSidebar();
}

async function renderView(view) {
  setView(view);
  switch (view) {
    case 'dashboard': await renderDashboard(); break;
    case 'nextweek':  await renderNextWeek(); break;
    case 'archive':   await renderArchiveList(); break;
    case 'settings':  await renderSettings(); break;
  }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => renderView(btn.dataset.view));
});

// ── Sidebar mobile ─────────────────────────────────────────────────
el('hamburger-btn').addEventListener('click', () => {
  el('sidebar').classList.add('open');
  el('sidebar-overlay').classList.remove('hidden');
});
el('sidebar-overlay').addEventListener('click', closeSidebar);
function closeSidebar() {
  el('sidebar').classList.remove('open');
  el('sidebar-overlay').classList.add('hidden');
}

// ── Week data ──────────────────────────────────────────────────────
async function loadWeeks() {
  const data = await GET('/api/tasks/weeks');
  if (!data) return;
  state.weeks.current = data.currentWeekKey;
  state.weeks.next    = data.nextWeekKey;
  const { start, end } = weekBoundsFromKey(state.weeks.current);
  el('sidebar-week-label').textContent = `${fmtShort(start)} – ${fmtShort(end)}`;
}

function weekBoundsFromKey(weekKey) {
  const d = new Date(weekKey + 'T00:00:00');
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return { start: d, end };
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(task) {
  if (!task.dueDate) return false;
  if (task.status === 'Done') return false;
  return new Date(task.dueDate + 'T23:59:59') < new Date();
}

// ── Dashboard ──────────────────────────────────────────────────────
async function renderDashboard() {
  const data = await GET(`/api/tasks?week=${state.weeks.current}`);
  if (!data) return;
  state.tasks     = data.tasks;
  state.knownLeads = data.knownLeads;

  const { start, end } = weekBoundsFromKey(state.weeks.current);
  el('dashboard-week-range').textContent =
    `Week of ${fmtShort(start)} – ${fmtShort(end)}`;

  renderStats(state.tasks);
  renderTaskGroups('dashboard-content', state.tasks, false);
}

function renderStats(tasks) {
  const counts = {
    total: tasks.length,
    done: tasks.filter(t => t.status === 'Done').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    overdue: tasks.filter(isOverdue).length,
  };
  el('dashboard-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-num" style="color:var(--accent-light)">${counts.total}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--green)">${counts.done}</div>
      <div class="stat-label">Done</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--blue)">${counts.inProgress}</div>
      <div class="stat-label">In Progress</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:var(--red)">${counts.overdue}</div>
      <div class="stat-label">Overdue</div>
    </div>
  `;
}

function renderTaskGroups(containerId, tasks, readOnly) {
  const container = el(containerId);
  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No tasks here yet</h3>
        <p>Add tasks using the button above</p>
      </div>`;
    return;
  }

  if (state.groupBy === 'status') {
    const ORDER = ['Not Started', 'In Progress', 'Done', 'Carried Over'];
    const groups = {};
    ORDER.forEach(s => groups[s] = []);
    tasks.forEach(t => {
      const s = t.status || 'Not Started';
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    });
    container.innerHTML = ORDER
      .filter(s => groups[s].length)
      .map(s => renderGroup(s, groups[s], readOnly))
      .join('');
  } else {
    // Group by lead
    const groups = {};
    tasks.forEach(t => {
      const lead = t.campusLead || 'Unassigned';
      if (!groups[lead]) groups[lead] = [];
      groups[lead].push(t);
    });
    container.innerHTML = Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([lead, tTasks]) => renderGroup(lead, tTasks, readOnly))
      .join('');
  }

  // Attach events
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTaskAction);
  });
}

function renderGroup(label, tasks, readOnly) {
  return `
    <div class="task-group">
      <div class="task-group-header">
        <span class="task-group-title">${escHtml(label)}</span>
        <span class="task-group-count">${tasks.length}</span>
      </div>
      <div class="task-list">
        ${tasks.map(t => renderTaskCard(t, readOnly)).join('')}
      </div>
    </div>
  `;
}

function statusClass(status) {
  return 'status-' + (status || 'not-started').toLowerCase().replace(/\s+/g, '-');
}
function statusBadge(task) {
  const s = task.status || 'Not Started';
  const cls = {
    'Not Started': 'badge-not-started',
    'In Progress':  'badge-in-progress',
    'Done':         'badge-done',
    'Carried Over': 'badge-carried-over',
  }[s] || 'badge-not-started';
  return `<span class="badge ${cls}">${escHtml(s)}</span>`;
}
function priorityBadge(p) {
  if (!p || p === 'Medium') return `<span class="badge badge-medium">Med</span>`;
  if (p === 'High')   return `<span class="badge badge-high">High</span>`;
  if (p === 'Low')    return `<span class="badge badge-low">Low</span>`;
  return '';
}

function renderTaskCard(task, readOnly) {
  const overdue = isOverdue(task);
  const cls = [
    'task-card',
    statusClass(task.status),
    overdue ? 'overdue' : '',
  ].filter(Boolean).join(' ');

  const actions = readOnly ? '' : `
    <div class="task-actions">
      <button class="btn-icon" data-action="edit" data-id="${task.id}" title="Edit">✏️</button>
      <button class="btn-icon" data-action="move" data-id="${task.id}" title="Move to next week" style="font-size:0.8rem">▶▶</button>
      <button class="btn-icon" data-action="delete" data-id="${task.id}" title="Delete" style="color:var(--red)">🗑</button>
    </div>
  `;

  const overdueTag = overdue
    ? `<span class="badge badge-overdue">Overdue</span>`
    : '';
  const carriedTag = task.carriedOver
    ? `<span class="carried-tag">Carried Over</span>`
    : '';

  return `
    <div class="${cls}" id="task-${task.id}">
      <div class="task-main">
        <div class="task-title-row">
          <span class="task-title">${escHtml(task.title)}</span>
          ${statusBadge(task)}
          ${priorityBadge(task.priority)}
          ${overdueTag}
          ${carriedTag}
        </div>
        ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          ${task.campusLead ? `
            <span class="task-meta-item">
              <span class="task-meta-icon">👤</span> ${escHtml(task.campusLead)}
            </span>` : ''}
          ${task.dueDate ? `
            <span class="task-meta-item ${overdue ? 'style="color:var(--red)"' : ''}">
              <span class="task-meta-icon">📅</span> Due ${fmtDate(task.dueDate)}
            </span>` : ''}
          ${task.assignedDate ? `
            <span class="task-meta-item">
              <span class="task-meta-icon">🗓</span> Added ${fmtDate(task.assignedDate)}
            </span>` : ''}
        </div>
      </div>
      ${actions}
    </div>
  `;
}

async function handleTaskAction(e) {
  const btn = e.currentTarget;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'edit') {
    await openEditModal(id);
  } else if (action === 'move') {
    await confirmMoveToNextWeek(id);
  } else if (action === 'delete') {
    await confirmDelete(id);
  }
}

// ── Group by toggle ────────────────────────────────────────────────
document.querySelectorAll('.group-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.groupBy = btn.dataset.group;
    renderTaskGroups('dashboard-content', state.tasks, false);
  });
});

// ── Next Week ──────────────────────────────────────────────────────
async function renderNextWeek() {
  const data = await GET(`/api/tasks?week=${state.weeks.next}`);
  if (!data) return;
  const { start, end } = weekBoundsFromKey(state.weeks.next);
  el('nextweek-range').textContent =
    `Week of ${fmtShort(start)} – ${fmtShort(end)}`;

  state.knownLeads = data.knownLeads;
  renderTaskGroups('nextweek-content', data.tasks, false);

  // re-attach after render
  el('nextweek-content').querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTaskAction);
  });
}

// ── Archive ────────────────────────────────────────────────────────
async function renderArchiveList() {
  const data = await GET('/api/tasks/weeks');
  if (!data) return;
  const { weeks, currentWeekKey, nextWeekKey } = data;

  // Past weeks only
  const past = weeks.filter(w => w < currentWeekKey && w !== nextWeekKey).reverse();

  el('archive-tasks').classList.add('hidden');
  const list = el('archive-week-list');

  if (!past.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗂</div>
        <h3>No archived weeks yet</h3>
        <p>Past weeks will appear here once this week passes.</p>
      </div>`;
    return;
  }

  list.innerHTML = past.map(w => {
    const { start, end } = weekBoundsFromKey(w);
    return `
      <button class="archive-week-btn" data-week="${w}">
        <span>Week of ${fmtShort(start)} – ${fmtShort(end)}</span>
        <span class="archive-week-meta">${fmtDate(w)}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.archive-week-btn').forEach(btn => {
    btn.addEventListener('click', () => openArchiveWeek(btn.dataset.week, btn));
  });
}

async function openArchiveWeek(weekKey, btn) {
  const data = await GET(`/api/tasks?week=${weekKey}`);
  if (!data) return;
  state.archiveWeek = weekKey;

  el('archive-week-list').querySelectorAll('.archive-week-btn')
    .forEach(b => b.classList.toggle('active', b === btn));

  const tasksEl = el('archive-tasks');
  tasksEl.classList.remove('hidden');

  const { start, end } = weekBoundsFromKey(weekKey);
  tasksEl.innerHTML = `
    <button class="archive-back" id="archive-back-btn">← All weeks</button>
    <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:18px;color:var(--text2)">
      Week of ${fmtShort(start)} – ${fmtShort(end)}
    </h2>
    <div id="archive-task-list"></div>
  `;
  el('archive-back-btn').addEventListener('click', () => {
    el('archive-tasks').classList.add('hidden');
    el('archive-week-list').querySelectorAll('.archive-week-btn')
      .forEach(b => b.classList.remove('active'));
  });

  renderTaskGroups('archive-task-list', data.tasks, true);
}

// ── Settings ───────────────────────────────────────────────────────
async function renderSettings() {
  el('setting-club-name').value = state.config.clubName || '';
  el('setting-week-start').value = String(state.config.weekStartDay ?? 0);
}

el('save-general-settings').addEventListener('click', async () => {
  const name = el('setting-club-name').value.trim();
  const weekStartDay = parseInt(el('setting-week-start').value);
  const res = await PUT('/api/config', { clubName: name, weekStartDay });
  if (res && res.success) {
    state.config.clubName = name;
    state.config.weekStartDay = weekStartDay;
    updateBranding();
    showMsg('settings-general-msg', 'Saved!', true);
    await loadWeeks();
  }
});

el('save-password-btn').addEventListener('click', async () => {
  const cur  = el('current-pw').value;
  const nw   = el('new-pw').value;
  const conf = el('confirm-pw').value;
  if (!cur || !nw || !conf) {
    return showMsg('settings-pw-msg', 'All fields required', false);
  }
  if (nw.length < 6) {
    return showMsg('settings-pw-msg', 'New password must be at least 6 characters', false);
  }
  if (nw !== conf) {
    return showMsg('settings-pw-msg', 'Passwords do not match', false);
  }
  const res = await PUT('/api/config', { currentPassword: cur, newPassword: nw });
  if (res && res.success) {
    el('current-pw').value = '';
    el('new-pw').value = '';
    el('confirm-pw').value = '';
    showMsg('settings-pw-msg', 'Password updated!', true);
  } else {
    showMsg('settings-pw-msg', res?.error || 'Error updating password', false);
  }
});

function showMsg(id, msg, success) {
  const el2 = el(id);
  el2.textContent = msg;
  el2.className = success ? 'success-msg' : 'error-msg';
  el2.classList.remove('hidden');
  setTimeout(() => el2.classList.add('hidden'), 3500);
}

// ── Add Task buttons ───────────────────────────────────────────────
el('add-task-btn').addEventListener('click', () => openAddModal('current'));
el('mobile-add-btn').addEventListener('click', () => {
  const week = state.currentView === 'nextweek' ? 'next' : 'current';
  openAddModal(week);
});
el('add-nextweek-btn').addEventListener('click', () => openAddModal('next'));

// ── Modal ──────────────────────────────────────────────────────────
function openAddModal(weekTarget) {
  state.editingTaskId = null;
  state.addingToWeek  = weekTarget;
  el('modal-title').textContent = 'Add Task';
  el('task-form').reset();
  el('task-id').value = '';
  el('task-priority').value = 'Medium';
  el('task-status').value = 'Not Started';

  // Week picker — shown when using from dashboard
  const weekGroup = el('week-field-group');
  if (state.currentView === 'dashboard' || state.currentView === 'nextweek') {
    weekGroup.classList.add('hidden');
  } else {
    weekGroup.classList.remove('hidden');
  }
  el('task-week').value = weekTarget === 'next' ? 'next' : 'current';

  populateLeadsDatalist();
  el('task-modal').classList.remove('hidden');
  el('task-title').focus();
}

async function openEditModal(taskId) {
  const allData = await GET(`/api/tasks?week=${state.weeks.current}`);
  const nwData  = await GET(`/api/tasks?week=${state.weeks.next}`);
  const allTasks = [...(allData?.tasks || []), ...(nwData?.tasks || [])];
  // Also search archived if needed
  const task = allTasks.find(t => t.id === taskId)
    || state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  el('modal-title').textContent = 'Edit Task';
  el('task-id').value     = task.id;
  el('task-title').value  = task.title || '';
  el('task-description').value = task.description || '';
  el('task-lead').value   = task.campusLead || '';
  el('task-due').value    = task.dueDate || '';
  el('task-status').value = task.status || 'Not Started';
  el('task-priority').value = task.priority || 'Medium';
  el('week-field-group').classList.add('hidden');

  populateLeadsDatalist();
  el('task-modal').classList.remove('hidden');
  el('task-title').focus();
}

function populateLeadsDatalist() {
  const dl = el('leads-datalist');
  dl.innerHTML = state.knownLeads
    .map(l => `<option value="${escHtml(l)}">`)
    .join('');
}

function closeModal() {
  el('task-modal').classList.add('hidden');
  el('task-form').reset();
}

el('modal-close-btn').addEventListener('click', closeModal);
el('modal-cancel-btn').addEventListener('click', closeModal);
el('task-modal').addEventListener('click', e => {
  if (e.target === el('task-modal')) closeModal();
});

el('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el('task-id').value;
  const body = {
    title:       el('task-title').value.trim(),
    description: el('task-description').value.trim(),
    campusLead:  el('task-lead').value.trim(),
    dueDate:     el('task-due').value,
    status:      el('task-status').value,
    priority:    el('task-priority').value,
  };

  if (!body.title) return;

  el('modal-save-btn').disabled = true;
  let res;
  if (id) {
    res = await PUT(`/api/tasks/${id}`, body);
  } else {
    // Determine which week key to use
    const weekTarget = el('task-week').value;
    body.weekKey = weekTarget === 'next' ? state.weeks.next : state.weeks.current;
    // Override based on current view
    if (state.currentView === 'nextweek') body.weekKey = state.weeks.next;
    if (state.currentView === 'dashboard') body.weekKey = state.weeks.current;
    res = await POST('/api/tasks', body);
  }

  el('modal-save-btn').disabled = false;
  if (!res) return;
  closeModal();
  await refreshCurrentView();
});

// ── Confirm modals ─────────────────────────────────────────────────
let _pendingConfirm = null;

function showConfirm(title, msg, okLabel, okClass) {
  return new Promise(resolve => {
    _pendingConfirm = resolve;
    el('confirm-title').textContent   = title;
    el('confirm-message').textContent = msg;
    el('confirm-ok-btn').textContent  = okLabel || 'Confirm';
    el('confirm-ok-btn').className    = 'btn ' + (okClass || 'btn-danger');
    el('confirm-modal').classList.remove('hidden');
  });
}
function closeConfirm(result) {
  el('confirm-modal').classList.add('hidden');
  if (_pendingConfirm) { _pendingConfirm(result); _pendingConfirm = null; }
}
el('confirm-cancel-btn').addEventListener('click', () => closeConfirm(false));
el('confirm-close-btn').addEventListener('click', () => closeConfirm(false));
el('confirm-ok-btn').addEventListener('click', () => closeConfirm(true));
el('confirm-modal').addEventListener('click', e => {
  if (e.target === el('confirm-modal')) closeConfirm(false);
});

async function confirmMoveToNextWeek(taskId) {
  const ok = await showConfirm(
    'Move to Next Week',
    'This task will be moved to next week and tagged "Carried Over". This cannot be undone automatically.',
    'Move ▶',
    'btn-primary'
  );
  if (!ok) return;
  const res = await POST(`/api/tasks/${taskId}/move-next-week`);
  if (res && res.task) await refreshCurrentView();
}

async function confirmDelete(taskId) {
  const ok = await showConfirm(
    'Delete Task',
    'Are you sure you want to permanently delete this task?',
    'Delete',
    'btn-danger'
  );
  if (!ok) return;
  const res = await DEL(`/api/tasks/${taskId}`);
  if (res && res.success) await refreshCurrentView();
}

// ── Refresh ────────────────────────────────────────────────────────
async function refreshCurrentView() {
  await loadWeeks();
  switch (state.currentView) {
    case 'dashboard': await renderDashboard(); break;
    case 'nextweek':  await renderNextWeek();  break;
    case 'archive':   /* archive is read-only */ break;
  }
}

// ── Escape HTML ────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Go ─────────────────────────────────────────────────────────────
boot();
