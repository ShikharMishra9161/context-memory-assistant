<p align="center"><img src="extension/icons/icon-128.png" width="96" alt="Context Memory Assistant icon"></p>

# Context Memory Assistant

A Chrome extension that moves a long **ChatGPT, Claude or Gemini** conversation into a **new chat without losing your project context**.

Hit the message limit, or is the chat getting slow and confused? One click extracts the conversation and turns it into a structured handoff: what the project is, what's done, what was decided, the exact task you were on, the next step, and all the code, commands and errors. Paste it into a fresh chat (on the same AI or a different one) and carry on where you stopped.

- **Works with no setup.** No account, no server, no API key needed.
- **Private by default.** Nothing leaves your browser unless you choose an AI provider.
- **Honest.** It tells you when messages may be missing and never calls a partial extraction complete.

---

## Contents

- [For users](#for-users): install, how to use, AI summaries, privacy, FAQ
- [For developers](#for-developers): setup, architecture, backend, testing, publishing

---

# For users

## Install

**From source (until it is on the Chrome Web Store):**

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. In this folder, run:
   ```bash
   npm install --prefix extension/popup
   npm run build
   ```
3. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and select the **`extension`** folder.
4. Click the puzzle-piece icon in Chrome's toolbar and **pin** Context Memory Assistant.

Requires Chrome 116 or newer.

## How to use

1. Open an existing conversation on **ChatGPT**, **Claude** or **Gemini**.
2. Click the **Context Memory Assistant icon**. A side panel opens next to the page.
3. Choose a mode, optionally type a project name, and click **Extract Context**.
   The extension scrolls up to load earlier messages, then reads them all.
4. Check the result:
   - **No gaps detected** (green) or **Partial / may be incomplete** (amber), with the reasons
   - **Preview** shows the handoff, **Edit** lets you change it, and **Source messages** shows exactly what was extracted
5. Click **Save Context & Continue**. The handoff is saved and copied to your clipboard.
6. Click **New ChatGPT / Claude / Gemini chat**. The side panel stays open.
7. In the new chat, paste with **Ctrl+V** (or click **Insert into this tab's chat box**), check it, and press **Send** yourself. The extension never sends messages for you.

### Modes

| Mode | Use it when |
| --- | --- |
| **Quick Summary** | An ordinary conversation; you just need the gist. |
| **Continue Project** | Ongoing software work (default): detailed technical state, files, decisions, recent code. |
| **Full Handoff** | You can't afford to lose anything: every code block and a full transcript appendix. |
| **Custom Handoff** | You write what the next AI must remember, in addition to the normal content. |

Very long handoffs are split into numbered **parts** with a master index. Paste them in order.

### Saved handoffs

The **Saved** tab lets you search, open, edit, rename, duplicate, delete, copy and export (Markdown) your handoffs. To continue a project after another work session, open its handoff and click **Update from current chat**. The next extraction is then saved into that handoff.

### If extraction fails

You get a clear message instead of a wrong handoff:
- **"No conversation is open"**: open an existing chat, not a new empty one.
- **"Could not talk to the page"**: reload the AI tab and try again.
- **"Layout not recognized"**: the site changed its design. Use **paste the conversation manually** (select all in the chat, copy, paste into the side panel), and please [report it](https://github.com/ShikharMishra9161/context-memory-assistant/issues).

## Smarter handoffs with AI (optional)

Without AI, the built-in generator copies code, errors, commands and your requirements word-for-word, and uses keyword matching for the rest. With AI, the handoff is properly summarized and organized.

**Settings → AI handoffs → Your own API key (recommended):**

1. Get a key from one of these providers:
   - **Google Gemini:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (has a free tier)
   - **OpenAI:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - **Anthropic Claude:** [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Choose the provider, paste the key, and click **Test key**.
3. Extract as usual. Chrome may ask once to allow access to the provider's site.

Your key is stored only in your browser, and the conversation goes **directly from your browser to that provider**. If the AI call fails (bad key, quota, outage), you still get the built-in handoff with a note saying why.

The third option, **Your own backend server**, is for developers running the included backend (see below).

## Privacy

- Conversations are read **only when you click Extract Context**, and only on ChatGPT, Claude and Gemini.
- Everything (drafts, saved handoffs, settings, your API key) is stored **locally** in your browser.
- Data leaves your browser only if you pick an AI provider (sent to that provider under your account) or connect your own server. Both are off by default and ask for confirmation.
- No analytics, no tracking, and nothing is sent to the developer.

Full policy: [PRIVACY.md](PRIVACY.md).

## FAQ

**Is the whole conversation always captured?** Everything the site displays is captured, and the extension scrolls up to load older messages. Images, uploaded files and canvases are not captured (it tells you when that happens). If anything may be missing, the handoff itself says **PARTIAL EXTRACTION**, so the next AI knows too.

**Can I move from ChatGPT to Claude (or any combination)?** Yes. The handoff is plain Markdown that works in any AI chat.

**What is the "Inject Context" button?** An older feature that inserts saved "memories" into the chat box. It is off by default and needs your own backend. Turn it on under **Settings → Memories (advanced)**.

---

# For developers

## Repository layout

```
extension/                    Chrome extension (Manifest V3)
  manifest.json
  background/service-worker.js   opens the side panel; backend sync only when configured
  lib/settings.js             settings, API-key config, permissions, backend client
  content/
    extract-core.js           platform-agnostic extraction: DOM→Markdown, history loading, gap signals
    adapters/                 chatgpt-, claude-, gemini-adapter.js (site DOM knowledge only)
    extract-listener.js       side panel ⇄ page messaging
    injector-utils.js, *-injector.js   optional "Inject Context" button
  popup/                      React 19 + Vite + Tailwind UI (side panel), builds to extension/dist-popup
  icons/                      generated by scripts/make-icons.mjs
shared/handoff-core/          dependency-free ES modules, the single source of truth for:
                              normalization, completeness checks, deterministic generator,
                              Markdown + part splitting, chunking/merging, prompts,
                              LLM providers (llm.js) and the generation pipeline (pipeline.js)
backend/                      optional Express 4 + Mongoose 7 server
  src/app.js                  CORS, auth, rate limits, routes, errors
  src/routes/                 generate.js, handoffs.js, memory.js
  src/vendor/handoff-core/    generated copy of shared/handoff-core (npm run sync-core)
dashboard/                    small CRA dashboard for synced data
scripts/                      sync-core, make-icons, zip-dir (packaging)
tests/                        core, jsdom extraction, side panel ↔ backend integration, manifest
docs/CHROME_WEB_STORE.md      listing text, permission justifications, submission checklist
PRIVACY.md                    privacy policy
```

**Data flow:** side panel → `chrome.tabs.sendMessage` → content script (`CMAExtract.run`) → raw messages and gap signals → `prepareExtraction` (normalize, dedupe, assess) → generator chosen by `settings.aiMode`:
- `off`: `generateDeterministic` (in the browser)
- `byok`: `generateWithLlm` with the user's key, calling the provider directly from the browser
- `backend`: `POST /generate` on your server (same `generateWithLlm` there)

→ preview/edit → `chrome.storage.local` (plus `POST /handoffs` if sync is on) → clipboard → new chat.

## Development setup

```bash
npm install                            # root: test tooling (jsdom)
npm install --prefix extension/popup
npm install --prefix backend           # only if you use the backend
npm run build                          # builds the side panel UI into extension/dist-popup
```

Load the `extension/` folder unpacked (see [Install](#install)). After changes, run `npm run build` and click **Reload** on the extension card. Open AI tabs reload automatically after an update.

### npm scripts (repo root)

| Script | What it does |
| --- | --- |
| `npm test` | All tests: shared core, jsdom extraction, side panel ↔ backend integration, manifest, then backend tests |
| `npm run lint` | ESLint for the side panel UI |
| `npm run build` | Production build of the side panel UI |
| `npm run package` | Build + assemble `extension/dist` + `context-memory-assistant.zip` for the Web Store |
| `npm run sync-core` | Copy `shared/handoff-core` into the backend after editing it (`npm test` fails if out of date) |
| `npm run icons` | Regenerate the PNG icons |

## The optional backend

You only need the backend for **Your own backend server** AI mode, **sync** of saved handoffs to MongoDB, or the legacy **memories** feature.

```bash
cp backend/.env.example backend/.env    # then edit; never commit .env
npm run dev --prefix backend            # http://localhost:4000 (GET /health shows status)
```

In the side panel: **Settings → AI handoffs → Your own backend server** (or enable sync), then click **Test**. Chrome asks once for access to the server address.

Key environment variables (full list in [backend/.env.example](backend/.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Must match the backend URL in Settings |
| `MONGO_URI` | none | MongoDB (local or Atlas). Without it, storage routes return 503 and the extension stays local-only |
| `STORAGE` | `mongo` | `memory` = non-persistent store for quick tests |
| `LLM_PROVIDER` | auto | `gemini`, `openai`, `anthropic` or `none`. If unset, the first provider with a key is used |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | none | Provider keys (Gemini is also used for memory embeddings) |
| `LLM_MODEL`, `LLM_BASE_URL` | provider default | Model override and OpenAI-compatible server URL |
| `LLM_MAX_INPUT_CHARS` / `LLM_MAX_CHUNKS` / `LLM_RETRIES` | `120000` / `12` / `2` | Chunk budget, chunk limit before deterministic fallback, retries for transient errors |
| `ALLOWED_EXTENSION_IDS` | empty (any) | Pin CORS to your extension ID in production |
| `JSON_LIMIT` | `5mb` | Request size limit |
| `RATE_LIMIT_MAX` / `GENERATE_RATE_LIMIT_MAX` | `120` / `10` per minute | Per-token rate limits |
| `ALLOW_LEGACY_MEMORY_CLAIM` | `false` | See "Migrating old memories" below |

**API:** `GET /health` · `POST /generate` · `GET|POST /handoffs` · `GET|PUT|DELETE /handoffs/:id` · `POST /handoffs/:id/duplicate` · `GET /handoffs/:id/markdown` · `/memory` (legacy).

**Security model:**
- Each install generates a random 256-bit token. The server stores only `sha256(token)` and scopes every query to it.
- Provider keys live only in `backend/.env`.
- Logs contain method, path, status and time only; no bodies, query strings or conversation content. `/generate` never stores conversations.
- Requests are validated with size limits (413), per-token rate limiting (429) and Origin checks (403).

> Do not run a public backend with **your** provider key for other people. The per-install tokens are not user accounts, so anyone could spend your quota. Public users should use **Your own API key** instead.

**Deploying (e.g. Render):** `backend/` is self-contained (it ships its own copy of the core), so you can deploy it with root directory `backend`, build `npm ci`, and start `npm start`. Use HTTPS.

**Migrating old memories:** memories saved before per-install tokens are hidden. Set `ALLOW_LEGACY_MEMORY_CLAIM=true`, restart, click **Memories → Recover older memories** in the side panel, then set the flag back to `false`.

## Testing

```bash
npm test
```

The automated tests cover:
- parsing, message order and duplicate removal
- preservation of code blocks and error messages
- partial-extraction detection, and empty and very long conversations
- chunking and part splitting
- LLM success, malformed output, retries and fallback for every mode, including your-own-key calls
- the backend: CRUD, search, idempotent sync, owner isolation, validation, 413/429/503 and CORS
- the content-script adapters against platform-like pages, including lazy-loaded Gemini history
- the side panel's storage and sync logic against the real backend app
- manifest and permission checks

### Manual checklist (real sites)

Real sites change their HTML, so test these by hand before each release:

- [ ] **ChatGPT:** long conversation with code. The count matches the visible turns, code languages are right, there are no "Copy code" lines, and it shows "No gaps detected".
- [ ] **Claude:** extract while a reply is streaming. It's marked partial ("still generating"). Extract again when the reply finishes, and it shows no gaps.
- [ ] **Gemini:** long conversation scrolled to the bottom. Progress shows "loading earlier messages…", and the first message is the real first prompt.
- [ ] A new, empty chat gives "No conversation is open".
- [ ] A tab opened before installing the extension still extracts (scripts are injected on demand).
- [ ] Save & Continue, then **New Claude chat** with the panel still open: **Insert into this tab's chat box** fills the input and does not send.
- [ ] **Your own API key:** Test key works; a wrong key falls back with a clear message.
- [ ] Turning off **Load earlier messages** labels the handoff partial.

## Publishing to the Chrome Web Store

Run `npm run package` and follow [docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md). It has the listing text, privacy-tab answers, permission justifications and a submission checklist. The privacy policy URL points to [PRIVACY.md](PRIVACY.md) on the `main` branch, so merge to `main` before submitting.

## Known limitations

- Only what the site renders is captured. Images, files, canvases and artifacts are flagged, not extracted. Collapsed content is flagged, not expanded.
- Site redesigns can break extraction. You get a compatibility error rather than a wrong handoff; the fix goes in `extension/content/adapters/<site>-adapter.js`.
- History loading stops after about 25 s on extremely long chats, and the handoff is then marked partial.
- The built-in (no-AI) generator cannot reliably tell "completed" from "in progress", and says so in the handoff.
- "Insert into chat box" uses the page's editor events. If a site ignores them, paste manually.
- With your own API key, a very long Full Handoff can take several AI calls and count against your quota.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The icon opens nothing | Requires Chrome 116 or newer. Reload the extension at `chrome://extensions`. |
| "Could not talk to the page" | Reload the AI tab (common right after installing or updating). |
| "Layout not recognized" | The site changed. Use the paste fallback and report the issue. |
| Test key fails with AUTH | Wrong or revoked key, or no billing set up with the provider. |
| AI says provider failed (HTTP 503/429) | Provider overloaded or quota hit. It retries twice, then falls back to the built-in handoff. |
| "Cannot reach the backend" | Start the backend and check that Settings → Backend URL matches `PORT`. Saves still work locally. |
| Health shows `db: disconnected` | Check `MONGO_URI` and the Atlas IP allow-list. `querySrv ENOTFOUND` means the cluster hostname does not exist. |
| Memories disappeared after upgrading | See "Migrating old memories". |
