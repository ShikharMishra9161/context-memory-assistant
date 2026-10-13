const express = require('express');
const { asyncHandler, HttpError } = require('../lib/http');
const { validateHandoffInput } = require('../validation/handoff');

function slug(s) {
  return String(s || 'handoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'handoff';
}

function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** CRUD for saved handoffs. All routes are scoped to req.ownerId. */
function handoffRoutes({ store }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!store.isReady()) {
      return res.status(503).json({ error: 'The database is unavailable. Handoffs are kept in the extension until it is back.', code: 'DB_UNAVAILABLE' });
    }
    next();
  });

  const notFound = () => new HttpError(404, 'Handoff not found', 'NOT_FOUND');

  router.get('/', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const project = typeof req.query.project === 'string' ? req.query.project.slice(0, 200) : '';
    const result = await store.list(req.ownerId, {
      q, project,
      limit: clampInt(req.query.limit, 50, 1, 200),
      offset: clampInt(req.query.offset, 0, 0, 100000),
    });
    res.json(result);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const doc = await store.get(req.ownerId, req.params.id);
    if (!doc) throw notFound();
    res.json(doc);
  }));

  router.get('/:id/markdown', asyncHandler(async (req, res) => {
    const doc = await store.get(req.ownerId, req.params.id);
    if (!doc) throw notFound();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug(doc.projectName || doc.title)}-handoff.md"`);
    res.send(doc.markdown);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const data = validateHandoffInput(req.body);
    const { doc, created } = await store.create(req.ownerId, data);
    res.status(created ? 201 : 200).json(doc);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const patch = validateHandoffInput(req.body, { partial: true });
    delete patch.clientId; // identity of a document cannot change
    const doc = await store.update(req.ownerId, req.params.id, patch);
    if (!doc) throw notFound();
    res.json(doc);
  }));

  router.post('/:id/duplicate', asyncHandler(async (req, res) => {
    const doc = await store.duplicate(req.ownerId, req.params.id);
    if (!doc) throw notFound();
    res.status(201).json(doc);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const ok = await store.remove(req.ownerId, req.params.id);
    if (!ok) throw notFound();
    res.json({ success: true });
  }));

  return router;
}

module.exports = { handoffRoutes };
