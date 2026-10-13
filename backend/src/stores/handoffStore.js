// Storage for saved handoffs. Every method takes ownerId first; there is no
// way to read or modify another owner's documents through this interface.
const crypto = require('crypto');

const SUMMARY_FIELDS = ['id', 'clientId', 'title', 'projectName', 'mode', 'platform', 'sourceUrl', 'messageCount', 'complete', 'tags', 'version', 'createdAt', 'updatedAt'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toSummary(doc) {
  const out = {};
  for (const f of SUMMARY_FIELDS) out[f] = doc[f];
  out.excerpt = (doc.markdown || '').replace(/[#*_`>|-]/g, '').replace(/\s+/g, ' ').slice(0, 200);
  return out;
}

function duplicateTitle(title) {
  return `${title} (copy)`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// MongoDB implementation
// ---------------------------------------------------------------------------

function createMongoHandoffStore(mongoose) {
  const Handoff = require('../models/Handoff');
  const valid = id => mongoose.isValidObjectId(id);
  const clean = doc => {
    if (!doc) return null;
    const o = doc.toObject ? doc.toObject() : doc;
    const { _id, __v, ownerId, ...rest } = o; // eslint-disable-line no-unused-vars
    return { id: String(_id), ...rest };
  };

  return {
    kind: 'mongo',
    isReady: () => mongoose.connection.readyState === 1,

    async list(ownerId, { q = '', project = '', limit = 50, offset = 0 } = {}) {
      const filter = { ownerId };
      if (project) filter.projectName = project;
      if (q) {
        const re = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ title: re }, { projectName: re }, { markdown: re }, { tags: re }];
      }
      const [items, total] = await Promise.all([
        Handoff.find(filter).sort({ updatedAt: -1 }).skip(offset).limit(limit).lean(),
        Handoff.countDocuments(filter),
      ]);
      return { items: items.map(clean).map(toSummary), total };
    },

    async get(ownerId, id) {
      if (!valid(id)) return null;
      return clean(await Handoff.findOne({ _id: id, ownerId }).lean());
    },

    async create(ownerId, data) {
      if (data.clientId) {
        const existing = await Handoff.findOne({ ownerId, clientId: data.clientId });
        if (existing) {
          Object.assign(existing, data, { version: existing.version + 1 });
          return { doc: clean(await existing.save()), created: false };
        }
      }
      return { doc: clean(await Handoff.create({ ...data, ownerId })), created: true };
    },

    async update(ownerId, id, patch) {
      if (!valid(id)) return null;
      const doc = await Handoff.findOneAndUpdate(
        { _id: id, ownerId },
        { $set: patch, $inc: { version: 1 } },
        { new: true, runValidators: true },
      ).lean();
      return clean(doc);
    },

    async duplicate(ownerId, id) {
      const src = await this.get(ownerId, id);
      if (!src) return null;
      const { id: _id, createdAt, updatedAt, version, clientId, ...rest } = src; // eslint-disable-line no-unused-vars
      return clean(await Handoff.create({ ...rest, ownerId, clientId: '', title: duplicateTitle(src.title) }));
    },

    async remove(ownerId, id) {
      if (!valid(id)) return false;
      const res = await Handoff.deleteOne({ _id: id, ownerId });
      return res.deletedCount === 1;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests and STORAGE=memory; not persistent)
// ---------------------------------------------------------------------------

function createMemoryHandoffStore() {
  const docs = new Map(); // id -> { ownerId, ...doc }
  const now = () => new Date().toISOString();
  const strip = d => {
    if (!d) return null;
    const { ownerId, ...rest } = d; // eslint-disable-line no-unused-vars
    return JSON.parse(JSON.stringify(rest));
  };
  const owned = (ownerId, id) => {
    const d = docs.get(id);
    return d && d.ownerId === ownerId ? d : null;
  };
  const defaults = { clientId: '', projectName: '', mode: 'continue', platform: '', sourceUrl: '', conversationId: '', handoff: null, messageCount: 0, complete: false, warnings: [], tags: [] };

  return {
    kind: 'memory',
    isReady: () => true,

    async list(ownerId, { q = '', project = '', limit = 50, offset = 0 } = {}) {
      const needle = q.toLowerCase();
      let items = [...docs.values()].filter(d => d.ownerId === ownerId);
      if (project) items = items.filter(d => d.projectName === project);
      if (needle) items = items.filter(d => [d.title, d.projectName, d.markdown, ...(d.tags || [])].some(v => String(v || '').toLowerCase().includes(needle)));
      items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return { items: items.slice(offset, offset + limit).map(strip).map(toSummary), total: items.length };
    },

    async get(ownerId, id) {
      return strip(owned(ownerId, id));
    },

    async create(ownerId, data) {
      if (data.clientId) {
        const existing = [...docs.values()].find(d => d.ownerId === ownerId && d.clientId === data.clientId);
        if (existing) {
          Object.assign(existing, data, { version: existing.version + 1, updatedAt: now() });
          return { doc: strip(existing), created: false };
        }
      }
      const id = crypto.randomBytes(12).toString('hex');
      const doc = { ...defaults, ...data, ownerId, id, version: 1, createdAt: now(), updatedAt: now() };
      docs.set(id, doc);
      return { doc: strip(doc), created: true };
    },

    async update(ownerId, id, patch) {
      const d = owned(ownerId, id);
      if (!d) return null;
      Object.assign(d, patch, { version: d.version + 1, updatedAt: now() });
      return strip(d);
    },

    async duplicate(ownerId, id) {
      const src = owned(ownerId, id);
      if (!src) return null;
      const { doc } = await this.create(ownerId, { ...strip(src), id: undefined, clientId: '', title: duplicateTitle(src.title) });
      return doc;
    },

    async remove(ownerId, id) {
      if (!owned(ownerId, id)) return false;
      docs.delete(id);
      return true;
    },
  };
}

module.exports = { createMongoHandoffStore, createMemoryHandoffStore, toSummary };
