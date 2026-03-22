import { WebSocketServer, WebSocket } from 'ws';
import { generateTerrain, TerrainData } from './terrain.js';
import { parseGenerateRequest } from './protocol.js';
import { validateTerrainData } from './validation.js';

const PORT = 3000;
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
        const parsed = parseGenerateRequest(msg, terrain.width, terrain.height);
        if (!parsed.ok) {
          ws.send(JSON.stringify({
            type: 'error',
            code: parsed.code,
            message: parsed.message,
            details: parsed.details,
            requestId: parsed.requestId,
          }));
          return;
        }

        const { width, height, seed, batloc } = parsed;

        console.log(`Regenerating terrain ${width}x${height} seed=${seed ?? 'random'} batloc=${batloc.name}`);
        const generated = generateTerrain(width, height, { seed, batloc });
        const validation = validateTerrainData(generated);
        if (!validation.valid) {
          ws.send(JSON.stringify({
            type: 'error',
            code: 'TERRAIN_INVARIANT_FAILED',
            message: 'Terrain generation failed invariant checks',
            details: validation.errors.map((e) => ({ field: e.invariant, reason: e.message })),
            requestId: parsed.requestId,
          }));
          return;
        }

        terrain = generated;
        console.log(`Terrain metrics: rivers=${validation.metrics.riverCount}, roads=${validation.metrics.roadCount}, bridges=${validation.metrics.bridgeCount}, objectives=${terrain.objectives.length}`);
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
