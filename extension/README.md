# Browser extension (next)

Chrome Manifest V3 extension that works on any page you read:

- a content script splits the page into paragraphs and tags each with an id;
- an offscreen document runs WebGazer on the webcam and sends gaze points to the companion app;
- when the companion flags a paragraph you struggled with, the extension offers to explain it, and the conversation continues in the portal.

It will talk to the companion app at `http://127.0.0.1:8765` (REST) and `ws://127.0.0.1:8765/ws/...`; the companion already accepts requests from `chrome-extension://` origins. Not built yet: the headset connection comes first.
