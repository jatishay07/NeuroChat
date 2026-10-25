// Connects a Muse S Athena straight from the browser with Web Bluetooth (Chrome and Edge) and
// forwards its raw packets to the companion app over /ws/headset, which decodes them. This is how
// the headset works when the companion runs in Docker, where it can't reach Bluetooth itself.
// The start-up commands follow OpenMuse (github.com/DominiqueMakowski/OpenMuse).
(() => {
  const MUSE_SERVICE = 0xfe8d;
  const CONTROL = "273e0001-4c4d-454d-96be-f03bac821358";
  const DATA = ["273e0013-4c4d-454d-96be-f03bac821358", "273e0014-4c4d-454d-96be-f03bac821358"];
  const PRESET = "p1041"; // EEG plus optics (fNIRS), OpenMuse's default
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (v) => Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), (b) => b.toString(16).padStart(2, "0")).join("");

  // A command is its ASCII text plus a newline, prefixed with its length.
  function encode(token) {
    const text = new TextEncoder().encode(token + "\n");
    return Uint8Array.of(text.length, ...text);
  }

  function openSocket(path) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error("Can't reach the companion app."));
    });
  }

  class MuseBluetooth {
    static supported() { return !!navigator.bluetooth; }

    constructor(onEnd) {
      this.onEnd = onEnd; // called once with an error message, or null after stop()
      this.queue = [];
      this.ended = false;
    }

    // Must be called from a click: the browser shows its own list of nearby headsets.
    async connect() {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "Muse" }],
        optionalServices: [MUSE_SERVICE],
      });
      this.device.addEventListener("gattserverdisconnected",
        () => this.end("The headset disconnected. It may be out of range or out of battery."));
      try {
        const service = await (await this.device.gatt.connect()).getPrimaryService(MUSE_SERVICE);
        this.control = await service.getCharacteristic(CONTROL);
        let data;
        try {
          data = await Promise.all(DATA.map((u) => service.getCharacteristic(u)));
        } catch {
          throw new Error("This Muse isn't supported. NeuroChat works with the Muse S Athena.");
        }
        this.ws = await openSocket("/ws/headset");
        this.ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === "error") this.end(m.message); };
        // Closed by the companion (Disconnect, or it stopped): the connect screen shows why.
        this.ws.onclose = () => this.end(null);
        this.ws.send(JSON.stringify({ type: "hello", name: this.device.name || "Muse" }));
        for (const c of data) {
          c.addEventListener("characteristicvaluechanged", (e) => this.queue.push([c.uuid, hex(e.target.value)]));
          await c.startNotifications();
        }
        await this.control.startNotifications().catch(() => {});
        this.timer = setInterval(() => this.flush(), 100);
        await this.start();
      } catch (e) {
        this.end(null);
        throw e;
      }
    }

    async send(token) {
      const bytes = encode(token);
      if (this.control.writeValueWithoutResponse) await this.control.writeValueWithoutResponse(bytes);
      else await this.control.writeValue(bytes);
    }

    // Version and status, halt, preset, then start streaming (sent twice, as OpenMuse does) and low latency.
    async start() {
      for (const [token, wait] of [["v6", 200], ["s", 200], ["h", 200], [PRESET, 200], ["s", 200],
                                   ["dc001", 50], ["dc001", 100], ["L1", 300], ["s", 200]]) {
        if (this.ended) return;
        await this.send(token).catch(() => {});
        await sleep(wait);
      }
    }

    flush() {
      if (!this.queue.length || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "data", packets: this.queue }));
      this.queue = [];
    }

    stop() { this.end(null); }

    end(message) {
      if (this.ended) return;
      this.ended = true;
      clearInterval(this.timer);
      if (message && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "lost", message }));
      this.ws?.close();
      if (this.device?.gatt.connected) {
        this.send("h").catch(() => {}).finally(() => this.device.gatt.disconnect());
      }
      this.onEnd?.(message);
    }
  }

  window.MuseBluetooth = MuseBluetooth;
})();
