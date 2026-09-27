require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const path = require('path');
const os = require('os');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── MongoDB connection ────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mulearntasks';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ── Schemas ───────────────────────────────────────────────────────────────────
const TaskSchema = new mongoose.Schema({
  id:          { type: String, default: uuidv4, index: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  campusLead:  { type: String, default: '', index: true },
  assignedDate:{ type: String, default: '' },
  dueDate:     { type: String, default: '', index: true },
  status:      { type: String, default: 'Not Started', enum: ['Not Started', 'In Progress', 'Done', 'Carried Over'], index: true },
  priority:    { type: String, default: 'Medium', enum: ['Low', 'Medium', 'High'] },
  weekKey:     { type: String, required: true, index: true },
  carriedOver: { type: Boolean, default: false },
  movedAt:     { type: String, default: '' },
  // Soft delete
  isDeleted:   { type: Boolean, default: false, index: true },
  deletedAt:   { type: String, default: '' },
  // Proof of work
  proofRequired:   { type: Boolean, default: false },
  proofType:       { type: String, default: '', enum: ['', 'url', 'github', 'text', 'file'] },
  proofContent:    { type: String, default: '' },
  proofStatus:     { type: String, default: 'Not Submitted', enum: ['Not Submitted', 'Submitted', 'Under Review', 'Approved', 'Needs Revision'] },
  proofSubmittedAt:{ type: String, default: '' },
  reviewFeedback:  { type: String, default: '' },
  reviewedAt:      { type: String, default: '' },
  createdAt:   { type: String, default: () => new Date().toISOString(), index: true },
  updatedAt:   { type: String, default: '' },
}, { _id: true });

const ActivitySchema = new mongoose.Schema({
  id:       { type: String, default: uuidv4 },
  taskId:   { type: String, index: true },
  taskTitle:{ type: String, default: '' },
  action:   { type: String, required: true },
  detail:   { type: String, default: '' },
  actor:    { type: String, default: '' },
  weekKey:  { type: String, default: '' },
  createdAt:{ type: String, default: () => new Date().toISOString(), index: true },
});

const NotificationSchema = new mongoose.Schema({
  id:        { type: String, default: uuidv4 },
  type:      { type: String, required: true },
  message:   { type: String, required: true },
  taskId:    { type: String, default: '' },
  taskTitle: { type: String, default: '' },
  assignee:  { type: String, default: '' },
  read:      { type: Boolean, default: false },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true },
});

