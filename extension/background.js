// NeuroChat extension: opens the side chat and hands it what to explain.
// The side panel does the talking to the companion app; this only routes requests to it.

const MENU_ID = "neurochat-explain";
const STUDY_ID = "neurochat-study"; // study mode on the page (study/study-content.js)

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.create({ id: MENU_ID, title: "Explain with NeuroChat", contexts: ["selection"] });
  chrome.contextMenus.create({ id: STUDY_ID, title: "Study this page with NeuroChat", contexts: ["page"] });
});

// Hand a request to the side panel through session storage, so it arrives whether the panel
// was already open or is only just loading.
function handOff(request) {
  return chrome.storage.session.set({ pending: { ...request, at: Date.now() } });
}

// sidePanel.open must run while Chrome still counts the click or key press as a user action,
// so call it first, before anything that awaits.
function openPanel(tab) {
  return chrome.sidePanel.open({ tabId: tab.id }).catch(() => chrome.sidePanel.open({ windowId: tab.windowId }));
}

// Study mode is switched on and off in the page itself. Tabs opened before the extension was
// installed or updated don't have its script yet, so put it there first.
async function toggleStudy(tab) {
  const toggle = () => chrome.tabs.sendMessage(tab.id, { type: "neurochat:study" });
  try { await toggle(); } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["study/study-pace.js", "study/study-model.js", "study/study-content.js"] });
      await toggle();
    } catch { /* a page extensions can't touch, such as chrome:// or the Web Store */ }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Study mode explains by itself, into the side chat, so the chat opens with it (Chrome only lets it
  // open on a click or key press).
  if (info.menuItemId === STUDY_ID && tab) { openPanel(tab); toggleStudy(tab); return; }
  if (info.menuItemId !== MENU_ID || !tab) return;
  openPanel(tab);
  // The menu only gives the selected text; ask the page for the paragraph around it.
  chrome.tabs.sendMessage(tab.id, { type: "neurochat:selection" })
    .then((sel) => handOff(sel && sel.text ? sel : { text: info.selectionText, title: tab.title, url: tab.url }))
    .catch(() => handOff({ text: info.selectionText, title: tab.title, url: tab.url }));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "study-page" && tab) { openPanel(tab); toggleStudy(tab); return; }
  if (command !== "explain-selection" || !tab) return;
  openPanel(tab);
  chrome.tabs.sendMessage(tab.id, { type: "neurochat:selection" })
    .then((sel) => sel && sel.text && handOff(sel))
    .catch(() => {});
});

// The "Explain" button the page shows next to a selection.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type !== "neurochat:explain" || !sender.tab) return;
  openPanel(sender.tab).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
  handOff(msg.request);
  return true; // reply is async
});
