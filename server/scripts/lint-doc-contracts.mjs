#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const docsRoot = path.join(repoRoot, 'New Direction Docs');

const files = {
  contracts: path.join(docsRoot, 'AUTHORITATIVE_CONTRACTS.md'),
  missionGeneration: path.join(docsRoot, 'MISSION_GENERATION.md'),
  campaignPersistence: path.join(docsRoot, 'CAMPAIGN_PERSISTENCE.md'),
  missionLifecycle: path.join(docsRoot, 'MISSION_LIFECYCLE.md'),
  runtimeUnitState: path.join(docsRoot, 'RUNTIME_UNIT_STATE.md'),
  networkProtocol: path.join(docsRoot, 'NETWORK_PROTOCOL.md'),
  serverGameLoop: path.join(docsRoot, 'SERVER_GAME_LOOP.md'),
  deploymentPhase: path.join(docsRoot, 'DEPLOYMENT_PHASE.md'),
  postMissionResolution: path.join(docsRoot, 'POST_MISSION_RESOLUTION.md'),
  simulationTime: path.join(docsRoot, 'Simulation Time Model.md'),
  gameSystems: path.join(docsRoot, 'Game Systems Overview.md'),
  designOverview: path.join(docsRoot, 'DESIGN_OVERVIEW.md'),
  theaterSupport: path.join(docsRoot, 'THEATER_SUPPORT.md'),
};

const errors = [];

async function read(name) {
  return readFile(files[name], 'utf8');
}

function fail(msg) {
  errors.push(msg);
}

function expectContains(content, regex, fileLabel, reason) {
  if (!regex.test(content)) {
    fail(`${fileLabel}: missing required pattern (${reason})`);
  }
}

function expectNotContains(content, regex, fileLabel, reason) {
  if (regex.test(content)) {
    fail(`${fileLabel}: forbidden pattern present (${reason})`);
  }
}

