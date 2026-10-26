# NeuroChat side chat (Chrome extension)

A small chat beside whatever you're reading in Chrome. Select something you're stuck on and the
NeuroChat tutor explains it, using the model on your own computer. Then ask follow-up questions.

## Install

1. Start NeuroChat (`neurochat` in a terminal, or the Docker image). The side chat talks to it at
   `http://127.0.0.1:8765`.
2. In Chrome (or Edge), open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension` folder.
4. Pin NeuroChat from the puzzle-piece menu so its icon is always in the toolbar.

`neurochat` updates the folder with the rest of NeuroChat. After an update, click the reload arrow
on the NeuroChat card in `chrome://extensions`.

## Use

- **Select text**, then click the **Explain** button that appears next to it.
- Or **right-click** the selection and choose **Explain with NeuroChat**. This also works in PDFs
  opened in Chrome.
- Or press **Alt+Shift+E** (change it at `chrome://extensions/shortcuts`).
- Click the toolbar icon to open the chat and ask anything.

Each explanation starts a new conversation. It includes the paragraph around your selection, so a
short phrase isn't explained without its context. **New chat** clears it.

## How it works

| File | Job |
|---|---|
| `content.js` | On every page: the Explain button, and the selection plus its paragraph |
| `background.js` | Opens the side panel and hands it the request (right-click menu, shortcut, button) |
| `sidepanel.html/.js/.css` | The chat: streams answers from the companion over `ws://127.0.0.1:8765/ws/chat` |

Nothing goes to the internet: the page text goes only to the companion app on this computer.

Not yet: offering help by itself when eye tracking or the headset says you're stuck on a paragraph,
and a floating chat for apps other than Chrome.
