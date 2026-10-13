require('dotenv').config();
const mongoose = require('mongoose');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createMongoHandoffStore, createMemoryHandoffStore } = require('./stores/handoffStore');

const config = loadConfig();
const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

let handoffStore;
if (config.storage === 'memory') {
  console.warn('STORAGE=memory: saved handoffs are kept in process memory and lost on restart.');
  handoffStore = createMemoryHandoffStore();
} else {
  handoffStore = createMongoHandoffStore(mongoose);
}

// The server starts even when MongoDB is unreachable: AI generation keeps
// working and the extension keeps handoffs locally until the database is back.
if (config.mongoUri) {
  mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(`MongoDB connection failed: ${err.message}. Storage endpoints will return 503.`));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
} else if (config.storage !== 'memory') {
  console.warn('MONGO_URI is not set. Storage endpoints will return 503 (or set STORAGE=memory for a non-persistent dev store).');
}

const app = createApp({
  config,
  handoffStore,
  dbStatus: () => (config.storage === 'memory' ? 'memory' : DB_STATES[mongoose.connection.readyState] || 'unknown'),
  memoryRoutes: require('./routes/memory'),
});

app.listen(config.port, () => {
  const llm = config.llm.provider === 'none' ? 'not configured (deterministic handoffs only)' : config.llm.provider;
  console.log(`Backend on ${config.port} — LLM: ${llm}`);
});
