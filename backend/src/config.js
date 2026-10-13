// Central configuration from environment variables. Secrets are read here and
// never returned by any endpoint.

function int(name, fallback) {
  const v = Number.parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function list(name) {
  return (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
}

function detectProvider(env) {
  const explicit = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.GEMINI_API_KEY) return 'gemini';
  return 'none';
}

function loadConfig(env = process.env) {
  const provider = detectProvider(env);
  const keyByProvider = {
    gemini: env.GEMINI_API_KEY,
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  };
  return {
    port: int('PORT', 4000),
    mongoUri: env.MONGO_URI || '',
    storage: (env.STORAGE || 'mongo').toLowerCase(), // 'mongo' | 'memory' (non-persistent, dev/test only)
    jsonLimit: env.JSON_LIMIT || '5mb',
    allowedExtensionIds: list('ALLOWED_EXTENSION_IDS'),
    allowedOrigins: [env.DASHBOARD_URL, ...list('ALLOWED_ORIGINS')].filter(Boolean),
    allowLegacyMemoryClaim: env.ALLOW_LEGACY_MEMORY_CLAIM === 'true',
    rateLimit: {
      windowMs: int('RATE_LIMIT_WINDOW_MS', 60000),
      max: int('RATE_LIMIT_MAX', 120),
      generateMax: int('GENERATE_RATE_LIMIT_MAX', 10),
    },
    llm: {
      provider,
      apiKey: env.LLM_API_KEY || keyByProvider[provider] || '',
      model: env.LLM_MODEL || '',
      baseUrl: env.LLM_BASE_URL || '',
      timeoutMs: int('LLM_TIMEOUT_MS', 90000),
      maxInputChars: int('LLM_MAX_INPUT_CHARS', 120000),
      maxOutputTokens: int('LLM_MAX_OUTPUT_TOKENS', 8192),
      maxChunks: int('LLM_MAX_CHUNKS', 12),
      concurrency: int('LLM_CONCURRENCY', 2),
      retries: Number.isFinite(Number.parseInt(env.LLM_RETRIES, 10)) ? Number.parseInt(env.LLM_RETRIES, 10) : 2,
    },
  };
}

module.exports = { loadConfig };
