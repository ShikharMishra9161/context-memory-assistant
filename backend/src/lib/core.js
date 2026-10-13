// Loads the handoff core (ES modules) from CommonJS. The backend uses its own
// vendored copy in src/vendor/handoff-core so it can be deployed without the
// rest of the repository. The source of truth is shared/handoff-core; run
// `npm run sync-core` from the repo root after changing it (npm test fails if
// the copies drift apart).
const path = require('path');
const { pathToFileURL } = require('url');

const CORE_PATH = path.resolve(__dirname, '../vendor/handoff-core/index.js');
let corePromise;

function loadCore() {
  corePromise = corePromise || import(pathToFileURL(CORE_PATH).href);
  return corePromise;
}

module.exports = { loadCore };
