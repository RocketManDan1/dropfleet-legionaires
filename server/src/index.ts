import { WebSocketServer, WebSocket } from 'ws';
import { generateTerrain, TerrainData } from './terrain.js';

const PORT = 3000;
const MIN_MAP_SIZE = 128;
const MAX_MAP_SIZE = 768;

function parseMapSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.floor(value)));
}

function parseSeed(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

// Generate terrain once at startup
console.log('Generating terrain...');
let terrain: TerrainData = generateTerrain(512, 512);
console.log(`Terrain generated: ${terrain.width}x${terrain.height}, biome: ${terrain.biome}, sea level: ${terrain.seaLevel}, towns: ${terrain.towns.length}`);

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  // Send terrain data to new client
  ws.send(JSON.stringify({
    type: 'terrain',
    data: terrain,
  }));

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log('Received:', msg.type);

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }

      if (msg.type === 'generate') {
        const width = parseMapSize(msg.width, terrain.width);
        const height = parseMapSize(msg.height, terrain.height);
        const seed = parseSeed(msg.seed);

        console.log(`Regenerating terrain ${width}x${height} seed=${seed ?? 'random'}`);
        terrain = generateTerrain(width, height, seed);
        console.log(`New terrain: seaLevel=${terrain.seaLevel}, towns=${terrain.towns.length}`);
        ws.send(JSON.stringify({ type: 'terrain', data: terrain }));
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

console.log(`Game server listening on ws://0.0.0.0:${PORT}`);
