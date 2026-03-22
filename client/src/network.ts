export type MessageHandler = (msg: any) => void;

export class GameConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private statusEl: HTMLElement;

  constructor() {
    this.statusEl = document.getElementById('status')!;
  }

  connect() {
    // In production (nginx), WebSocket is proxied on same host
    // In dev, connect directly to server
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.hostname}:3000`;

    this.statusEl.textContent = 'CONNECTING...';
    this.statusEl.className = '';

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.statusEl.textContent = 'CONNECTED';
      this.statusEl.className = '';
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
      // Reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
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
