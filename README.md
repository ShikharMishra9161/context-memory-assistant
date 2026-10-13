# Context Memory Assistant

A Chrome extension (Manifest V3) that lets you move a long ChatGPT, Claude or Gemini conversation into a **new chat without losing your project context**. One click extracts the conversation, turns it into a structured, project-aware handoff, and copies a ready-to-paste continuation prompt.

It also keeps the original feature: reusable "memories" that the on-page **🧠 Inject Context** button inserts into the chat box.

## Main workflow

1. Open an existing conversation on ChatGPT, Claude or Gemini.
2. Click the extension icon, choose a mode, and click **Extract Context**.
3. The extension scrolls up to load earlier messages, reads every rendered message (with code blocks, lists, tables and errors), removes UI noise and duplicates, and checks for gaps.
4. A handoff is generated, by the backend LLM if you enabled it, otherwise by the built-in deterministic generator.
5. Review it: **Preview**, **Edit**, or inspect the **Source messages**.
6. Click **Save Context & Continue**. The handoff is saved and copied to the clipboard.
7. Click **New ChatGPT / Claude / Gemini chat**, paste (Ctrl+V), review and send. You can also reopen the popup and click **Insert into this tab's chat box**. Nothing is ever sent automatically.

The **Saved** tab lets you search, open, edit, rename, duplicate, delete, copy and export saved handoffs. **Update from current chat** saves the next extraction into an existing handoff after another work session.

## Features

| Area | What it does |
| --- | --- |
| Extraction | Per-platform adapters (ChatGPT, Claude, Gemini) with a shared core: DOM→Markdown that keeps code byte-for-byte with its language, history loading by scrolling (including virtualized lists), waiting for dynamic rendering, de-duplication, streaming detection, and injection on demand into tabs opened before install. |
| Honesty | The message count and completeness are always shown. The handoff is labelled **PARTIAL EXTRACTION** if the response is still streaming, history did not finish loading, messages are collapsed ("Show more") or image-only, the same speaker appears twice in a row, the opening user message is missing, or the conversation was pasted manually. "No gaps detected" is the strongest claim it makes. |
| Modes | **Quick Summary**, **Continue Project**, **Full Handoff** (all code and a full transcript appendix), **Custom Handoff** (your "must remember" notes). |
| Handoff content | A. Project overview · B. Implementation state · C. Decisions and constraints · D. Current task · E. Next steps · Instructions for the next AI · verbatim technical details (commands, errors, file paths, URLs, code). Every item is tagged *confirmed* / *assumption* / *unknown* and references source message numbers. |
| Large handoffs | Split into numbered parts at paragraph or code boundaries (fences are closed and reopened, never cut silently), plus a master index. The size limit is configurable. |
| AI generation | Provider abstraction (Gemini, OpenAI or OpenAI-compatible, Anthropic) with chunking, per-chunk JSON, a lossless mechanical merge, optional consolidation (rejected if it drops too much), retries for transient errors, and automatic deterministic fallback. |
| Storage | Local-first in `chrome.storage.local`, with optional sync to MongoDB. Sync is idempotent, failed requests are retried, failed remote deletes are queued, and records saved from another browser with the same token are pulled. |
| Fallbacks | Works with no backend, no database and no API key. If extraction fails you can paste the conversation text manually. |

## Architecture

```
extension/
  manifest.json              MV3 manifest
  background/service-worker.js   memory sync + keep-alive (ES module)
  lib/settings.js            settings, per-install token, backend client (shared by SW and popup)
  content/
    injector-utils.js, *-injector.js   original "Inject Context" button
    extract-core.js          platform-agnostic extraction (DOM→Markdown, history loading, signals)
    adapters/{chatgpt,claude,gemini}-adapter.js   platform DOM knowledge only
    extract-listener.js      popup ⇄ content-script messaging
  popup/                     React 19 + Vite + Tailwind popup (builds to extension/dist-popup)
shared/handoff-core/         dependency-free ES modules (source of truth) used by the popup;
                             the backend uses a vendored copy (see below):
                             normalize, completeness, deterministic analyzer, schema,
                             Markdown renderer + splitter, chunk/merge, LLM prompts
backend/                     Express 4 + Mongoose 7
  src/app.js                 app factory (CORS, auth, rate limits, routes, errors)
  src/routes/generate.js     POST /generate   (no storage, no content logging)
  src/routes/handoffs.js     /handoffs CRUD, search, duplicate, markdown download
  src/routes/memory.js       /memory (original feature, now owner-scoped)
  src/services/llm/providers.js, src/services/handoffGenerator.js
  src/stores/handoffStore.js Mongo store + in-memory store (tests / STORAGE=memory)
  src/vendor/handoff-core/   generated copy of shared/handoff-core (npm run sync-core)
dashboard/                   small CRA dashboard (reads memories and handoffs with your token)
tests/                       core, jsdom extraction, and popup↔backend integration tests
```

