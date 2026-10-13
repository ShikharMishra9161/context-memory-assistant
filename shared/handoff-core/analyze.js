// Deterministic (no-LLM) analysis of a normalized conversation.
// Everything here is either copied verbatim from messages or found by keyword
// heuristics; heuristic findings are marked 'assumption' so nobody mistakes them for facts.

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'ps', 'cmd', 'bat', 'console', 'terminal']);
const COMMAND_START = /^\s*(?:\$|>|PS [^>]*>)?\s*((?:npm|npx|pnpm|yarn|node|git|pip3?|python3?|docker(?:-compose)?|kubectl|curl|wget|cd|mkdir|cargo|go|mvn|gradle|dotnet|make|brew|apt(?:-get)?|choco|mongod|mongosh|nodemon|vite|uvicorn|flask|django-admin|rails|bundle|composer|php|java|tsc|deno|bun)\b[^\n]*)$/;
// Case-sensitive: identifiers like TypeError, ENOENT, npm ERR!, Traceback.
const ERROR_CODE = /(\b[A-Z][A-Za-z]*(?:Error|Exception)\b|\bTraceback\b|\bERR!|\bE[A-Z]{3,}\b|\bHTTP\/?\d?\.?\d? [45]\d\d\b|\b[45]\d\d (?:Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error)\b)/;
// Case-insensitive wording that usually signals a failure in user-pasted output.
const ERROR_WORDS = /\b(failed|fatal|unhandled|is not defined|cannot find module|could not (?:resolve|find|connect|load)|status code [45]\d\d|segmentation fault|undefined is not)\b/i;

