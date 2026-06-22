const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// text-embedding-004 was retired Jan 2026; gemini-embedding-001 is the replacement
const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

/**
 * Generate 768-dim embedding for a string
 */
async function embed(text) {
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
    outputDimensionality: 768,
  });
  return result.embedding.values;
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

module.exports = { embed, cosineSimilarity, rankByEmbedding };