**Data flow:** popup → `chrome.tabs.sendMessage` → content script (`CMAExtract.run`) → raw messages and DOM signals → `prepareExtraction` (normalize, dedupe, assess) → local deterministic generator **or** `POST /generate` (only if enabled) → Markdown preview → `chrome.storage.local` (+ `POST /handoffs` if sync is enabled) → clipboard → new chat.

## Prerequisites

- Node.js 18+ (developed with 20.19)
- Google Chrome (or another Chromium browser)
- Optional: MongoDB (local or Atlas) for memories and handoff sync
- Optional: a Gemini, OpenAI or Anthropic API key for AI-generated handoffs

## Setup

```bash
# 1. Install
npm install                          # root: test tooling (jsdom)
npm install --prefix backend
npm install --prefix extension/popup

# 2. Configure the backend
cp backend/.env.example backend/.env   # then edit; never commit .env

# 3. Start the backend (http://localhost:4000)
npm run dev --prefix backend           # or: npm start --prefix backend

# 4. Build the popup
npm run build                          # → extension/dist-popup
```

### Load the extension in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder (after step 4 above).
3. After code changes, run `npm run build` and click **Reload** on the extension card. Open AI tabs reload automatically after an update.

For a self-contained package, `bash build-extension.sh` assembles `extension/dist/` and a ZIP if `zip` is installed.

### Environment variables (`backend/.env`)

See [backend/.env.example](backend/.env.example) for the full list. Key ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Must match the backend URL in the extension's Settings |
| `MONGO_URI` | none | MongoDB connection string. Without it, storage routes return 503 and the extension stays local-only |
| `STORAGE` | `mongo` | `memory` = non-persistent store for quick local testing |
| `LLM_PROVIDER` | auto | `gemini`, `openai`, `anthropic` or `none`. If unset, the first provider with a key is used (Anthropic, then OpenAI, then Gemini) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | none | Provider keys. `GEMINI_API_KEY` is also used for memory embeddings |
| `LLM_MODEL` | provider default | `gemini-2.5-flash`, `gpt-4.1-mini` or `claude-sonnet-5-5` |
| `LLM_BASE_URL` | provider default | For example, an OpenAI-compatible local server |
| `LLM_MAX_INPUT_CHARS` / `LLM_MAX_CHUNKS` | `120000` / `12` | Per-chunk budget, and the maximum number of chunks before falling back to deterministic generation |
| `ALLOWED_EXTENSION_IDS` | empty (any) | Pin CORS to your extension ID in production |
| `JSON_LIMIT` | `5mb` | Request size limit |
| `RATE_LIMIT_MAX` / `GENERATE_RATE_LIMIT_MAX` | `120` / `10` per minute | Per-token rate limits |

### MongoDB

Use any MongoDB 6+ (`mongodb://127.0.0.1:27017/context-memory-assistant` locally, or an Atlas SRV string). Collections `handoffs` and `memories` are created automatically. If the database is unreachable the server still starts: `/health` reports `db: "disconnected"`, `/generate` keeps working, and the extension keeps handoffs locally.

### Configuring AI generation

1. Put a provider key in `backend/.env` (optionally set `LLM_PROVIDER` and `LLM_MODEL`) and restart the backend.
2. In the popup, open **Settings → Backend → Test**. The status shows `LLM: <provider> (<model>)`, or why it is not configured.
3. Turn on **AI-generated handoffs**. You are asked to confirm, because the extracted conversation is sent to your backend and on to the provider.

Without a key, or when the provider fails or times out, the handoff is built by the deterministic generator and the UI and handoff state why.

## Privacy and security

- **Local by default.** Extraction, the deterministic generator and saved handoffs stay in the browser. Both remote features (AI generation, sync) are off until you enable them in Settings, and each requires a confirmation.
- **Per-install isolation.** The extension generates a random 256-bit token. The backend stores only `sha256(token)` as `ownerId`, and every handoff and memory query is scoped to it. Another token gets `404` for your documents. Body fields such as `ownerId`/`userId` are ignored (no mass assignment). You can copy or import the token in Settings to share data between browsers, so keep it private.
- **No secrets in the extension.** Provider keys live only in `backend/.env` and are sent in headers, never in URLs. `/health` exposes the provider and model name only.
- **Logging.** Request logs contain method, path, status and timing only. No bodies, query strings, tokens or conversation content. `/generate` processes conversations in memory and does not store them.
- **Hardening.** Input validation with size limits, a JSON body limit (413), per-token rate limiting (429), Origin checking (unknown web origins get 403), generic 500 messages, and LLM timeouts.
- Use HTTPS for any backend that is not on localhost.
- `backend/src/middleware/auth.js` (JWT) predates this change and is not used. The per-install token replaced the previously unauthenticated API.

