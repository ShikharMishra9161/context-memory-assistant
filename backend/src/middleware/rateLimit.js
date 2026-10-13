// Fixed-window in-memory rate limiter (single process). Keyed by owner when
// authenticated, otherwise by IP.

function rateLimit({ windowMs, max, name = 'default' }) {
  const hits = new Map();
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      lastSweep = now;
    }
    const key = `${name}:${req.ownerId || req.ip}`;
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many requests. Try again in ${retry}s.`, code: 'RATE_LIMITED' });
    }
    next();
  };
}

module.exports = { rateLimit };
