// Per-installation authentication. The extension generates a random 256-bit
// token once and sends it as "Authorization: Bearer <64 hex chars>". The
// backend stores only sha256(token) as the owner id, so every query is scoped
// to the installation that created the data, and a database leak does not
// reveal usable tokens.
const crypto = require('crypto');

const TOKEN_RE = /^[a-f0-9]{64}$/i;

function ownerIdFromToken(token) {
  return crypto.createHash('sha256').update(token.toLowerCase()).digest('hex');
}

function clientAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(\S+)$/);
  if (!match || !TOKEN_RE.test(match[1])) {
    return res.status(401).json({ error: 'Missing or invalid access token. Reload the extension and try again.', code: 'UNAUTHORIZED' });
  }
  req.ownerId = ownerIdFromToken(match[1]);
  next();
}

module.exports = { clientAuth, ownerIdFromToken };
