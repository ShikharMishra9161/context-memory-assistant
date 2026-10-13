const mongoose = require('mongoose');

// A saved context handoff. ownerId is sha256(client token); see middleware/clientAuth.js.
const HandoffSchema = new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
  clientId: { type: String, default: '' }, // extension-side id, makes sync retries idempotent
  title: { type: String, required: true },
  projectName: { type: String, default: '' },
  mode: { type: String, enum: ['quick', 'continue', 'full', 'custom'], default: 'continue' },
  platform: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  conversationId: { type: String, default: '' },
  markdown: { type: String, required: true },
  handoff: { type: mongoose.Schema.Types.Mixed, default: null }, // structured JSON
  messageCount: { type: Number, default: 0 },
  complete: { type: Boolean, default: false },
  warnings: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  version: { type: Number, default: 1 },
}, { timestamps: true, minimize: false });

HandoffSchema.index({ ownerId: 1, updatedAt: -1 });
HandoffSchema.index({ ownerId: 1, clientId: 1 });

module.exports = mongoose.model('Handoff', HandoffSchema);
