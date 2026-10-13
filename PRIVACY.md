# Privacy Policy — Context Memory Assistant

_Last updated: 13 October 2026_

Context Memory Assistant ("the extension") helps you move a ChatGPT, Claude or Gemini conversation into a new chat by turning it into a written "handoff". This policy explains what data the extension handles and where it goes.

**Summary:** the developer of this extension does not collect, receive or store any of your data. Everything stays in your browser unless *you* choose an AI provider or your own server in Settings.

## What the extension reads

- **Conversation content** on `chatgpt.com`, `chat.openai.com`, `claude.ai` and `gemini.google.com`, **only when you click "Extract Context"**. It reads the messages shown on the page you have open, including text and code, so it can build a handoff. It does not read other websites, and it does not read anything in the background.
- **The address and title of the current tab**, to detect which AI site you are on and to label saved handoffs.

The extension never reads passwords, cookies, payment details or your account information. It does not bypass any login or paywall; it only reads what is already displayed to you.

## What is stored, and where

All of the following is stored **locally in your browser** (`chrome.storage.local`) and never leaves your device unless you enable one of the options below:

- The handoff you are working on (draft) and the extracted messages it was built from
- Handoffs you save, including titles and project names
- Your settings
- If you choose "Your own API key": the API key you enter. It is stored only in your browser and sent only to the AI provider you selected.
- A random access token, used only if you connect your own backend server

## When data leaves your browser (only if you turn it on)

| Setting | What is sent | Sent to |
| --- | --- | --- |
| **AI handoffs → Your own API key** | The extracted conversation, when you click Extract Context | The AI provider you selected (Google Gemini, OpenAI or Anthropic), directly from your browser, under **your** account. That provider's privacy policy and API terms apply. |
| **AI handoffs → Your own backend server** | The extracted conversation | The server address you enter (for example one you run yourself). The included open-source server does not store or log conversation content. |
| **Sync saved handoffs to your backend** | Saved handoffs | The server address you enter, stored in its database under your access token. |

Each option is **off by default** and asks for confirmation before it is enabled. You can turn it off at any time in Settings.

## What we do not do

- No analytics, tracking, advertising or telemetry.
- No sale or transfer of data to third parties.
- No use of your data to determine creditworthiness or for lending purposes.
- No remote code: all extension code is included in the package.

## Clipboard

The extension **writes** a handoff to your clipboard when you click Copy or "Save Context & Continue". It never reads your clipboard.

## Deleting your data

- Delete individual handoffs in the **Saved** tab.
- Remove your API key by clearing the field in Settings.
- Uninstalling the extension deletes all of its locally stored data.
- Data you synced to your own backend is under your control on that server.

## Changes

If this policy changes, the updated version will be published at this address with a new date.

## Contact

Questions or requests: open an issue at <https://github.com/ShikharMishra9161/context-memory-assistant/issues>.
