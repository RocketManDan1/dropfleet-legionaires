export type MessageHandler = (msg: any) => void;

export class GameConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private statusEl: HTMLElement;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private useDirectPortFallback: boolean = false;

  constructor() {
    this.statusEl = document.getElementById('status')!;
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isDev = location.port === '5173';
    const proxiedUrl = `${protocol}//${location.host}/ws`;
    const directUrl = `${protocol}//${location.hostname}:3000`;
    const wsUrl = isDev
      ? directUrl
      : (this.useDirectPortFallback ? directUrl : proxiedUrl);

    this.statusEl.textContent = 'CONNECTING...';
    this.statusEl.className = '';

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.statusEl.textContent = 'CONNECTED';
      this.statusEl.className = '';

      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
      }
      this.heartbeatTimer = window.setInterval(() => {
        this.send('PING', { payload: { clientTime: Date.now() } });
      }, 15000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handlers = this.handlers.get(msg.type) || [];
        for (const handler of handlers) {
          handler(msg);
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    this.ws.onclose = () => {
      this.statusEl.textContent = 'DISCONNECTED';
      this.statusEl.className = 'disconnected';

      if (!isDev) {
        this.useDirectPortFallback = !this.useDirectPortFallback;
      }

      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 2000);
      }
    };

    this.ws.onerror = () => {
      this.statusEl.textContent = 'CONNECTION ERROR';
      this.statusEl.className = 'disconnected';
    };
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  send(type: string, data?: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }
}
