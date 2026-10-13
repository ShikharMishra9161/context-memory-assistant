# Chrome Web Store submission guide

Everything needed to publish Context Memory Assistant, ready to copy into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## 1. Build the package

```bash
npm run package        # builds the side panel and writes context-memory-assistant.zip
```

Upload `context-memory-assistant.zip`. Before uploading, bump `"version"` in `extension/manifest.json` if you are updating an existing listing.

## 2. Store listing

**Name:** Context Memory Assistant

**Summary (≤132 characters):**
Move a long ChatGPT, Claude or Gemini conversation into a new chat without losing your project context.

**Category:** Productivity · **Language:** English

**Description:**

> Hit the message limit, or is your AI chat getting too long? Context Memory Assistant turns the conversation into a clear handoff you can paste into a new chat, on the same AI or a different one, so you continue exactly where you stopped.
>
> HOW IT WORKS
> 1. Open a conversation on ChatGPT, Claude or Gemini.
> 2. Click the extension icon to open the side panel, then click "Extract Context".
> 3. Review the handoff: project overview, current state, decisions and constraints, the exact task you were on, next steps, and all the code, commands and error messages.
> 4. Click "Save Context & Continue". The handoff is saved and copied, and you open a new chat and paste it.
>
> FEATURES
> • Works with ChatGPT, Claude and Gemini
> • Keeps code blocks, file names, commands and error messages exactly as written
> • Honest: tells you when messages may be missing, and never claims a partial chat is complete
> • Four modes: Quick Summary, Continue Project, Full Handoff, Custom
> • Very long handoffs are split into numbered parts
> • Saved handoffs: search, edit, duplicate, export as Markdown, update after each session
> • Optional AI summaries with your own Gemini, OpenAI or Anthropic API key
>
> PRIVACY
> Everything stays in your browser by default. Nothing is sent anywhere unless you choose an AI provider in Settings. The developer receives no data. No tracking or analytics.

**Screenshots (1280×800 or 640×400, 1–5 required).** Capture these with the side panel open next to a real conversation:
1. A conversation with the side panel showing **Extract Context** and the mode selector
2. The result: badges ("No gaps detected", message count) and the handoff preview
3. The **Source messages** inspector
4. The **Continue in a new conversation** step with the New ChatGPT/Claude/Gemini buttons
5. **Settings → AI handoffs** with "Your own API key" selected

**Small promo tile (440×280):** optional. Use the icon from `extension/icons/icon-128.png` on an indigo background.

**Privacy policy URL:**
`https://github.com/ShikharMishra9161/context-memory-assistant/blob/main/PRIVACY.md`

## 3. Privacy practices tab

**Single purpose:**
> Extract the content of the user's current AI chat conversation (ChatGPT, Claude or Gemini) and turn it into a handoff document the user can paste into a new conversation.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings, the current draft and saved handoffs locally. |
| `unlimitedStorage` | Saved handoffs include the extracted conversation text, and long technical conversations can exceed the default 10 MB local storage quota. |
| `scripting` | Injects the extraction script into a ChatGPT, Claude or Gemini tab that was already open before the extension was installed or updated, so the user does not have to reload the page. |
| `sidePanel` | The extension's interface is a side panel, so it stays open while the user opens a new chat and pastes the handoff. |
| `clipboardWrite` | Copies the handoff to the clipboard when the user clicks Copy or "Save Context & Continue". |
| `alarms` | Only used when the user connects their own backend server: periodically syncs saved memories. No requests are made otherwise. |
| Host permissions: `chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com` | Required to read the conversation on these sites when the user clicks Extract Context, and to insert the handoff into the chat box when the user clicks Insert. |
| Optional host permissions: `localhost`, `127.0.0.1`, `https://*/*` | Requested at runtime, and only for the single address the user enters: either their AI provider's API (when using their own API key) or their own backend server. Nothing is granted at install time. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package.)

**Data usage (check these):**
- ☑ **Website content**: conversation text on supported AI sites, read only when the user clicks Extract Context.
- ☑ **Authentication information**: only if the user enters their own AI provider API key; it is stored locally and sent only to that provider.

Leave all other categories unchecked.

**Certify:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

## 4. Pre-submission checklist

- [ ] `npm test` passes
- [ ] Load `extension/dist` unpacked and test extraction on ChatGPT, Claude and Gemini (see the README checklist)
- [ ] Test "Your own API key" with a real key, plus "Test key"
- [ ] `PRIVACY.md` is merged into `main`, so the privacy policy URL above works
- [ ] Screenshots captured
- [ ] Version bumped in `extension/manifest.json`
