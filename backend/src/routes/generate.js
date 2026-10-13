const express = require('express');
const { asyncHandler } = require('../lib/http');
const { validateGenerate } = require('../validation/handoff');
const { generateHandoff } = require('../services/handoffGenerator');

/**
 * POST /generate — builds a handoff from extracted messages. The conversation
 * is processed in memory only: it is not stored and its content is not logged.
 */
function generateRoutes({ llm, llmUnavailableReason, llmConfig, logger }) {
  const router = express.Router();

  router.post('/', asyncHandler(async (req, res) => {
    const input = validateGenerate(req.body);
    const result = await generateHandoff(input, { llm, llmUnavailableReason, llmConfig, logger });
    res.json(result);
  }));

  return router;
}

module.exports = { generateRoutes };
