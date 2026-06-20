const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
  userId: { type: String, default: 'local' },
  category: { type: String, enum: ['project', 'skill', 'goal', 'note'], required: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  tags: [String],
  embedding: { type: [Number], default: [] },  // 768-dim Gemini vector
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Text index for fallback keyword search
MemorySchema.index({ title: 'text', content: 'text', tags: 'text' });

module.exports = mongoose.model('Memory', MemorySchema);