### Migrating memories created before this version

Older memories were stored with `userId: "local"` and are hidden from the new per-install tokens. To take ownership of them once:

1. Set `ALLOW_LEGACY_MEMORY_CLAIM=true` in `backend/.env` and restart the backend.
2. In the popup, open **Memories** and click **Recover older memories** at the bottom.
3. Set the flag back to `false` and restart.

## Testing

```bash
npm test               # shared core + jsdom extraction + popup↔backend integration, then backend tests
npm run test:core      # root tests only
npm run test:backend   # backend API + LLM provider tests
npm run lint           # popup ESLint
npm run build          # popup production build
npm run sync-core      # after editing shared/handoff-core: refresh the backend's vendored copy
```

The backend loads its own copy of the core from `backend/src/vendor/handoff-core`, so `backend/` can be deployed on its own (e.g. Render with root directory `backend`). `npm test` fails if that copy is out of date.

The automated tests cover: message parsing, ordering and dedupe; code block and error preservation; partial-extraction detection; empty conversations; very long conversations, chunking and part splitting; LLM failure, malformed output, retries and deterministic fallback; handoff CRUD, search, idempotent sync and owner isolation; validation, 413, 429, 503 and CORS; the content-script adapters against platform-like DOMs (including lazy-loaded Gemini history); content-script messaging; and the popup's local-first store and sync against the real backend app.

### Manual test checklist (real sites)

Automated tests use DOMs modelled on each platform. Real sites change, so check each platform after loading the extension:

- [ ] **ChatGPT**: open a conversation with code and a long history and extract. The count matches the visible turns, code blocks have the right language, there are no "Copy code" lines, and the badge says "No gaps detected".
- [ ] **Claude**: extract during a streaming reply. The result is marked partial ("still generating"). Extract again when it finishes and it shows no gaps.
- [ ] **Gemini**: open a long conversation scrolled to the bottom and extract. The progress shows "Scrolling up to load earlier messages…" and the first message is the real first prompt.
- [ ] Open a new or empty chat and extract. You get a "No conversation is open" message and nothing is generated.
- [ ] On a tab opened before installing the extension, extraction still works (scripts are injected on demand).
- [ ] In **Source messages**, check roles and order. Then **Edit**, **Copy**, **Export Markdown**, and **Save Context & Continue**. Open a new chat on another platform, paste, and check that it continues from the next step.
- [ ] With the backend stopped and AI enabled, generation falls back with a notice. With sync enabled, the save shows "sync failed" and **Saved → Sync** uploads it after the backend restarts.
- [ ] Turn off **Load earlier messages automatically** and the handoff is labelled partial.
- [ ] The original **Inject Context** button and the **Memories** tab still work (backend + MongoDB required).

## Known limitations

- Extraction reads only what the site renders in your browser. Images, uploaded files, canvases and artifacts are not captured (flagged as "no extractable text"). Collapsed content is flagged, not expanded.
- Sites change their DOM. When an adapter finds no messages on a conversation URL, the extension reports a compatibility error instead of producing a handoff. Fix it in `extension/content/adapters/<platform>-adapter.js`.
- Gemini and ChatGPT may lazy-load very long histories. Loading stops after about 25 s and the handoff is then marked partial.
- The deterministic generator copies text and uses keyword matching. It cannot reliably decide what is "completed" vs. "in progress", and says so in the handoff.
- "Insert into chat box" uses the page's editor input events. If a site ignores them, paste manually.
- The rate limiter is in-memory (single backend process).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Cannot reach the backend" | Start the backend and check that Settings → Backend URL matches `PORT`. Saves still work locally. |
| "Could not talk to the page" | Reload the AI tab (common right after installing or updating the extension). |
| "layout not recognized" | The site changed. Use the paste fallback and update the adapter selectors. |
| Health shows `db: disconnected` | Check `MONGO_URI` and Atlas network access (IP allow-list). If the log says `querySrv ENOTFOUND`, the cluster hostname does not exist (deleted, renamed or mistyped) — copy a fresh connection string from Atlas → Connect. Generation keeps working meanwhile. |
| `LLM: not configured` | Add a provider key to `backend/.env` and restart. |
| AI handoff says provider failed (HTTP 503/429) | The provider is overloaded or rate-limited. Requests are retried twice, then fall back. Try again later. |
| Memories disappeared after upgrading | See "Migrating memories created before this version". |
