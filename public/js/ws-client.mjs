// WebSocket 封装 — 自动重连 + 消息分发
import { MSG } from './protocol.mjs';

export class WSClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.reconnectTimer = null;
    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    this.connected = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.connected = true;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this._emit('open');
    };

    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, payload } = msg;
      this._emit(type, payload);
      this._emit('*', { type, payload });
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emit('close');
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
      this._emit('error');
    };
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  off(type, fn) {
    const arr = this.handlers.get(type);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  _emit(type, data) {
    const arr = this.handlers.get(type);
    if (arr) arr.forEach(fn => { try { fn(data); } catch (e) { console.error('WS handler error:', e); } });
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
