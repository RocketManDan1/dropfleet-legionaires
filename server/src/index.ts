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
  type FactionId,
  type MissionType,
  type DifficultyTier,
  type DeploymentZonePayload,
  type ObjectiveSnapshot,
  TICKS_PER_SEC,
  DEPLOYMENT_TIMER_SEC,
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
import { MissionLifecycle } from './mission/lifecycle.js';
import { DeploymentManager } from './mission/deployment.js';
import { ObjectiveTracker } from './mission/objectives.js';
import { generateMission } from './mission/mission-gen.js';
import { StrategicAI } from './ai/strategic.js';
import { PlatoonBehaviorTree } from './ai/platoon-bt.js';
import { InfluenceMapManager } from './ai/influence-map.js';

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

// ---------------------------------------------------------------------------
// M3: Mission configuration
// ---------------------------------------------------------------------------
const MISSION_TYPE: MissionType = 'defend';
const MISSION_DIFFICULTY: DifficultyTier = 'easy';
const ENEMY_FACTION: FactionId = 'ataxian';

// ---------------------------------------------------------------------------
// Create session with M3 lifecycle
// ---------------------------------------------------------------------------
const session = new GameSession(
  `m3-mission-${Date.now().toString(36)}`,
  terrain,
  {
    opticalVisibilityM: 3000,
    thermalVisibilityM: 4000,
    missionType: MISSION_TYPE,
    timeLimitSec: 1800,
    mapSeed: Date.now(),
  },
  unitTypeRegistry,
);

// M3: Initialize lifecycle (mission starts in 'created', transitions when first player joins)
const lifecycle = new MissionLifecycle(session.sessionId, MISSION_TYPE, MISSION_DIFFICULTY, 1200);
session.setLifecycle(lifecycle);
session.setMissionType(MISSION_TYPE);
session.setMissionDifficulty(MISSION_DIFFICULTY);
session.setAiFactionId(ENEMY_FACTION);

// M3: Generate mission — enemy forces, objectives, deployment zones
const missionGen = generateMission(
  MISSION_TYPE,
  MISSION_DIFFICULTY,
  ENEMY_FACTION,
  terrain,
  unitTypeRegistry,
  0, // spawnTick — enemies spawn at tick 0
);
console.log(`Mission generated: ${missionGen.enemyUnits.length} enemy units, ${missionGen.objectives.length} objectives`);

// M3: Initialize deployment manager
const deploymentMgr = new DeploymentManager();
deploymentMgr.generateZone(
  terrain.width,
  terrain.height,
  1,
  MISSION_TYPE,
  missionGen.deploymentZoneCenter ? { x: missionGen.deploymentZoneCenter.x, z: missionGen.deploymentZoneCenter.z } : undefined,
  terrain.terrainTypeMap,
  terrain.heightmap,
  terrain.seaLevel,
);
session.setDeploymentManager(deploymentMgr);

// M3: Initialize objective tracker
const objTracker = new ObjectiveTracker();
objTracker.setAiFactionId(ENEMY_FACTION);
objTracker.setMissionType(MISSION_TYPE);
objTracker.init(missionGen.objectives);
for (const [objId, targets] of missionGen.destroyTargets) {
  objTracker.setDestroyTargets(objId, targets);
}
session.setObjectiveTracker(objTracker);

// M3: Initialize AI systems
const strategicAI = new StrategicAI(ENEMY_FACTION as FactionId);
session.setStrategicAI(strategicAI);

const platoonBT = new PlatoonBehaviorTree();
session.setPlatoonBT(platoonBT);

const influenceMapMgr = new InfluenceMapManager(terrain.width, terrain.height);
session.setInfluenceMapManager(influenceMapMgr);

// M3: Spawn enemy units and register platoons
for (const unit of missionGen.enemyUnits) {
  session.spawnUnit(unit);
}
for (const platoon of missionGen.enemyPlatoons) {
  session.getPlatoons().set(platoon.platoonId, platoon);
}
console.log(`Enemy forces spawned: ${missionGen.enemyPlatoons.length} platoons`);

