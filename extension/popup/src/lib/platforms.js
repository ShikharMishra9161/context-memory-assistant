// Supported AI platforms as seen from the popup (URL-level knowledge only;
// DOM knowledge lives in extension/content/adapters/).

export const PLATFORMS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/',
    match: url => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url),
    adapter: 'content/adapters/chatgpt-adapter.js',
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    newChatUrl: 'https://claude.ai/new',
    match: url => /^https:\/\/claude\.ai\//.test(url),
    adapter: 'content/adapters/claude-adapter.js',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    newChatUrl: 'https://gemini.google.com/app',
    match: url => /^https:\/\/gemini\.google\.com\//.test(url),
    adapter: 'content/adapters/gemini-adapter.js',
  },
};

export function detectPlatform(url) {
  return Object.values(PLATFORMS).find(p => p.match(url || '')) || null;
}