const ConfigSchema = new mongoose.Schema({
  key:          { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  weekStartDay: { type: Number, default: 0 }, // Always 0 (Sunday)
  clubName:     { type: String, default: 'MuLearn Tasks' },
  knownLeads:   { type: [String], default: [] },
});

const Task         = mongoose.model('Task',         TaskSchema);
const Activity     = mongoose.model('Activity',     ActivitySchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Config       = mongoose.model('Config',       ConfigSchema);

const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'clubpass2024';

async function getConfig() {
  let cfg = await Config.findOne({ key: 'main' });
  if (!cfg) {
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    cfg = await Config.create({ key: 'main', passwordHash: hash });
  }
  return cfg;
}

// ── Week helpers ──────────────────────────────────────────────────────────────
// Weeks always run Sunday–Saturday
function getWeekKey(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getNextWeekKey(weekKey) {
  const parts = weekKey.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Activity helper ───────────────────────────────────────────────────────────
async function logActivity(taskId, taskTitle, action, detail = '', actor = '', weekKey = '') {
  try {
    await Activity.create({ taskId, taskTitle, action, detail, actor, weekKey });
  } catch (e) { console.error('Activity log error:', e.message); }
}

async function createNotification(type, message, taskId = '', taskTitle = '', assignee = '') {
  try {
    await Notification.create({ type, message, taskId, taskTitle, assignee });
  } catch (e) { console.error('Notification error:', e.message); }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'mulearn-secret-key-8f2a9b3c1d4e5f6a',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function sanitize(str) {
  if (!str) return '';
  return String(str).trim().slice(0, 2000);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const cfg = await getConfig();
    if (!bcrypt.compareSync(password, cfg.passwordHash))
      return res.status(401).json({ error: 'Incorrect password' });
    req.session.authenticated = true;
    req.session.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// ── Config ────────────────────────────────────────────────────────────────────
app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json({ weekStartDay: cfg.weekStartDay, clubName: cfg.clubName });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const { clubName, newPassword, currentPassword } = req.body;
    if (clubName !== undefined) cfg.clubName = sanitize(clubName).slice(0, 100);
    cfg.weekStartDay = 0; // Always Sunday
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      if (!bcrypt.compareSync(currentPassword, cfg.passwordHash))
        return res.status(401).json({ error: 'Current password incorrect' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      cfg.passwordHash = bcrypt.hashSync(newPassword, 12);
    }
    await cfg.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const weekKey = req.query.week || getWeekKey(new Date());
    const query = { weekKey, isDeleted: { $ne: true } };
    const tasks = await Task.find(query).sort({ createdAt: 1 }).lean();
    res.json({ tasks: tasks.map(t => ({ ...t, id: t.id || String(t._id) })), weekKey, knownLeads: cfg.knownLeads });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/tasks/search', requireAuth, async (req, res) => {
  try {
    const { q, week } = req.query;
    if (!q || q.trim().length < 1) return res.json({ tasks: [] });
    const weekKey = week || getWeekKey(new Date());
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const tasks = await Task.find({
      weekKey,
      isDeleted: { $ne: true },
      $or: [{ title: regex }, { description: regex }, { campusLead: regex }]
    }).sort({ createdAt: 1 }).lean();
    res.json({ tasks: tasks.map(t => ({ ...t, id: t.id || String(t._id) })) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/tasks/weeks', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const currentWeekKey = getWeekKey(now);
    const nextWeekKey = getNextWeekKey(currentWeekKey);
    const distinct = await Task.distinct('weekKey', { isDeleted: { $ne: true } });
    const weeks = distinct.filter(Boolean).sort();
    res.json({ weeks, currentWeekKey, nextWeekKey });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const { title, description, campusLead, dueDate, priority, weekKey, proofRequired } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

    const now = new Date();
    const wk = weekKey || getWeekKey(now);
    const task = await Task.create({
      id: uuidv4(),
      title: sanitize(title).slice(0, 200),
      description: sanitize(description).slice(0, 2000),
      campusLead: sanitize(campusLead).slice(0, 100),
      assignedDate: now.toISOString().split('T')[0],
      dueDate: dueDate || '',
      priority: ['Low', 'Medium', 'High'].includes(priority) ? priority : 'Medium',
      weekKey: wk,
      proofRequired: !!proofRequired,
      createdAt: now.toISOString(),
    });

    const lead = sanitize(campusLead);
    if (lead && !cfg.knownLeads.includes(lead)) {
      cfg.knownLeads.push(lead);
      await cfg.save();
    }

    await logActivity(task.id, task.title, 'created', `Created by ${lead || 'team'}`, lead, wk);
    if (lead) {
      await createNotification('assigned', `New task assigned: ${task.title}`, task.id, task.title, lead);
    }

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id, isDeleted: { $ne: true } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { title, description, campusLead, dueDate, status, priority, proofRequired } = req.body;
    const changes = [];

    if (title !== undefined && title !== task.title) {
      changes.push(`Title: "${task.title}" → "${title}"`);
      task.title = sanitize(title).slice(0, 200);
    }
    if (description !== undefined) task.description = sanitize(description).slice(0, 2000);
    if (campusLead !== undefined && campusLead !== task.campusLead) {
      changes.push(`Assigned: "${task.campusLead}" → "${campusLead}"`);
      task.campusLead = sanitize(campusLead).slice(0, 100);
    }
    if (dueDate !== undefined && dueDate !== task.dueDate) {
      changes.push(`Due: "${task.dueDate}" → "${dueDate}"`);
      task.dueDate = dueDate;
    }
    if (status !== undefined && ['Not Started', 'In Progress', 'Done', 'Carried Over'].includes(status)) {
      if (status !== task.status) changes.push(`Status: "${task.status}" → "${status}"`);
      task.status = status;
    }
    if (priority !== undefined && ['Low', 'Medium', 'High'].includes(priority)) {
      if (priority !== task.priority) changes.push(`Priority: "${task.priority}" → "${priority}"`);
      task.priority = priority;
    }
    if (proofRequired !== undefined) task.proofRequired = !!proofRequired;

    task.updatedAt = new Date().toISOString();
    await task.save();

    if (task.campusLead) {
      const cfg = await getConfig();
      if (!cfg.knownLeads.includes(task.campusLead)) {
        cfg.knownLeads.push(task.campusLead);
        await cfg.save();
      }
    }

    if (changes.length) {
      await logActivity(task.id, task.title, 'updated', changes.join('; '), task.campusLead, task.weekKey);
    }
    if (status === 'Done' && changes.some(c => c.includes('Status'))) {
      await createNotification('completed', `Task completed: ${task.title}`, task.id, task.title, task.campusLead);
    }

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/tasks/:id/move-next-week', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id, isDeleted: { $ne: true } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const nextWeekKey = getNextWeekKey(task.weekKey);
    const oldWeekKey = task.weekKey;
    if (task.dueDate) {
      const parts = task.dueDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + 7);
      task.dueDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    task.weekKey = nextWeekKey;
    task.status = 'Carried Over';
    task.carriedOver = true;
    task.movedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    await task.save();

    await logActivity(task.id, task.title, 'moved', `Moved from ${oldWeekKey} to ${nextWeekKey}`, task.campusLead, nextWeekKey);

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Soft delete
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    task.isDeleted = true;
    task.deletedAt = new Date().toISOString();
    await task.save();
    await logActivity(task.id, task.title, 'deleted', 'Task soft-deleted', task.campusLead, task.weekKey);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Restore soft-deleted
app.post('/api/tasks/:id/restore', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id, isDeleted: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    task.isDeleted = false;
    task.deletedAt = '';
    await task.save();
    await logActivity(task.id, task.title, 'restored', 'Task restored', task.campusLead, task.weekKey);
    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Proof of Work ─────────────────────────────────────────────────────────────
app.post('/api/tasks/:id/proof', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id, isDeleted: { $ne: true } });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const { proofType, proofContent } = req.body;
    if (!proofContent) return res.status(400).json({ error: 'Proof content required' });

    task.proofType = ['url', 'github', 'text', 'file'].includes(proofType) ? proofType : 'text';
    task.proofContent = sanitize(proofContent).slice(0, 2000);
    task.proofStatus = 'Submitted';
    task.proofSubmittedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    await task.save();

    await logActivity(task.id, task.title, 'proof_submitted', `Proof submitted (${task.proofType})`, task.campusLead, task.weekKey);
    await createNotification('proof_submitted', `Proof submitted for: ${task.title}`, task.id, task.title, task.campusLead);

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/tasks/:id/review', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id, isDeleted: { $ne: true } });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const { decision, feedback } = req.body;
    if (!['approved', 'changes_requested'].includes(decision))
      return res.status(400).json({ error: 'Decision must be approved or changes_requested' });

    task.proofStatus = decision === 'approved' ? 'Approved' : 'Needs Revision';
    task.reviewFeedback = sanitize(feedback || '').slice(0, 1000);
    task.reviewedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    if (decision === 'approved') task.status = 'Done';
    await task.save();

    const action = decision === 'approved' ? 'proof_approved' : 'proof_changes_requested';
    await logActivity(task.id, task.title, action, feedback || '', task.campusLead, task.weekKey);
    const msg = decision === 'approved'
      ? `Proof approved for: ${task.title}`
      : `Changes requested for: ${task.title}`;
    await createNotification(decision, msg, task.id, task.title, task.campusLead);

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Activity & Notifications ──────────────────────────────────────────────────
app.get('/api/activity', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const week = req.query.week;
    const query = week ? { weekKey: week } : {};
    const activities = await Activity.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ activities });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({}).sort({ createdAt: -1 }).limit(20).lean();
    const unread = await Notification.countDocuments({ read: false });
    res.json({ notifications, unread });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await Notification.updateMany({ read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Serve frontend ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✦  MuLearn Task Manager running!\n`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${getLocalIP()}:${PORT}`);
  console.log(`\n🔑 Default password: "${DEFAULT_PASSWORD}"\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} already in use.`);
    process.exit(1);
  } else throw err;
});
