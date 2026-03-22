export interface Vec2 {
    x: number;
    z: number;
}
export type FactionId = 'federation' | 'ataxian' | 'khroshi';
export type MissionType = 'defend' | 'seize' | 'raid' | 'patrol' | 'rescue' | 'breakthrough' | 'evacuation' | 'hive_clear' | 'fortification_assault' | 'logistics';
export type DifficultyTier = 'easy' | 'medium' | 'hard';
export type MissionPhaseInternal = 'created' | 'deployment' | 'live' | 'extraction' | 'aar' | 'closed';
export type MissionPhaseWire = 'briefing' | 'deployment' | 'live' | 'extraction' | 'ended';
export type MoveClass = 'track' | 'wheel' | 'leg' | 'hover' | 'air';
export type SpeedState = 'full_halt' | 'short_halt' | 'slow' | 'fast';
export type MoveMode = 'advance' | 'march' | 'reverse';
export type SensorTier = 'optical' | 'thermal' | 'radar';
export type MoraleState = 'normal' | 'pinned' | 'routing' | 'surrendered';
export type FirePosture = 'free_fire' | 'return_fire' | 'hold_fire';
export type ContactTier = 'SUSPECTED' | 'DETECTED' | 'CONFIRMED' | 'LOST';
export type UnitClass = 'mbt' | 'ifv' | 'apc' | 'scout' | 'at_vehicle' | 'aa_vehicle' | 'arty_sp' | 'arty_towed' | 'mortar' | 'support' | 'supply' | 'infantry' | 'at_infantry' | 'aa_infantry' | 'engineer' | 'sniper' | 'hq' | 'helicopter_attack' | 'helicopter_transport' | 'fixed_wing';
export type WeightClass = 'light' | 'medium' | 'heavy' | 'very_heavy';
export type TraverseType = 'turret' | 'hull' | 'fixed';
export type AltitudeState = 'landed' | 'low' | 'high';
export type MissionOutcome = 'victory' | 'defeat' | 'draw';
export type GameEventType = 'UNIT_DESTROYED' | 'UNIT_ROUTING' | 'UNIT_SURRENDERED' | 'SHOT_FIRED' | 'SHOT_IMPACT' | 'ARTY_IMPACT' | 'SMOKE_CREATED' | 'OBJECTIVE_CAPTURED';
