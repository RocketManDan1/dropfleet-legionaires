import { WebSocket } from 'ws';

const ws = new WebSocket('ws://127.0.0.1:3000');

ws.on('open', () => {
  console.log('OPEN');
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', (data) => {
  const text = data.toString();
  console.log('MESSAGE', text.slice(0, 200));
});

ws.on('close', (code, reason) => {
  console.log('CLOSE', code, reason.toString());
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('ERROR', err.message);
});

setTimeout(() => {
  console.log('STILL_OPEN?', ws.readyState === WebSocket.OPEN);
}, 10000);

setTimeout(() => {
  ws.close();
}, 15000);
