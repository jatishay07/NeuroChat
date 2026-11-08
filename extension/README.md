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

**Each page has its own conversation.** Explanations and questions on a page carry on in the same
chat. Switch tabs and the chat switches with you. Come back to the page later, even after closing
the panel or restarting Chrome, and the conversation is still there. The last 60 pages are kept in
the extension's storage on this computer. **+** starts over on the current page.

An explanation includes the paragraph around your selection, so a short phrase isn't explained
without its context. Your first question on a page takes the page's text along, so you can ask
"what does this mean?" straight away. The suggestions (**Summarize this page**, **Explain the main
idea simply**, **Quiz me on it**) work the same way.

### Study mode on any page

Right-click the page and choose **Study this page with NeuroChat**, or press **Alt+Shift+S**. The
paragraph at your reading line stays lit and the rest of the article dims; scroll as usual, or press
**j** / **k** to move one paragraph. Each paragraph is timed (active time only, per 100 words) and
compared with your own usual pace, learned from earlier paragraphs on any site. When you're much
slower than usual (1.5× your median) the paragraph gets a quiet amber edge and its **Explain**
button turns dark; nothing pops up. **Explain** sends the paragraph and how long it took you to the
side chat. **Esc** or **Exit** turns it off and leaves the page as it was. The paces stay in the
extension's storage on this computer (last 200 paragraphs). Uses the same pace engine as the
portal's `/study.html` (`study/study-pace.js`).

## How it works

| File                                            | Job                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `content.js`                                    | On every page: the Explain button, the selection plus its paragraph, and the page's text                         |
| `background.js`                                 | Opens the side panel and hands it the request (right-click menu, shortcut, button)                               |
| `sidepanel.html/.js/.css`                       | The chat, one saved conversation per page; streams answers from the companion over `ws://127.0.0.1:8765/ws/chat` |
| `study/study-content.js`, `study/study-pace.js` | Study mode: dims the page, follows the reading line, times each paragraph against your usual pace                |
| `markdown.js`                                   | Formats answers (lists, bold, code) safely                                                                       |

The `scripting` permission lets study mode start in tabs that were open before the extension was installed.

Nothing goes to the internet: the page text goes only to the companion app on this computer.

When eye tracking says you're stuck on a paragraph, a small **Stuck here? Explain** offer appears
next to it. The eye tracker sends a `neurochat:slow` window event with
`{index, text, dwellMsPer100Words, rereads, element}`, and `content.js` shows the offer. **✕** stops
it asking about that paragraph again. The eye tracking for any page (`extension/gaze/`) is being built.

Not yet: a floating chat for apps other than Chrome.
