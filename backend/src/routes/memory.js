const router = require('express').Router();
const mongoose = require('mongoose');
const Memory = require('../models/Memory');
const { embed, rankByEmbedding, rankByKeywords } = require('../services/embedder');
const { asyncHandler, HttpError } = require('../lib/http');
const { validateMemoryInput } = require('../validation/handoff');

// All routes are scoped to req.ownerId (see middleware/clientAuth.js).

router.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'The database is unavailable.', code: 'DB_UNAVAILABLE' });
  }
  next();
});

function embedText(m) {
  return `${m.title} ${m.content} ${(m.tags || []).join(' ')}`;
}

async function rank(query, memories, topK) {
  const queryEmbedding = await embed(query);
  if (queryEmbedding.length) {
    const ranked = rankByEmbedding(queryEmbedding, memories, topK);
    if (ranked.length) return ranked;
  }
  return rankByKeywords(query, memories, topK);
}

const notFound = () => new HttpError(404, 'Memory not found', 'NOT_FOUND');
const checkId = id => { if (!mongoose.isValidObjectId(id)) throw notFound(); };

// GET all OR search
// ?search=react typescript   → semantic search (keyword fallback)
// ?category=skill            → filter by category
router.get('/', asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const filter = { userId: req.ownerId };
  if (typeof category === 'string' && category) filter.category = category;

  const memories = await Memory.find(filter).sort({ updatedAt: -1 });

  if (typeof search === 'string' && search.trim()) {
    const ranked = await rank(search.trim().slice(0, 500), memories, memories.length);
    const rankedIds = new Set(ranked.map(m => String(m._id)));
    // Memories that did not match are appended so nothing disappears from the list
    const rest = memories.filter(m => !rankedIds.has(String(m._id))).map(m => m.toObject());
    return res.json([...ranked, ...rest]);
  }

  res.json(memories);
}));

// POST create — auto-embed on save
router.post('/', asyncHandler(async (req, res) => {
  const data = validateMemoryInput(req.body);
  const embedding = await embed(embedText(data));
  const mem = await Memory.create({ ...data, userId: req.ownerId, embedding });
  res.status(201).json(mem);
}));

// PUT update — re-embed on edit
router.put('/:id', asyncHandler(async (req, res) => {
  checkId(req.params.id);
  const patch = validateMemoryInput(req.body, { partial: true });
  const existing = await Memory.findOne({ _id: req.params.id, userId: req.ownerId });
  if (!existing) throw notFound();
  Object.assign(existing, patch, { updatedAt: Date.now() });
  existing.embedding = await embed(embedText(existing));
  await existing.save();
  res.json(existing);
}));

// DELETE
router.delete('/:id', asyncHandler(async (req, res) => {
  checkId(req.params.id);
  const result = await Memory.deleteOne({ _id: req.params.id, userId: req.ownerId });
  if (!result.deletedCount) throw notFound();
  res.json({ success: true });
}));

// POST /memory/search — dedicated semantic search endpoint
// Body: { query: string, topK?: number, category?: string }
router.post('/search', asyncHandler(async (req, res) => {
  const { query, topK = 5, category } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) throw new HttpError(400, 'query required', 'VALIDATION');

  const filter = { userId: req.ownerId };
  if (typeof category === 'string' && category) filter.category = category;

  const memories = await Memory.find(filter);
  const k = Math.min(50, Math.max(1, Number.parseInt(topK, 10) || 5));
  res.json(await rank(query.trim().slice(0, 500), memories, k));
}));

// POST /memory/backfill — embed this owner's memories that have no embedding
router.post('/backfill', asyncHandler(async (req, res) => {
  const memories = await Memory.find({ userId: req.ownerId, embedding: { $size: 0 } });
  let count = 0;
  for (const m of memories) {
    m.embedding = await embed(embedText(m));
    if (m.embedding.length) { await m.save(); count++; }
  }
  res.json({ backfilled: count });
}));

// POST /memory/claim-legacy — memories created before per-install tokens were
// stored with userId "local". When ALLOW_LEGACY_MEMORY_CLAIM=true, the caller
// can take ownership of them once. Disabled by default.
router.post('/claim-legacy', asyncHandler(async (req, res) => {
  if (!req.app.locals.config?.allowLegacyMemoryClaim) {
    throw new HttpError(403, 'Legacy memory claim is disabled. Set ALLOW_LEGACY_MEMORY_CLAIM=true to enable it temporarily.', 'FORBIDDEN');
  }
  const result = await Memory.updateMany({ userId: 'local' }, { $set: { userId: req.ownerId } });
  res.json({ claimed: result.modifiedCount });
}));

module.exports = router;
