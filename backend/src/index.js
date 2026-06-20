require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGINS = [
  'chrome-extension://*',  // extension calls
  process.env.DASHBOARD_URL // web dashboard if any
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (curl, Postman) + chrome-extension://
    if (!origin || origin.startsWith('chrome-extension://')) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json());

// Health check — Render pings this to keep service alive
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

app.use('/memory', require('./routes/memory'));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend on ${PORT}`));