export function isErrorLike(line) {
  return ERROR_CODE.test(line) || ERROR_WORDS.test(line);
}
const FILE_PATH = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w.@-]*\.(?:jsx?|tsx?|mjs|cjs|json|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|css|scss|html|vue|svelte|md|ya?ml|toml|env(?:\.\w+)?|sh|ps1|sql|prisma|graphql|xml|gradle|lock|txt|ini|cfg|conf|dockerfile))(?=$|[\s`'"),:;\]])/gim;
const DOTFILE = /(?:^|[\s`'"(])((?:[\w-]+\/)*\.(?:env(?:\.\w+)?|gitignore|eslintrc(?:\.\w+)?|prettierrc|babelrc|npmrc|nvmrc|dockerignore))(?=$|[\s`'"),:;])/gim;
const URL_RE = /\bhttps?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g;

const TECH = [
  'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Vite', 'Webpack', 'Tailwind', 'TypeScript', 'JavaScript',
  'Node.js', 'Express', 'NestJS', 'Fastify', 'Deno', 'Bun', 'Python', 'Django', 'Flask', 'FastAPI', 'Ruby on Rails',
  'Go', 'Rust', 'Java', 'Spring', 'Kotlin', 'Swift', 'C#', '.NET', 'PHP', 'Laravel',
  'MongoDB', 'Mongoose', 'PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'Prisma', 'Supabase', 'Firebase', 'DynamoDB',
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Vercel', 'Netlify', 'Render', 'Heroku',
  'Chrome Extension', 'Manifest V3', 'GraphQL', 'REST', 'WebSocket', 'JWT', 'OAuth',
  'OpenAI', 'Gemini', 'Claude', 'Anthropic', 'LangChain', 'Jest', 'Vitest', 'Playwright', 'Cypress', 'ESLint',
];

const DECISION_RE = /\b(decided|we(?:'ll| will) use|let'?s (?:use|go with|stick with|keep)|going with|chose|chosen|switch(?:ed)? to|settled on|the plan is|we should use|i(?:'ll| will) use)\b/i;
const REJECT_RE = /\b(instead of|rather than|didn'?t work|doesn'?t work|not working|won'?t work|gave up on|abandon(?:ed)?|reject(?:ed)?|ruled out|no longer use|stop using|revert(?:ed)?)\b/i;
const CONSTRAINT_RE = /\b(must(?: not)?|never|always|do not|don'?t|cannot|can'?t|required?|mandatory|only use|no (?:new )?dependenc(?:y|ies))\b/i;
const PREFERENCE_RE = /\b(prefer|i(?:'d| would) like|i want|should|keep it|make sure|please)\b/i;
const SECURITY_RE = /\b(api[ _-]?keys?|secrets?|tokens?|auth(?:entication|orization)?|password|cors|xss|csrf|injection|encrypt|https|permissions?|rate[ -]?limit|sanitiz|\.env)\b/i;
const DONE_RE = /(✅|\b(is now working|now works|works now|fixed|done|completed|implemented|finished|resolved|that worked|it worked|working now)\b)/i;
const TODO_RE = /\b(todo|not (?:yet )?implemented|still need(?:s)? to|remaining|next step|left to do|pending|haven'?t (?:yet )?)\b/i;
const NEXT_RE = /\b(next step|next,|next we|next you|then (?:we|you)|after that|now (?:we|you) (?:can|need|should))\b/i;
const TEST_RE = /\b(npm (?:run )?test|pytest|jest|vitest|unit tests?|e2e|integration tests?|test (?:it|this|that)|verify|run the tests?)\b/i;

function proseOf(text) {
  // Prose without fenced code — sentence heuristics should not read code.
  return text.replace(/```[\s\S]*?```/g, ' ');
}

export function sentencesOf(text) {
  return proseOf(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])|\n+/)
    .map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(s => s.length >= 8 && s.length <= 600);
}

function uniquePush(map, key, value) {
  const k = key.toLowerCase();
  if (!map.has(k)) map.set(k, value);
}

function collect(messages, predicate, { roles, status, limit = 30 } = {}) {
  const found = new Map();
  for (const m of messages) {
    if (roles && !roles.includes(m.role)) continue;
    for (const s of sentencesOf(m.text)) {
      if (predicate(s, m)) {
        const existing = found.get(s.toLowerCase());
        if (existing) existing.refs.push(m.index);
        else found.set(s.toLowerCase(), { text: s, status: status ?? 'assumption', refs: [m.index] });
      }
    }
  }
  return [...found.values()].slice(-limit);
}

export function findFilePaths(text) {
  const out = new Set();
  for (const re of [FILE_PATH, DOTFILE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const p = m[1].replace(/^\.\//, '');
      // Skip version numbers ("v1.2.3"), domains and plain decimals.
      if (/^\d+(\.\d+)+$/.test(p) || /^(www\.|[\w-]+\.(com|org|io|ai|net|dev))$/i.test(p)) continue;
      out.add(m[1]);
    }
  }
  return [...out];
}

export function findCommands(message) {
  const cmds = [];
  for (const b of message.codeBlocks || []) {
    const lang = b.language.toLowerCase();
    const lines = b.code.split('\n').map(l => l.trim()).filter(Boolean);
    if (SHELL_LANGS.has(lang)) {
      for (const l of lines) if (!l.startsWith('#')) cmds.push(l.replace(/^\$\s+/, ''));
    } else if (!lang || lang === 'text' || lang === 'plaintext') {
      for (const l of lines) { const m = l.match(COMMAND_START); if (m) cmds.push(m[1].trim()); }
    }
  }
  // Inline `npm run dev` style commands in prose.
  const inline = message.text.replace(/```[\s\S]*?```/g, '').match(/`([^`\n]{3,200})`/g) || [];
  for (const raw of inline) {
    const m = raw.slice(1, -1).match(COMMAND_START);
    if (m) cmds.push(m[1].trim());
  }
  return cmds;
}

export function findErrors(message) {
  const errs = [];
  const lines = message.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('```') || line.length > 500) continue;
    // Assistant prose that merely talks about errors ("add error handling") is not an error.
    if (message.role === 'assistant' ? !ERROR_CODE.test(line) : !isErrorLike(line)) continue;
    // "I get this error:" style lead-ins are not the error itself.
    if (/:\s*$/.test(line) && !ERROR_CODE.test(line)) continue;
    // Keep a following stack-trace line or two for context.
    let block = line;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (/^\s*(at |File "|\^|\s{2,}\S)/.test(lines[j])) block += '\n' + lines[j].trimEnd();
      else break;
    }
    errs.push(block);
  }
  return errs;
}

function findDependencies(messages) {
  const deps = new Map();
  for (const m of messages) {
    const all = m.text;
    for (const match of all.matchAll(/\b(?:npm (?:install|i|add)|yarn add|pnpm add|pip3? install|cargo add|go get)\s+((?:-{1,2}[\w-]+\s+)*)([^\n`;&|]+)/g)) {
      for (const pkg of match[2].split(/\s+/)) {
        if (pkg && !pkg.startsWith('-') && /^[@\w][\w@/.\-^~=<>]*$/.test(pkg)) uniquePush(deps, pkg, { text: pkg, status: 'assumption', refs: [m.index] });
      }
    }
    for (const match of all.matchAll(/\brequire\(\s*['"]([^'"./][^'"]*)['"]\s*\)|\bimport\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"./][^'"]*)['"]/g)) {
      const pkg = match[1] || match[2];
      if (pkg && !pkg.startsWith('node:')) uniquePush(deps, pkg, { text: pkg, status: 'assumption', refs: [m.index] });
    }
  }
  return [...deps.values()];
}

function detectStack(messages) {
  const corpus = messages.map(m => m.text).join('\n');
  const found = [];
  for (const t of TECH) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w])${esc}(?![\\w])`, t.length <= 3 ? 'g' : 'gi');
    const hits = corpus.match(re)?.length || 0;
    if (hits > 0) found.push({ t, hits });
  }
  return found.sort((a, b) => b.hits - a.hits).slice(0, 15)
    .map(({ t, hits }) => ({ text: `${t} (mentioned ${hits}×)`, status: 'assumption', refs: [] }));
}

function firstParagraph(text, max = 600) {
  const prose = text.replace(/```[\s\S]*?```/g, '[code]').trim();
  const para = prose.split(/\n\s*\n/)[0] || prose;
  return para.length > max ? para.slice(0, max).trimEnd() + '…' : para;
}

function lastParagraph(text, max = 600) {
  const prose = text.replace(/```[\s\S]*?```/g, '[code]').trim();
  const paras = prose.split(/\n\s*\n/).filter(p => p.trim() && p.trim() !== '[code]');
  const para = paras[paras.length - 1] || prose;
  return para.length > max ? '…' + para.slice(-max).trimStart() : para;
}

function questionsIn(text) {
  return sentencesOf(text).filter(s => s.endsWith('?'));
}

/**
 * Runs all deterministic extractors. Returns raw findings used to build the handoff.
 */
export function analyzeConversation(messages) {
  const codeBlocks = [];
  const commands = new Map();
  const filePaths = new Map();
  const errors = new Map();
  const urls = new Map();

  for (const m of messages) {
    for (const b of m.codeBlocks || []) codeBlocks.push({ ...b, ref: m.index, role: m.role });
    for (const c of findCommands(m)) uniquePush(commands, c, c);
    for (const p of findFilePaths(m.text)) uniquePush(filePaths, p, p);
    for (const e of findErrors(m)) uniquePush(errors, e, e);
    for (const u of m.text.match(URL_RE) || []) uniquePush(urls, u, u);
  }

  const users = messages.filter(m => m.role === 'user');
  const assistants = messages.filter(m => m.role === 'assistant');
  const lastUser = users[users.length - 1];
  const lastAssistant = assistants[assistants.length - 1];
  const last = messages[messages.length - 1];
  const tail = messages.slice(-6);

  return {
    codeBlocks,
    commands: [...commands.values()],
    filePaths: [...filePaths.values()],
    errors: [...errors.values()],
    urls: [...urls.values()],
    stack: detectStack(messages),
    dependencies: findDependencies(messages),
    // User statements are what the user actually said — 'confirmed' as quotes.
    constraints: collect(messages, s => CONSTRAINT_RE.test(s) && !isErrorLike(s), { roles: ['user'], status: 'confirmed' }),
    preferences: collect(messages, s => PREFERENCE_RE.test(s) && !CONSTRAINT_RE.test(s) && !isErrorLike(s), { roles: ['user'], status: 'confirmed' }),
    decisions: collect(messages, s => DECISION_RE.test(s)),
    rejected: collect(messages, s => REJECT_RE.test(s)),
    security: collect(messages, s => SECURITY_RE.test(s), { limit: 15 }),
    completed: collect(messages, s => DONE_RE.test(s), { limit: 20 }),
    todo: collect(messages, s => TODO_RE.test(s), { limit: 20 }),
    nextHints: collect(tail, s => NEXT_RE.test(s), { roles: ['assistant'], limit: 10 }),
    testHints: collect(messages, s => TEST_RE.test(s), { limit: 15 }),
    tailErrors: tail.flatMap(m => findErrors(m).map(e => ({ text: e, status: 'confirmed', refs: [m.index] }))),
    tailAttempts: tail
      .filter(m => m.role === 'assistant' && (m.codeBlocks.length || findCommands(m).length))
      .map(m => ({ text: firstParagraph(m.text, 300), status: 'assumption', refs: [m.index] })),
    firstUser: users[0],
    lastUser,
    lastAssistant,
    last,
    openQuestions: [
      ...(lastAssistant && last === lastAssistant ? questionsIn(lastAssistant.text).slice(-5).map(q => ({ text: q, status: 'confirmed', refs: [lastAssistant.index] })) : []),
      ...(lastUser && last === lastUser ? questionsIn(lastUser.text).map(q => ({ text: q, status: 'confirmed', refs: [lastUser.index] })) : []),
    ],
    helpers: { firstParagraph, lastParagraph },
  };
}
