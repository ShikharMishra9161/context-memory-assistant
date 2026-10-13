const express = require('express');
const cors = require('cors');
const { clientAuth } = require('./middleware/clientAuth');
const { rateLimit } = require('./middleware/rateLimit');
const { requestLogger, errorHandler } = require('./lib/http');
const { handoffRoutes } = require('./routes/handoffs');
const { generateRoutes } = require('./routes/generate');
const { createLlmProvider } = require('./services/llm/providers');

function isAllowedOrigin(origin, config) {
  if (!origin) return true; // curl, server-to-server, same-origin
  if (config.allowedOrigins.includes(origin)) return true;
  const ext = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
  if (ext) return config.allowedExtensionIds.length === 0 || config.allowedExtensionIds.includes(ext[1]);
  return false;
}

/**
 * Builds the Express app. Dependencies are injected so tests can use an
 * in-memory store and a fake LLM.
 * @param {{config: object, handoffStore: object, dbStatus?: () => string, llm?: object|null, memoryRoutes?: express.Router|null, logger?: Console}} deps
 */
function createApp({ config, handoffStore, dbStatus = () => 'unknown', llm, memoryRoutes = null, logger = console }) {
  const app = express();
  app.locals.config = config;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  let llmUnavailableReason = '';
  if (llm === undefined) {
    const created = createLlmProvider(config.llm);
    llm = created.provider;
    llmUnavailableReason = created.reason;
  } else if (!llm) {
    llmUnavailableReason = 'No LLM provider configured.';
  }

  app.use(requestLogger(logger));

  // Reject disallowed browser origins outright instead of only omitting CORS headers.
  app.use((req, res, next) => {
    if (isAllowedOrigin(req.headers.origin, config)) return next();
    res.status(403).json({ error: 'Origin not allowed', code: 'FORBIDDEN_ORIGIN' });
  });
  app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));

  app.use(express.json({ limit: config.jsonLimit }));

  // Health check — also used to keep a free-tier host awake. Exposes no secrets.
  app.get('/health', (req, res) => res.json({
    status: 'ok',
    ts: Date.now(),
    db: dbStatus(),
    storage: handoffStore.kind,
    llm: llm ? { configured: true, provider: llm.name, model: llm.model } : { configured: false, reason: llmUnavailableReason },
  }));

  // Friendly landing response for people opening the API in a browser.
  app.get('/', (req, res) => res.json({
    name: 'Context Memory Assistant API',
    status: 'running',
    message: 'This is the backend for the Chrome extension. Use the extension popup; there is no web page here.',
    health: '/health',
  }));

  const limiter = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, name: 'api' });
  const generateLimiter = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.generateMax, name: 'generate' });

  app.use('/generate', clientAuth, generateLimiter, generateRoutes({ llm, llmUnavailableReason, llmConfig: config.llm, logger }));
  app.use('/handoffs', clientAuth, limiter, handoffRoutes({ store: handoffStore }));
  if (memoryRoutes) app.use('/memory', clientAuth, limiter, memoryRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp, isAllowedOrigin };
