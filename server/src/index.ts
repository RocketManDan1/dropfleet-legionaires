import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTerrain, TerrainData } from './terrain.js';
import { parseGenerateRequest } from './protocol.js';
import { validateTerrainData } from './validation.js';
import {
  type AmmoState,
  type MissionStateFullPayload,
  type MoveMode,
  type ResolvedOrder,
  type UnitInstance,
} from '@legionaires/shared';
import { createPlayerConnection, GameSession } from './game/session.js';
import { loadAllFactions } from './data/csv-loader.js';
import { UnitRegistry } from './data/unit-registry.js';
import {
  filterContactsForPlayer,
  filterUnitsForPlayer,
  parseClientMessage,
  serializeServerMessage,
} from './network/protocol.js';

const PORT = 3000;
// Generate terrain once at startup
console.log('Generating terrain...');
let terrain: TerrainData = generateTerrain(512, 512);
console.log(`Terrain generated: ${terrain.width}x${terrain.height}, biome: ${terrain.biome}, sea level: ${terrain.seaLevel}, towns: ${terrain.towns.length}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const unitTypeRegistry = new UnitRegistry();
const allUnitTypes = await loadAllFactions(
  path.join(repoRoot, 'New Direction Docs'),
  path.join(repoRoot, 'Unit Testing'),
);
unitTypeRegistry.load(allUnitTypes);
console.log(`Loaded ${unitTypeRegistry.size} unit types`);

const session = new GameSession(
  'm2-skirmish-sandbox',
  terrain,
  {
    opticalVisibilityM: 3000,
    thermalVisibilityM: 4000,
    missionType: 'defend',
    timeLimitSec: 1800,
    mapSeed: Date.now(),
  },
  unitTypeRegistry,
);
session.setPhase('live');
session.getTickLoop().start();

let connectedPlayerCount = 0;
let unitOrdinal = 0;

function createAmmoForUnit(unitTypeId: string): [AmmoState, AmmoState, AmmoState, AmmoState] {
  const type = unitTypeRegistry.get(unitTypeId);
  const empty: AmmoState = { he: 0, ap: 0, heat: 0, sabot: 0 };
  if (!type) {
    return [empty, empty, empty, empty];
  }

  const slots = type.weapons.map((w) => ({
    he: w?.ammoHE ?? 0,
    ap: w?.ammoAP ?? 0,
    heat: w?.ammoHEAT ?? 0,
    sabot: w?.ammoSabot ?? 0,
  }));
  while (slots.length < 4) slots.push({ ...empty });
  return [slots[0], slots[1], slots[2], slots[3]];
}

function createSandboxUnit(playerId: string, x: number, z: number): UnitInstance {
  const template = unitTypeRegistry.getByFactionId('federation')[0] ?? allUnitTypes[0];
  const unitId = `unit_${playerId}_${unitOrdinal++}`;

  return {
    instanceId: unitId,
    unitTypeId: template.id,
    ownerId: playerId,
    platoonId: `platoon_${playerId}`,
    callsign: `ALPHA-${unitOrdinal}`,
    posX: x,
    posZ: z,
    heading: 0,
    turretHeading: 0,
    speedState: 'full_halt',
    moveMode: 'advance',
    currentPath: null,
    pathIndex: 0,
    recentDistanceM: 0,
    stoppedForSec: 0,
    currentOrder: null,
    orderQueue: [],
    isOrderComplete: true,
    crewCurrent: template.maxCrew,
    crewMax: template.maxCrew,
    isDestroyed: false,
    isBailedOut: false,
    isImmobilized: false,
    steelArmour: { ...template.steelArmour },
    heatArmour: { ...template.heatArmour },
    eraRemaining: { ...template.eraLevel },
    ammo: createAmmoForUnit(template.id),
    weaponCooldowns: [0, 0, 0, 0],
    lastFireTick: 0,
    firedThisTick: false,
    firePosture: 'return_fire',
    maxEngageRangeM: 2500,
    currentTargetId: null,
    engageSlotOverride: null,
    suppressionLevel: 0,
    moraleState: 'normal',
    lastRalliedAtTick: -999,
    transportedBy: null,
    passengers: [],
    altitudeState: null,
    altitudeTransitioning: false,
    altitudeTransitionTimer: 0,
    isEntrenched: false,
    entrenchProgress: 0,
    ewCharges: template.ew,
    smokeRemaining: template.smokeDischargers,
    supplyCheckTimer: 0,
    isBeingResupplied: false,
    detectionAccumulators: new Map(),
    experience: 70,
    camouflageModifier: 1,
    spawnTick: session.getTickLoop().getCurrentTick(),
    lastMoveTick: session.getTickLoop().getCurrentTick(),
    destroyedAtTick: null,
  };
}

function buildMissionSnapshotFor(playerId: string): MissionStateFullPayload {
  const units = filterUnitsForPlayer(
    playerId,
    session.getUnitRegistry(),
    session.getContactMap().get(playerId) ?? new Map(),
  );

  const contacts = filterContactsForPlayer(session.getContactMap().get(playerId) ?? new Map());
  const score = session.getScore();

  return {
    missionId: session.sessionId,
    missionType: 'defend',
    difficulty: 'easy',
    phase: 'live',
    missionTimeSec: session.getTickLoop().getCurrentTick() / 20,
    timeLimitSec: 1800,
    mapWidth: terrain.width,
    mapHeight: terrain.height,
    units,
    contacts,
    objectives: [],
    theaterSupport: {
      artilleryRemaining: 0,
      airStrikesRemaining: 0,
      orbitalRemaining: 0,
      activeStrikes: [],
    },
    players: session.getConnectedPlayers().map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      battalionName: p.battalionId,
      isConnected: p.isConnected,
      unitCount: [...session.getUnitRegistry().values()].filter((u) => u.ownerId === p.playerId).length,
    })),
    score: {
      enemiesDestroyed: score.enemiesDestroyed,
      friendlyCasualties: score.friendlyCasualties,
      objectivesCompleted: score.objectivesCompleted,
      objectivesTotal: score.objectivesTotal,
    },
  };
}

function mapMoveOrderToMode(orderType: string, moveMode?: MoveMode): MoveMode {
  if (moveMode) return moveMode;
  if (orderType === 'move_fast') return 'march';
  if (orderType === 'reverse') return 'reverse';
  return 'advance';
}

const wss = new WebSocketServer({ port: PORT });

type AliveSocket = WebSocket & { isAlive?: boolean };

const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    const socket = client as AliveSocket;
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');
  const aliveSocket = ws as AliveSocket;
  aliveSocket.isAlive = true;
  ws.on('pong', () => {
    aliveSocket.isAlive = true;
  });
  const playerId = `player_${++connectedPlayerCount}`;
  const playerName = `Player ${connectedPlayerCount}`;
  const battalionId = `battalion_${connectedPlayerCount}`;
  const playerConn = createPlayerConnection(playerId, playerName, battalionId, ws);
  session.addPlayer(playerConn);

  const baseX = terrain.width / 2 + connectedPlayerCount * 25;
  const baseZ = terrain.height / 2 + connectedPlayerCount * 25;
  session.spawnUnit(createSandboxUnit(playerId, baseX, baseZ));

  // Send terrain data to new client
  ws.send(JSON.stringify({
    type: 'terrain',
    data: terrain,
  }));

  ws.send(
    serializeServerMessage(
      { type: 'MISSION_STATE_FULL', payload: buildMissionSnapshotFor(playerId) },
      session.getTickLoop().getCurrentTick(),
    ),
  );

  ws.on('message', (raw: Buffer) => {
    const rawText = raw.toString();
    try {
      const msg = JSON.parse(rawText);
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

      const parsed = parseClientMessage(rawText);
      if (!parsed) {
        return;
      }

      if (parsed.type === 'PING') {
        ws.send(
          serializeServerMessage(
            {
              type: 'PONG',
              payload: {
                clientTime: parsed.payload.clientTime,
                serverTime: Date.now(),
                serverTick: session.getTickLoop().getCurrentTick(),
              },
            },
            session.getTickLoop().getCurrentTick(),
          ),
        );
      }

      if (parsed.type === 'AUTH') {
        ws.send(
          serializeServerMessage(
            {
              type: 'AUTH_RESULT',
              payload: {
                success: true,
                playerId,
                playerName,
              },
            },
            session.getTickLoop().getCurrentTick(),
          ),
        );
      }

      if (parsed.type === 'JOIN_MISSION') {
        ws.send(
          serializeServerMessage(
            {
              type: 'MISSION_STATE_FULL',
              payload: buildMissionSnapshotFor(playerId),
            },
            session.getTickLoop().getCurrentTick(),
          ),
        );
      }

      if (parsed.type === 'ORDER') {
        const order: ResolvedOrder & { unitId: string } = {
          unitId: parsed.payload.unitId,
          type: parsed.payload.orderType,
          targetPos: parsed.payload.targetPos,
          targetUnitId: parsed.payload.targetUnitId,
          weaponSlot: parsed.payload.weaponSlot,
          posture: parsed.payload.posture,
          moveMode: mapMoveOrderToMode(parsed.payload.orderType, parsed.payload.moveMode),
        };
        playerConn.orderBuffer.push(order);
      }

      if (parsed.type === 'DEPLOY_READY') {
        playerConn.readyForDeployment = true;
      }

      if (parsed.type === 'DISCONNECT_GRACEFUL') {
        ws.close();
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    session.removePlayer(playerId);
    console.log('Client disconnected');
  });
});

console.log(`Game server listening on ws://0.0.0.0:${PORT}`);
