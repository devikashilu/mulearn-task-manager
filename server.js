require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const path = require('path');
const os   = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB connection ────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clubtasks';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('   Set MONGODB_URI in your .env file or environment variables.');
    process.exit(1);
  });

// ── Schemas ───────────────────────────────────────────────────────────────────
const TaskSchema = new mongoose.Schema({
  id:          { type: String, default: uuidv4 },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  campusLead:  { type: String, default: '' },
  assignedDate:{ type: String, default: '' },
  dueDate:     { type: String, default: '' },
  status:      { type: String, default: 'Not Started', enum: ['Not Started','In Progress','Done','Carried Over'] },
  priority:    { type: String, default: 'Medium', enum: ['Low','Medium','High'] },
  weekKey:     { type: String, required: true },
  carriedOver: { type: Boolean, default: false },
  movedAt:     { type: String, default: '' },
  createdAt:   { type: String, default: () => new Date().toISOString() },
  updatedAt:   { type: String, default: '' },
}, { _id: true });

const ConfigSchema = new mongoose.Schema({
  key:          { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  weekStartDay: { type: Number, default: 0 },
  clubName:     { type: String, default: 'My Club' },
  knownLeads:   { type: [String], default: [] },
});

const Task   = mongoose.model('Task',   TaskSchema);
const Config = mongoose.model('Config', ConfigSchema);

const DEFAULT_PASSWORD = 'clubpass2024';

async function getConfig() {
  let cfg = await Config.findOne({ key: 'main' });
  if (!cfg) {
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    cfg = await Config.create({ key: 'main', passwordHash: hash });
  }
  return cfg;
}

// ── Week helpers ──────────────────────────────────────────────────────────────
function getWeekKey(date, weekStartDay = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

function getNextWeekKey(weekKey) {
  const d = new Date(weekKey + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'club-secret-key-8f2a9b3c1d4e5f6a',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const cfg = await getConfig();
    if (!bcrypt.compareSync(password, cfg.passwordHash))
      return res.status(401).json({ error: 'Incorrect password' });
    req.session.authenticated = true;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// ── Config ────────────────────────────────────────────────────────────────────
app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json({ weekStartDay: cfg.weekStartDay, clubName: cfg.clubName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const { weekStartDay, clubName, newPassword, currentPassword } = req.body;
    if (weekStartDay !== undefined) cfg.weekStartDay = weekStartDay;
    if (clubName     !== undefined) cfg.clubName = clubName;
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      if (!bcrypt.compareSync(currentPassword, cfg.passwordHash))
        return res.status(401).json({ error: 'Current password incorrect' });
      cfg.passwordHash = bcrypt.hashSync(newPassword, 10);
    }
    await cfg.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const weekKey = req.query.week || getWeekKey(new Date(), cfg.weekStartDay);
    const tasks = await Task.find({ weekKey }).sort({ createdAt: 1 }).lean();
    // Add plain `id` field from _id if needed
    res.json({ tasks: tasks.map(t => ({ ...t, id: t.id || String(t._id) })), weekKey, knownLeads: cfg.knownLeads });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tasks/weeks', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const now = new Date();
    const currentWeekKey = getWeekKey(now, cfg.weekStartDay);
    const nextWeekKey    = getNextWeekKey(currentWeekKey);
    const distinct = await Task.distinct('weekKey');
    const weeks = distinct.sort();
    res.json({ weeks, currentWeekKey, nextWeekKey });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const cfg = await getConfig();
    const { title, description, campusLead, dueDate, priority, weekKey } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const now = new Date();
    const task = await Task.create({
      id:           uuidv4(),
      title,
      description:  description || '',
      campusLead:   campusLead  || '',
      assignedDate: now.toISOString().split('T')[0],
      dueDate:      dueDate || '',
      priority:     priority || 'Medium',
      weekKey:      weekKey || getWeekKey(now, cfg.weekStartDay),
      createdAt:    now.toISOString(),
    });

    if (campusLead && !cfg.knownLeads.includes(campusLead)) {
      cfg.knownLeads.push(campusLead);
      await cfg.save();
    }

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { title, description, campusLead, dueDate, status, priority } = req.body;
    if (title       !== undefined) task.title       = title;
    if (description !== undefined) task.description = description;
    if (campusLead  !== undefined) task.campusLead  = campusLead;
    if (dueDate     !== undefined) task.dueDate     = dueDate;
    if (status      !== undefined) task.status      = status;
    if (priority    !== undefined) task.priority    = priority;
    task.updatedAt = new Date().toISOString();
    await task.save();

    if (campusLead) {
      const cfg = await getConfig();
      if (!cfg.knownLeads.includes(campusLead)) {
        cfg.knownLeads.push(campusLead);
        await cfg.save();
      }
    }
    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks/:id/move-next-week', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const nextWeekKey = getNextWeekKey(task.weekKey);
    if (task.dueDate) {
      const d = new Date(task.dueDate + 'T00:00:00');
      d.setDate(d.getDate() + 7);
      task.dueDate = d.toISOString().split('T')[0];
    }
    task.weekKey     = nextWeekKey;
    task.status      = 'Carried Over';
    task.carriedOver = true;
    task.movedAt     = new Date().toISOString();
    await task.save();

    res.json({ task: { ...task.toObject(), id: task.id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const result = await Task.deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  console.log(`\n✦  Club Task Manager is running!\n`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://${getLocalIP()}:${PORT}`);
  console.log(`\n📝 Default password: "${DEFAULT_PASSWORD}" (change in Settings)\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} already in use. Kill the old process first:\n`);
    console.error(`   netstat -ano | findstr :${PORT}  →  taskkill /PID <pid> /F\n`);
    process.exit(1);
  } else throw err;
});
