const router = require('express').Router();
const Memory = require('../models/Memory');
const { embed, rankByEmbedding } = require('../services/embedder');

// GET all OR search
// ?search=react typescript   → semantic search
// ?category=skill            → filter by category
router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    const filter = {};
    if (category) filter.category = category;

    const memories = await Memory.find(filter).sort({ updatedAt: -1 });

    if (search && search.trim()) {
      const queryEmbedding = await embed(search.trim());
      const ranked = rankByEmbedding(queryEmbedding, memories);
      // If some memories have no embedding yet, append them at end
      const noEmbed = memories.filter(m => !m.embedding?.length).map(m => m.toObject());
      return res.json([...ranked, ...noEmbed]);
    }

    res.json(memories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST create — auto-embed on save
router.post('/', async (req, res) => {
  try {
    const textToEmbed = `${req.body.title} ${req.body.content} ${(req.body.tags || []).join(' ')}`;
    const embedding = await embed(textToEmbed);
    const mem = await Memory.create({ ...req.body, embedding });
    res.status(201).json(mem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update — re-embed on edit
router.put('/:id', async (req, res) => {
  try {
    const textToEmbed = `${req.body.title} ${req.body.content} ${(req.body.tags || []).join(' ')}`;
    const embedding = await embed(textToEmbed);
    const mem = await Memory.findByIdAndUpdate(
      req.params.id,
      { ...req.body, embedding, updatedAt: Date.now() },
      { new: true }
    );
    res.json(mem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Memory.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /memory/search — dedicated semantic search endpoint
// Body: { query: string, topK?: number, category?: string }
router.post('/search', async (req, res) => {
  try {
    const { query, topK = 5, category } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const filter = {};
    if (category) filter.category = category;

    const memories = await Memory.find(filter);
    const queryEmbedding = await embed(query);
    const results = rankByEmbedding(queryEmbedding, memories, topK);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /memory/backfill — embed existing memories that have no embedding
router.post('/backfill', async (req, res) => {
  try {
    const memories = await Memory.find({ embedding: { $size: 0 } });
    let count = 0;
    for (const m of memories) {
      const text = `${m.title} ${m.content} ${m.tags.join(' ')}`;
      m.embedding = await embed(text);
      await m.save();
      count++;
    }
    res.json({ backfilled: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;