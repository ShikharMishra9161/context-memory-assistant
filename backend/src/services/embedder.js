const { GoogleGenerativeAI } = require('@google/generative-ai');

// Embeddings are optional: without GEMINI_API_KEY, memories are still saved and
// search falls back to keyword matching.
let model = null;
function getModel() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!model) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // text-embedding-004 was retired Jan 2026; gemini-embedding-001 is the replacement
    model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  }
  return model;
}

function isEmbeddingAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Generate 768-dim embedding for a string. Returns [] when embeddings are
 * unavailable or the request fails, so callers never lose a save.
 */
async function embed(text) {
  const m = getModel();
  if (!m) return [];
  try {
    const result = await m.embedContent({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: 768,
    });
    return result.embedding.values;
  } catch (err) {
    console.warn('[embedder] embedding failed:', String(err.message).slice(0, 200));
    return [];
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank memories by similarity to query
 * Returns top-k sorted by score desc
 */
function rankByEmbedding(queryEmbedding, memories, topK = 5) {
  return memories
    .filter(m => m.embedding?.length > 0)
    .map(m => ({
      ...m.toObject(),
      score: cosineSimilarity(queryEmbedding, m.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Keyword fallback: score by how many query words appear in title/content/tags.
 */
function rankByKeywords(query, memories, topK = 5) {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return memories
    .map(m => {
      const hay = `${m.title} ${m.content} ${(m.tags || []).join(' ')}`.toLowerCase();
      return { ...m.toObject(), score: words.filter(w => hay.includes(w)).length };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { embed, cosineSimilarity, rankByEmbedding, rankByKeywords, isEmbeddingAvailable };