// Start the tick loop — phase transitions are handled by lifecycle state machine
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

/** Create a player unit for deployment. */
function createPlayerUnit(playerId: string, unitTypeId: string, x: number, z: number): UnitInstance {
  const template = unitTypeRegistry.get(unitTypeId) ?? unitTypeRegistry.getByFactionId('federation')[0] ?? allUnitTypes[0];
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
    maxEngageRangeM: Math.max(
      ...template.weapons.filter(Boolean).map(w => w!.rangeM),
      1000,
    ),
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
    unitTypeRegistry,
  );

  const contacts = filterContactsForPlayer(session.getContactMap().get(playerId) ?? new Map());
  const score = session.getScore();
  const lc = session.getLifecycle();

  // Map internal phase to wire phase
  const phaseMap: Record<string, string> = {
    created: 'briefing', deployment: 'deployment', live: 'live',
    extraction: 'extraction', aar: 'ended', closed: 'ended',
  };
  const wirePhase = (phaseMap[session.getPhase()] ?? 'briefing') as any;

  return {
    missionId: session.sessionId,
    missionType: MISSION_TYPE,
    difficulty: MISSION_DIFFICULTY,
    phase: wirePhase,
    missionTimeSec: session.getTickLoop().getCurrentTick() / TICKS_PER_SEC,
    timeLimitSec: 1200,
    mapWidth: terrain.width,
    mapHeight: terrain.height,
    units,
    contacts,
    objectives: session.getObjectives().map((o): ObjectiveSnapshot => ({
      objectiveId: o.objectiveId,
      name: o.name,
      type: o.type,
      posX: o.posX,
      posZ: o.posZ,
      radius: o.radius,
      status: o.isCompleted ? 'complete' : 'incomplete',
      progress: o.progress,
    })),
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

/** Build deployment zone payload for client. */
function buildDeploymentZone(): DeploymentZonePayload {
  const dm = session.getDeploymentManager();
  const zone = dm ? (dm as any).zone : null;

  if (!zone) {
    return {
      vertices: [
        { x: terrain.width * 0.25, z: terrain.height * 0.05 },
        { x: terrain.width * 0.75, z: terrain.height * 0.05 },
        { x: terrain.width * 0.75, z: terrain.height * 0.25 },
        { x: terrain.width * 0.25, z: terrain.height * 0.25 },
      ],
      timeRemainingSec: DEPLOYMENT_TIMER_SEC,
      reserveSlots: 0,
    };
  }

  return {
    vertices: zone.vertices,
    timeRemainingSec: DEPLOYMENT_TIMER_SEC,
    reserveSlots: 0,
  };
}

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

  // M3: Spawn a player unit near deployment zone (will be placed during deployment)
  const depCenter = missionGen.deploymentZoneCenter;
  const fedTypes = unitTypeRegistry.getByFactionId('federation');
  // Give each player a small force: 1 MBT + 1 IFV or 2 of whatever we have
  const playerTypes = fedTypes.length > 1 ? [fedTypes[0], fedTypes[1]] : [fedTypes[0], fedTypes[0]];
  if (playerTypes[0]) {
    for (let i = 0; i < playerTypes.length; i++) {
      const t = playerTypes[i];
      if (!t) continue;
      const unit = createPlayerUnit(playerId, t.id, depCenter.x + i * 25, depCenter.z + i * 25);
      session.spawnUnit(unit);
    }
  }

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

  // M3: Send deployment zone if in deployment phase
  const phase = session.getPhase();
  if (phase === 'deployment' || phase === 'created') {
    ws.send(
      serializeServerMessage(
        { type: 'DEPLOYMENT_ZONE', payload: buildDeploymentZone() },
        session.getTickLoop().getCurrentTick(),
      ),
    );
  }

  // M3: Send current phase
  const wirePhaseMap: Record<string, string> = {
    created: 'briefing', deployment: 'deployment', live: 'live',
    extraction: 'extraction', aar: 'ended', closed: 'ended',
  };
  ws.send(
    serializeServerMessage(
      {
        type: 'MISSION_PHASE',
        payload: {
          phase: (wirePhaseMap[phase] ?? 'briefing') as any,
          missionTimeSec: session.getTickLoop().getCurrentTick() / TICKS_PER_SEC,
        },
      },
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

      if (msg.type === 'DEV_QUERY_ENEMIES') {
        const units = Array.from(session.getUnitRegistry().values())
          .filter((u) => u.ownerId !== playerId && !u.isDestroyed)
          .map((u) => ({ unitId: u.instanceId, posX: u.posX, posZ: u.posZ }));

        ws.send(
          serializeServerMessage(
            {
              type: 'DEV_ENEMY_POSITIONS' as any,
              payload: { units },
            } as any,
            session.getTickLoop().getCurrentTick(),
          ),
        );
      }

      // --- DEV: Spawn a random enemy unit at a given position ---
      if (msg.type === 'DEV_SPAWN_ENEMY') {
        const { posX, posZ, faction } = msg.payload ?? {} as { posX?: number; posZ?: number; faction?: string };
        if (typeof posX !== 'number' || typeof posZ !== 'number') return;

        const factionId = (faction === 'khroshi' ? 'khroshi' : 'ataxian') as FactionId;
        const factionTypes = unitTypeRegistry.getByFactionId(factionId);
        if (factionTypes.length === 0) return;

        const template = factionTypes[Math.floor(Math.random() * factionTypes.length)];
        const enemyId = `dev_enemy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

        const unit: UnitInstance = {
          instanceId: enemyId,
          unitTypeId: template.id,
          ownerId: ENEMY_FACTION,
          platoonId: `dev_platoon`,
          callsign: `DEV-${template.unitClass?.toUpperCase().slice(0, 3) ?? 'UNK'}`,
          posX,
          posZ,
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
          firePosture: 'free_fire',
          maxEngageRangeM: Math.max(
            ...template.weapons.filter(Boolean).map(w => w!.rangeM),
            1000,
          ),
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

        session.spawnUnit(unit);
        console.log(`[DEV] Spawned ${template.name} (${factionId}) at (${posX.toFixed(0)}, ${posZ.toFixed(0)})`);

        ws.send(
          serializeServerMessage(
            {
              type: 'DEV_SPAWN_RESULT' as any,
              payload: { success: true, unitId: enemyId, unitTypeId: template.id, name: template.name, faction: factionId, posX, posZ },
            } as any,
            session.getTickLoop().getCurrentTick(),
          ),
        );
      }

      if (msg.type === 'UNDEPLOY_UNIT') {
        const dm = session.getDeploymentManager();
        const unitId = msg?.payload?.unitId as string | undefined;

        const sendUndeployResult = (success: boolean, reason?: string): void => {
          ws.send(
            serializeServerMessage(
              {
                type: 'UNDEPLOY_UNIT_RESULT' as any,
                payload: { unitId, success, reason },
              } as any,
              session.getTickLoop().getCurrentTick(),
            ),
          );
        };

        if (!unitId) {
          sendUndeployResult(false, 'UNIT_ID_REQUIRED');
          return;
        }
        if (!dm) {
          sendUndeployResult(false, 'NO_DEPLOYMENT_MANAGER');
          return;
        }
        if (!(session.getPhase() === 'deployment' || session.getPhase() === 'created')) {
          sendUndeployResult(false, 'PHASE_WRONG');
          return;
        }

        const targetUnit = session.getUnitRegistry().get(unitId);
        if (!targetUnit) {
          sendUndeployResult(false, 'UNIT_NOT_FOUND');
          return;
        }
        if (targetUnit.ownerId !== playerId) {
          sendUndeployResult(false, 'UNIT_NOT_OWNED');
          return;
        }
        if (!dm.hasPlacedUnit(unitId)) {
          sendUndeployResult(false, 'UNIT_NOT_DEPLOYED');
          return;
        }

        dm.removeUnit(unitId);
        session.getSpatialHash().remove(unitId);
        sendUndeployResult(true);
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
        const unitId = parsed.payload.unitId;
        const orderId = `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const targetUnit = session.getUnitRegistry().get(unitId);

        // Validate order ownership and state
        let rejectReason: string | null = null;
        if (!targetUnit) {
          rejectReason = 'UNIT_NOT_FOUND';
        } else if (targetUnit.ownerId !== playerId) {
          rejectReason = 'UNIT_NOT_OWNED';
        } else if (targetUnit.isDestroyed) {
          rejectReason = 'UNIT_DESTROYED';
        } else if (targetUnit.moraleState === 'surrendered' && parsed.payload.orderType !== 'cancel') {
          rejectReason = 'UNIT_SURRENDERED';
        }

        if (rejectReason) {
          ws.send(
            serializeServerMessage(
              { type: 'ORDER_ACK', payload: { orderId, unitId, status: 'REJECTED', reason: rejectReason } },
              session.getTickLoop().getCurrentTick(),
            ),
          );
        } else {
          const order: ResolvedOrder & { unitId: string } = {
            unitId,
            type: parsed.payload.orderType,
            targetPos: parsed.payload.targetPos,
            targetUnitId: parsed.payload.targetUnitId,
            weaponSlot: parsed.payload.weaponSlot,
            posture: parsed.payload.posture,
            moveMode: mapMoveOrderToMode(parsed.payload.orderType, parsed.payload.moveMode),
          };
          playerConn.orderBuffer.push(order);

          ws.send(
            serializeServerMessage(
              { type: 'ORDER_ACK', payload: { orderId, unitId, status: 'ACCEPTED' } },
              session.getTickLoop().getCurrentTick(),
            ),
          );
        }
      }

      if (parsed.type === 'DEPLOY_READY') {
        playerConn.readyForDeployment = true;
      }

      if (parsed.type === 'AAR_ACK') {
        playerConn.acknowledgedAAR = true;
      }

      if (parsed.type === 'DEPLOY_UNIT') {
        const dm = session.getDeploymentManager();
        const sendDeployResult = (
          unitId: string,
          success: boolean,
          reason?: string,
          posX?: number,
          posZ?: number,
        ): void => {
          ws.send(
            serializeServerMessage(
              {
                type: 'DEPLOY_UNIT_RESULT',
                payload: { unitId, success, reason, posX, posZ },
              },
              session.getTickLoop().getCurrentTick(),
            ),
          );
        };

        const { unitId, posX, posZ } = parsed.payload as { unitId: string; posX: number; posZ: number; heading: number };

        if (!dm) {
          sendDeployResult(unitId, false, 'NO_DEPLOYMENT_MANAGER');
          return;
        }

        if (!(session.getPhase() === 'deployment' || session.getPhase() === 'created')) {
          sendDeployResult(unitId, false, 'PHASE_WRONG');
          return;
        }

        const targetUnit = session.getUnitRegistry().get(unitId);
        if (!targetUnit) {
          sendDeployResult(unitId, false, 'UNIT_NOT_FOUND');
          return;
        }

        if (targetUnit.ownerId !== playerId) {
          sendDeployResult(unitId, false, 'UNIT_NOT_OWNED');
          return;
        }

        const result = dm.placeUnit(unitId, { x: posX, z: posZ });
        if (!result.success) {
          sendDeployResult(unitId, false, result.reason);
          return;
        }

        targetUnit.posX = posX;
        targetUnit.posZ = posZ;
        session.getSpatialHash().insert(unitId, posX, posZ);
        sendDeployResult(unitId, true, undefined, posX, posZ);
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