async function main() {
  const c = await read('contracts');
  const mg = await read('missionGeneration');
  const cp = await read('campaignPersistence');
  const ml = await read('missionLifecycle');
  const ru = await read('runtimeUnitState');
  const np = await read('networkProtocol');
  const sg = await read('serverGameLoop');
  const dp = await read('deploymentPhase');
  const pm = await read('postMissionResolution');
  const st = await read('simulationTime');
  const gs = await read('gameSystems');
  const dv = await read('designOverview');
  const th = await read('theaterSupport');

  // Canonical contract presence
  expectContains(c, /type MissionType\s*=\s*[\s\S]*fortification_assault[\s\S]*logistics/s, 'AUTHORITATIVE_CONTRACTS.md', 'canonical MissionType list');
  expectContains(c, /DISCONNECT_GRACE_TICKS\s*=\s*6000/, 'AUTHORITATIVE_CONTRACTS.md', 'disconnect grace tick constant');
  expectContains(c, /SNAPSHOT_INTERVAL_SEC\s*=\s*60/, 'AUTHORITATIVE_CONTRACTS.md', 'snapshot interval constant');
  expectContains(c, /phase to wire mapping|required mapping/i, 'AUTHORITATIVE_CONTRACTS.md', 'phase mapping section');

  // Core docs must reference authoritative contracts
  for (const [label, content] of [
    ['MISSION_GENERATION.md', mg],
    ['CAMPAIGN_PERSISTENCE.md', cp],
    ['MISSION_LIFECYCLE.md', ml],
    ['RUNTIME_UNIT_STATE.md', ru],
    ['NETWORK_PROTOCOL.md', np],
    ['SERVER_GAME_LOOP.md', sg],
    ['DEPLOYMENT_PHASE.md', dp],
    ['POST_MISSION_RESOLUTION.md', pm],
    ['Simulation Time Model.md', st],
    ['Game Systems Overview.md', gs],
  ]) {
    expectContains(content, /AUTHORITATIVE_CONTRACTS\.md/, label, 'reference to canonical contracts');
  }

  // Deprecated mission taxonomy must not remain in operational schemas/tables
  const deprecatedMissionTypes = /\bassault\b|\bambush\b|\bextraction\b|\bsupply_raid\b|\bemergency_defense\b/;
  expectNotContains(cp, deprecatedMissionTypes, 'CAMPAIGN_PERSISTENCE.md', 'deprecated mission types in persistence schema');
  expectNotContains(pm, deprecatedMissionTypes, 'POST_MISSION_RESOLUTION.md', 'deprecated mission types in reward/influence tables');

  // Difficulty schema normalization
  expectContains(cp, /difficulty:\s*DifficultyTier/, 'CAMPAIGN_PERSISTENCE.md', 'difficulty tier field in MissionInstance');
  expectContains(cp, /difficulty_tier\s+TEXT\s+NOT\s+NULL/, 'CAMPAIGN_PERSISTENCE.md', 'difficulty_tier SQL column');
  expectNotContains(cp, /difficultyRating|difficulty_rating/, 'CAMPAIGN_PERSISTENCE.md', 'legacy difficulty fields');

  // Disconnect contract alignment
  expectContains(ru, /DISCONNECT_GRACE_TICKS\s*=\s*6000/, 'RUNTIME_UNIT_STATE.md', 'runtime disconnect constant');
  expectContains(ml, /DISCONNECT_GRACE_TICKS\s*=\s*6000/, 'MISSION_LIFECYCLE.md', 'lifecycle disconnect constant');
  expectContains(np, /DISCONNECT_GRACE_TICKS\s*=\s*6000|5-minute|5 minutes/, 'NETWORK_PROTOCOL.md', 'network disconnect semantics aligned to canonical grace window');
  expectNotContains(np, /120\s*seconds\s*\(grace period\)|120-second reconnect grace|AI-controlled \(hold position, return fire\)/i, 'NETWORK_PROTOCOL.md', 'obsolete disconnect behavior in network protocol');
  expectContains(sg, /per-player disconnect grace timers are active \(5 minutes each\)/, 'SERVER_GAME_LOOP.md', 'all-disconnect loop semantics');
  expectNotContains(sg, /PAUSED\s+after\s+a\s+30-second\s+grace/i, 'SERVER_GAME_LOOP.md', 'obsolete pause-on-disconnect behavior');

  // Snapshot cadence alignment
  expectContains(ru, /default:\s*every\s*60\s*seconds/i, 'RUNTIME_UNIT_STATE.md', 'runtime snapshot cadence');
  expectContains(sg, /every\s*\*\*60\s*seconds\*\*/i, 'SERVER_GAME_LOOP.md', 'loop snapshot cadence');
  expectContains(np, /\| `TICK_UPDATE` \| `TickUpdatePayload` \| Every second \(1 Hz\) \|/, 'NETWORK_PROTOCOL.md', 'network tick update frequency');
  expectNotContains(np, /Every tick \(20 Hz\)|20\/sec \(every tick\)|every tick \(20 Hz \/ 50ms\)/i, 'NETWORK_PROTOCOL.md', 'obsolete per-tick TICK_UPDATE cadence');

  // Joinability alignment
  expectContains(ml, /Joinable active\" means phase `DEPLOYMENT` or `LIVE` only/, 'MISSION_LIFECYCLE.md', 'joinability definition');
  expectContains(mg, /joinable \(state = DEPLOYMENT or LIVE, participants < 4\)/, 'MISSION_GENERATION.md', 'mission generation joinability definition');

  // Phase mapping alignment
  expectContains(np, /Mapping note:/, 'NETWORK_PROTOCOL.md', 'internal/wire phase mapping note');

  // Grid authority alignment
  expectContains(dv, /Resolved: continuous world-space simulation with a logical overlay grid\./, 'DESIGN_OVERVIEW.md', 'resolved grid model');
  expectContains(dp, /references to \"hex\" in this document mean logical overlay cells/, 'DEPLOYMENT_PHASE.md', 'hex compatibility note');

  // Air delay alignment
  expectContains(gs, /strike-type specific/i, 'Game Systems Overview.md', 'air delay semantics');
  expectContains(st, /Strike-type delay from theater support table/i, 'Simulation Time Model.md', 'air delay semantics');
  expectContains(th, /\| \*\*Fighter-Bomber\*\* \| 1 \|[\s\S]*\| 15s \|/s, 'THEATER_SUPPORT.md', 'source delay table expected format');

  if (errors.length > 0) {
    console.error('Doc contract lint failed with the following issues:\n');
    for (const issue of errors) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log('Doc contract lint passed. All enforced cross-doc contracts are consistent.');
}

main().catch((err) => {
  console.error('Doc contract lint crashed:', err);
  process.exit(1);
});
