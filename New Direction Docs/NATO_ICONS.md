# NATO Icon System
*Federation Legionaires — authoritative unit icon specification*
*Last updated: 2026-03-22*

---

## 1. Overview

Units are displayed on the tactical map as **NATO-style military symbols**
rendered in real time via Canvas2D, then uploaded as `THREE.CanvasTexture`
billboards in the 3D scene. The system uses the `milsymbol` library (MIT
license) as the baseline generator, with per-faction overrides for frame shape,
color, and inner icon treatment.

### 1.1 Design Principles

1. **Faction at a glance.** A player must distinguish Ataxian from Khroshi
   from the frame shape alone, without reading labels or tooltips. Diamond
   vs hexagon is the primary discriminator.

2. **Detection drives detail.** Icon complexity increases with contact tier.
   SUSPECTED = vague blip. DETECTED = category shape in faction frame.
   CONFIRMED = full type symbol with label. LOST = fading ghost.

3. **DRONECOM palette.** Icons use faction colors on a near-black background.
   No gradients, no drop shadows, no 3D bevels. Flat geometry with optional
   additive glow for command units.

4. **No textures.** All icons are drawn procedurally in Canvas2D at runtime.
   No sprite sheets, no PNGs, no SVG files embedded in the build.

---

## 2. Dependencies

```
npm install milsymbol
```

`milsymbol` generates APP-6D compliant SVG symbol markup from SIDC (Symbol
Identification Coding) strings. The game uses it as a starting point, then
applies faction overrides before rasterizing to canvas.

### 2.1 Integration

```typescript
import { ms } from 'milsymbol';

function generateSymbol(sidc: string, options: SymbolOptions): HTMLCanvasElement {
  const symbol = new ms.Symbol(sidc, {
    size: options.size ?? 40,
    frame: true,
    fill: true,
    colorMode: options.colorMode,    // faction-specific color override
    ...options.milsymbolOverrides,
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // milsymbol renders to SVG; we draw it to canvas
  const svg = symbol.asSVG();
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // After load, apply faction post-processing (frame override, glow, etc.)
  return canvas;
}
```

For Ataxian units, the milsymbol diamond frame is replaced post-render with
the custom hexagonal frame (see §4.2).

---

## 3. Affiliation Colors

### 3.1 Faction Color Palette

| Affiliation | Frame Color | Fill Color | Text Color | Hex (Frame) |
|-------------|------------|------------|------------|-------------|
| **Friendly (Terran)** | Blue | Light blue fill | White | `#4080FF` |
| **Khroshi Syndicalists** | Cool red-purple | Dark red-purple fill | White | `#C03050` |
| **Ataxian Hive** | Warm red-orange | Dark red-orange fill | White | `#E04020` |
| **Unknown / Unidentified** | Amber | Dark amber fill | White | `#D09020` |
| **Neutral** | Green | Light green fill | Black | `#40C040` |

### 3.2 Color Integration with Existing Systems

These colors align with the established DRONECOM UI palette:

| System | Friendly | Hostile (general) | Unknown |
|--------|----------|-------------------|---------|
| Existing UI spec | `#40C040` green | `#E04030` red-orange | `#D09020` amber |
| Sector map (Khroshi) | — | `purple / violet hatch` | — |
| Sector map (Ataxian) | — | `crimson hatch` | — |

The hostile red is now split into two temperature variants that match the
sector map coding players already see in the campaign layer. Khroshi icons
feel "colder" (purple-shifted), Ataxian icons feel "hotter" (orange-shifted).

### 3.3 milsymbol Color Mode Override

```typescript
const TERRAN_COLORS = {
  iconColor: '#FFFFFF',
  iconFillColor: '#4080FF',
  iconEnclosure: '#4080FF',
};

const KHROSHI_COLORS = {
  iconColor: '#FFFFFF',
  iconFillColor: '#C03050',
  iconEnclosure: '#C03050',
};

const ATAXIAN_COLORS = {
  iconColor: '#FFFFFF',
  iconFillColor: '#E04020',
  iconEnclosure: '#E04020',
};

const UNKNOWN_COLORS = {
  iconColor: '#FFFFFF',
  iconFillColor: '#D09020',
  iconEnclosure: '#D09020',
};
```

---

## 4. Frame Shapes

### 4.1 Standard Frames (milsymbol default)

| Affiliation | APP-6D Frame | Shape |
|-------------|-------------|-------|
| Friendly | Rectangle | Standard milsymbol |
| Hostile | Diamond | Standard milsymbol |
| Unknown | Quatrefoil | Standard milsymbol |
| Neutral | Square | Standard milsymbol |

### 4.2 Faction Frame Overrides

| Faction | Frame Shape | Rendering |
|---------|------------|-----------|
| **Terran (Friendly)** | Rectangle | milsymbol default (no override) |
| **Khroshi** | Diamond | milsymbol default hostile frame (no override) |
| **Ataxian** | **Hexagon** | Custom post-render replacement |

The Khroshi use standard hostile diamonds because they *are* a conventional
military force — organized, disciplined, recognizable. The Ataxian hexagon is
a deliberate break from NATO convention that signals "alien threat" and
evokes a honeycomb / hive-cell motif.

#### 4.2.1 Hexagonal Frame Renderer

```typescript
function drawHexFrame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  lineWidth: number,
  strokeColor: string,
  fillColor: string,
  fillOpacity: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    // Flat-top hexagon: first vertex at 0° (right), then every 60°
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  // Fill
  ctx.globalAlpha = fillOpacity;
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Stroke
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}
```

#### 4.2.2 Frame Edge Treatment

| Faction | Edge Style | Implementation |
|---------|-----------|----------------|
| **Terran** | Clean, 2px solid | Default milsymbol |
| **Khroshi** | Clean, 2px solid | Default milsymbol diamond |
| **Ataxian** | Slightly irregular, 2px | Vertex positions jittered ±1px using a seeded hash of the unit ID. Subtle — reads as "organic" at close zoom, invisible at far zoom. |

```typescript
function jitterHexVertex(
  baseX: number, baseY: number,
  unitId: string, vertexIndex: number,
  amount: number
): [number, number] {
  // Deterministic jitter from unit ID — same unit always looks the same
  const hash = simpleHash(unitId + vertexIndex);
  const dx = ((hash & 0xFF) / 127.5 - 1.0) * amount;
  const dy = (((hash >> 8) & 0xFF) / 127.5 - 1.0) * amount;
  return [baseX + dx, baseY + dy];
}
```

---

## 5. Detection Tier Rendering

Icons evolve as the spotting system accumulates detection value on a contact.

### 5.1 SUSPECTED (detection 1–24)

The contact's faction may or may not be known depending on the mission context.
If the mission is against a known faction, the blip style hints at it.

| Context | Blip Style | Description |
|---------|-----------|-------------|
| **Unknown faction** | Amber `?` | Pulsing amber dot, standard |
| **Known Khroshi mission** | Angular bracket `⟨ ? ⟩` | Sharp geometric brackets around `?`, cool-red `#C03050` |
| **Known Ataxian mission** | Organic blob | Soft pulsing circle with radius oscillating ±15% at 0.8 Hz, warm-red `#E04020` |

```typescript
interface SuspectedBlip {
  position: Vec3;             // world position ± 50m jitter
  faction: Faction | null;    // null if truly unknown
  pulsePhase: number;         // animation state
  opacity: number;            // 0.4–0.8, pulses
}
```

**Canvas rendering (Ataxian blob example):**

```typescript
function drawAtaxianBlip(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  size: number, phase: number
): void {
  const pulse = 1.0 + 0.15 * Math.sin(phase * Math.PI * 2 * 0.8);
  const r = size * pulse;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#E04020';
  ctx.globalAlpha = 0.4 + 0.2 * Math.sin(phase * Math.PI * 2 * 0.8);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Question mark
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy);
}
```

### 5.2 DETECTED (detection 25–74)

Faction frame appears with a **category-level** inner symbol. The unit's
exact type is not yet known — only whether it's vehicle, infantry, or air.

| Category | Inner Symbol | Standard |
|----------|-------------|----------|
| Vehicle | Diagonal line (armored oval outline) | APP-6D land equipment |
| Infantry | Crossed infantry lines `×` | APP-6D land unit |
| Air | Flight symbol (wing shape) | APP-6D air |
| Unknown | `?` | No inner symbol |

Both Ataxian and Khroshi use the **same** standard category symbols at this
tier. The faction frame (diamond vs hexagon) and color temperature are the
only differentiators.

```typescript
function renderDetectedIcon(
  contact: Contact,
  faction: Faction
): HTMLCanvasElement {
  const canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d')!;
  const colors = FACTION_COLORS[faction];

  // Draw faction-specific frame
  if (faction === 'ataxian') {
    drawHexFrame(ctx, HALF, HALF, FRAME_RADIUS, 2, colors.frame, colors.fill, 0.3);
  } else {
    drawDiamondFrame(ctx, HALF, HALF, FRAME_RADIUS, 2, colors.frame, colors.fill, 0.3);
  }

  // Draw category symbol (same for all factions)
  drawCategorySymbol(ctx, HALF, HALF, contact.estimatedCategory, '#FFFFFF');

  return canvas;
}
```

### 5.3 CONFIRMED (detection 75–100)

Full NATO-standard type symbol for Khroshi. Modified symbols for Ataxian.

#### 5.3.1 Khroshi CONFIRMED Icons

Standard milsymbol output with `#C03050` color override. These are
conventional military units and get conventional symbols:

| Unit | SIDC Basis | Inner Symbol |
|------|-----------|-------------|
| Syndicate Infantry | `10031000001211000000` | Infantry cross |
| Conscript Mob | `10031000001211000000` | Infantry cross (same — differentiated by label) |
| Integration Team | `10031000001211020000` | Infantry + AT modifier |
| Syndicate IFV | `10031000001205040000` | Armored + infantry carrier |
| Automaton Walker | `10031000001201000000` | Armor (tank) — with `⚡` modifier for autonomous |
| Broadcast Node | `10031000001211000000` | HQ symbol (flag/star) |
| Coordinated Battery | `10031000001203000000` | Artillery symbol |
| Interceptor Drone | `10031000001108000000` | Air defense |

#### 5.3.2 Ataxian CONFIRMED Icons

At CONFIRMED tier, Ataxian units show a **custom caste glyph** inside the
hexagonal frame instead of standard NATO inner symbols. These are simple
high-contrast line art drawn in Canvas2D:

| Caste | Glyph | Description | Draws As |
|-------|-------|-------------|----------|
| **Scurrier** | Mandibles | Two curved pincers, open | `⌒⌒` (mirrored arcs) |
| **Warrior** | Claw | Three-tine claw mark | `|||` with slight curve |
| **Siege Walker** | Carapace | Heavy rounded shell shape | Thick arc with legs below |
| **Burrow Engine** | Acid drop | Teardrop pointing down | `▽` with drip tail |
| **Skitter Scout** | Eye | Single circular eye | `◎` (concentric circles) |
| **Spore Drone** | Wing | Small wing silhouette | `∿` (wavy line) |
| **Synaptic Brood** | Brain | Wrinkled oval | Irregular ellipse with folds |
| **Carrier Beast** | Jaws | Open maw shape | `⊃⊂` (mirrored brackets) |

These glyphs are purely iconic — 10–15 Canvas2D drawing commands each. They
must be readable at 32×32px (minimum icon size at far zoom).

```typescript
const ATAXIAN_GLYPHS: Record<string, (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void> = {

  scurrier(ctx, cx, cy, s) {
    // Two mirrored mandible arcs
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx - s * 0.15, cy, s * 0.3, -0.8, 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + s * 0.15, cy, s * 0.3, Math.PI - 0.8, Math.PI + 0.8);
    ctx.stroke();
  },

  warrior(ctx, cx, cy, s) {
    // Three-tine claw mark
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * s * 0.15, cy - s * 0.25);
      ctx.quadraticCurveTo(cx + i * s * 0.18, cy, cx + i * s * 0.2, cy + s * 0.25);
      ctx.stroke();
    }
  },

  siege_walker(ctx, cx, cy, s) {
    // Heavy carapace arc with leg stubs
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.05, s * 0.25, Math.PI, 0);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (const dx of [-0.2, -0.1, 0.1, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * s, cy + s * 0.05);
      ctx.lineTo(cx + dx * s * 1.2, cy + s * 0.25);
      ctx.stroke();
    }
  },

  synaptic_brood(ctx, cx, cy, s) {
    // Irregular brain-like ellipse with folds
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.25, s * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Internal fold lines
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.1, cy - s * 0.15);
    ctx.quadraticCurveTo(cx, cy + s * 0.05, cx + s * 0.1, cy - s * 0.15);
    ctx.stroke();
  },

  // ... remaining glyphs follow same pattern
};
```

### 5.4 LOST (detection decayed to 0 after prior acquisition)

Contact is no longer tracked. Icon shows at last-known position with visual
degradation.

| Element | Treatment |
|---------|----------|
| Frame | **Dashed stroke** (4px dash, 4px gap) replacing solid |
| Fill | Fully transparent (frame only) |
| Inner symbol | Faded to 30% opacity |
| Position | Frozen at last-known coordinates |
| Timestamp | `"LOST +{seconds}s"` label below icon |
| Opacity | Fades linearly from 100% → 0% over 60 seconds |

**Faction-specific LOST behavior:**

| Faction | Fade Style |
|---------|-----------|
| **Khroshi** | Clean linear opacity fade → 0% at 60s. Crisp removal. |
| **Ataxian** | Edge-inward dissolve: frame vertices retract toward center over 60s while opacity drops. The hexagon "collapses" as if the organic signature is dispersing. |

```typescript
function drawAtaxianLostFrame(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
  dissolveT: number,          // 0 = just lost, 1 = about to vanish
  strokeColor: string
): void {
  const shrinkRadius = radius * (1.0 - dissolveT * 0.6);  // shrinks to 40% size
  const opacity = 1.0 - dissolveT;

  ctx.globalAlpha = opacity;
  ctx.setLineDash([4, 4]);
  drawHexFrame(ctx, cx, cy, shrinkRadius, 2, strokeColor, 'transparent', 0);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1.0;
}
```

---

## 6. Command Unit Aura Visualization

### 6.1 Synaptic Brood (Ataxian HQ)

When CONFIRMED, a subtle pheromone aura is rendered around the Brood:

```typescript
interface PheromoneAura {
  centerX: number;
  centerZ: number;
  radius: 300;                    // meters (pheromone network range)
  pulsePhase: number;             // 0–1, cycles every 3 seconds
  ringCount: 3;                   // concentric rings
  color: '#E04020';
  maxOpacity: 0.12;               // very subtle
}
```

**Rendering:** Three concentric circles at 100m, 200m, 300m from the Brood's
position, drawn as thin additive-blended rings on the terrain surface. Each
ring pulses outward (radius wobbles ±5%) at staggered phases, creating a
"ripple from center" effect like sonar returns.

```typescript
function drawPheromoneAura(
  ctx: CanvasRenderingContext2D,
  screenX: number, screenY: number,
  screenRadii: number[],          // 3 radii in screen pixels
  phase: number
): void {
  for (let i = 0; i < screenRadii.length; i++) {
    const ringPhase = (phase + i * 0.33) % 1.0;
    const pulse = 1.0 + 0.05 * Math.sin(ringPhase * Math.PI * 2);
    const r = screenRadii[i] * pulse;
    const opacity = 0.12 * (1.0 - i * 0.25);  // outer rings fainter

    ctx.beginPath();
    ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#E04020';
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
}
```

When the Synaptic Brood is **destroyed**, the aura rapidly contracts
(0.5s animation) and vanishes with a brief flash — visually confirming
the kill to the player.

### 6.2 Broadcast Node (Khroshi HQ)

When CONFIRMED, thin connecting lines link the Node to all Khroshi units
within its suppression-resistance aura:

```typescript
interface NeuralLinkVisualization {
  nodePosition: Vec2;
  linkedUnits: Vec2[];            // positions of units in aura range
  color: '#C03050';
  opacity: 0.15;                  // very subtle
  lineWidth: 1;
  // Data pulse: small bright dot travels from Node to each unit
  pulseSpeed: 80;                 // world units per second
  pulseSize: 2;                   // screen pixels
  pulseOpacity: 0.4;
}
```

**Rendering:** Straight lines from Node to each linked unit, drawn at 15%
opacity. A bright dot (the "data pulse") travels along each line from Node
to unit at a steady rate, cycling continuously. This visualizes the neural
command link.

When the Broadcast Node is **destroyed**, all lines snap instantly
(no fade) — a sharp disconnect. Units that lose their link get a brief
red flash on their icon frame (0.2s) to indicate the loss.

---

## 7. Icon Labels and Badges

### 7.1 Unit Label

Displayed below the icon at CONFIRMED tier:

```
CALLSIGN
TYPE NAME
```

Example:
```
ALPHA-2
T1A2 SEP ABRAMS
```

For Ataxian units, the type name uses the caste name:
```
CONTACT-7
SIEGE WALKER
```

**Font:** Monospace, 9px, white `#FFFFFF`, 80% opacity.
**Background:** None (labels float on dark terrain).

### 7.2 State Badges

Rendered as small colored tags to the right of the icon frame:

| Badge | Condition | Color | Text |
|-------|-----------|-------|------|
| `PINNED` | Suppression 40–64 | `#FFD020` amber | `PIN` |
| `ROUTING` | Suppression 65–89 | `#FF4020` red | `RTG` |
| `SURRENDERED` | Suppression ≥90 + crew ≤25% | `#808080` gray | `SURR` |

### 7.3 Fire Posture Ring

A thin ring around the icon base indicates fire posture:

| Posture | Ring Color | Ring Style |
|---------|-----------|-----------|
| `FREE_FIRE` | `#FF4020` red | Solid, 2px |
| `RETURN_FIRE` | — | No ring (default, uncluttered) |
| `HOLD_FIRE` | `#FFD020` amber | Dashed, 2px |

### 7.4 Health Indicators

Two tiny bars below the icon (above the label):

```
[████████░░] crew (green → red gradient as crew drops)
[██████████] suppression (gray → red gradient as suppression rises)
```

- **Crew bar:** `#40C040` at full → `#FF4020` at low. Width proportional to
  `crewCurrent / crewMax`.
- **Suppression bar:** `#606060` at 0 → `#FF4020` at 100. Width proportional
  to `suppression / 100`.
- Bar dimensions: 24px wide × 2px tall, centered below icon.
- Only visible at DETECTED tier or higher.

---

## 8. Icon Sizing and LOD

### 8.1 Base Sizes

| Camera Distance | Icon Size (px) | Label | Badges | Health Bars |
|----------------|---------------|-------|--------|-------------|
| < 60 | 48 | Full (callsign + type) | Visible | Visible |
| 60–120 | 40 | Callsign only | Visible | Visible |
| 120–200 | 32 | Hidden | Hidden | Hidden |
| > 200 | 24 | Hidden | Hidden | Hidden |

At max zoom-out, icons are 24px — just frame + inner symbol. This prevents
clutter on a busy battlefield.

### 8.2 Icon Caching

Each unique combination of (faction, detectionTier, unitType, firePosture,
moraleBadge) produces a deterministic canvas. Cache these in a
`Map<string, THREE.CanvasTexture>`.

```typescript
function getIconCacheKey(
  faction: Faction,
  tier: DetectionTier,
  unitType: string | null,
  category: string | null,
  posture: FirePosture,
  badge: string | null
): string {
  return `${faction}:${tier}:${unitType ?? 'unk'}:${category ?? 'unk'}:${posture}:${badge ?? 'none'}`;
}
```

Estimated cache size: ~80–120 unique icons per mission (2 factions × 8–10 unit
types × 4 tiers × a few posture/badge combos). Each is a 48×64 canvas (~12 KB
uncompressed). Total cache: < 1.5 MB.

Dynamic elements (health bars, suppression, pulse animations) are drawn on top
of the cached base icon each frame, not baked into the cache.

### 8.3 Billboard Rendering

Icons are rendered as camera-facing `THREE.Sprite` objects positioned at the
unit's world coordinates plus a height offset:

```typescript
function createUnitSprite(texture: THREE.CanvasTexture): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: false,       // constant screen-space size
  });
  return new THREE.Sprite(material);
}
```

`sizeAttenuation: false` ensures icons maintain constant pixel size regardless
of camera distance. The icon size scales via the LOD table (§8.1), not via
perspective projection.

---

## 9. Targeting and Engagement Lines

### 9.1 Engagement Line

When a unit is actively firing at a target, a thin line connects firer to
target:

| Element | Style |
|---------|-------|
| Line color | Faction frame color (e.g. `#4080FF` for friendly firing) |
| Line opacity | 0.3 |
| Line width | 1px |
| Style | Solid |
| Duration | Visible while `currentTargetId` is set |

### 9.2 Targeting Reticle

When the player issues an ENGAGE order, a brief reticle appears at the
target:

```typescript
interface TargetingReticle {
  position: Vec3;
  radius: number;          // starts at 8px, contracts to 3px over 0.5s
  opacity: number;         // starts at 0.8, fades to 0
  color: '#FF4020';        // red crosshair
  lifetime: 0.5;
}
```

### 9.3 Rally Line

When a commander issues a RALLY order, a dashed line connects the commander
to the target unit:

| Element | Style |
|---------|-------|
| Line color | `#40C040` (friendly green) |
| Line opacity | 0.5 |
| Dash pattern | 6px dash, 4px gap |
| Duration | While rally action active |

---

## 10. Destroyed Unit Rendering

When a unit is destroyed (`isDestroyed: true`):

1. NATO icon is replaced by a small `×` in the faction's color at 40% opacity
2. If the unit was a vehicle, a burning wreck emitter is active at its position
   (see VISUAL_EFFECTS.md §4.5.3)
3. The icon does not display health bars, badges, or labels
4. The `×` marker persists for mission duration (does not fade)

For enemy destroyed units that were never CONFIRMED, the `×` uses the
generic hostile color `#E04030` — no faction distinction is revealed by
destruction alone.

---

## 11. Sensor Arc Rendering

Each unit has a detection arc rendered as a transparent cone/sector on the
terrain surface:

| Sensor Tier | Arc Radius | Arc Width | Color | Opacity |
|-------------|-----------|-----------|-------|---------|
| Optical | Weapon range | 120° frontal | Unit faction color | 0.05 |
| Thermal | Weapon range × 1.5 | 120° frontal | Unit faction color, warmer | 0.03 |

Arcs are only shown for **friendly units** in the player's force. Enemy
sensor arcs are never displayed (fog of war — the player doesn't know what
the enemy can see).

Arcs use the same `PlaneGeometry` approach as ground decals: flat sectors
at terrain height + 0.03, with soft edge falloff in the fragment shader.

---

## 12. Performance Budget

| Component | Budget |
|-----------|--------|
| Canvas renders per frame | ≤ 5 (only on state change, cached otherwise) |
| Texture uploads per frame | ≤ 5 |
| Sprite draw calls | 1 (instanced or batched by Three.js) |
| Cache memory | < 1.5 MB |
| Icon update CPU | ≤ 0.2 ms/frame |
| Aura/link rendering | ≤ 0.1 ms/frame |
| **Total icon system** | **≤ 0.3 ms/frame** |

---

## 13. Canonical Types

```typescript
type Faction = 'terran' | 'khroshi' | 'ataxian';

type DetectionTier = 'suspected' | 'detected' | 'confirmed' | 'lost';

type UnitCategory = 'vehicle' | 'infantry' | 'air';

interface FactionColorSet {
  frame: string;        // hex color for icon frame stroke
  fill: string;         // hex color for icon frame fill
  text: string;         // hex color for labels
  aura: string;         // hex color for command unit aura
}

const FACTION_COLORS: Record<Faction, FactionColorSet> = {
  terran:  { frame: '#4080FF', fill: '#203060', text: '#FFFFFF', aura: '#4080FF' },
  khroshi: { frame: '#C03050', fill: '#601828', text: '#FFFFFF', aura: '#C03050' },
  ataxian: { frame: '#E04020', fill: '#702010', text: '#FFFFFF', aura: '#E04020' },
};

type FrameShape = 'rectangle' | 'diamond' | 'hexagon';

const FACTION_FRAMES: Record<Faction, FrameShape> = {
  terran:  'rectangle',
  khroshi: 'diamond',
  ataxian: 'hexagon',
};

/** Ataxian caste glyphs — keys match unitClass from FACTIONS.md */
type AtaxianCaste =
  | 'scurrier' | 'warrior' | 'siege_walker' | 'burrow_engine'
  | 'skitter_scout' | 'spore_drone' | 'synaptic_brood' | 'carrier_beast';

interface IconCacheEntry {
  key: string;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  lastUsedTick: number;
}
```

---

## 14. Implementation Order

| Phase | Deliverable | Depends On |
|-------|------------|------------|
| 1 | Install `milsymbol`, render Terran friendly icons (rectangle frames) | Client unit rendering scaffold |
| 2 | Khroshi diamond icons with `#C03050` color override | Phase 1 |
| 3 | Ataxian hexagonal frames with `#E04020` color override | Phase 1 |
| 4 | Detection tier transitions (SUSPECTED → DETECTED → CONFIRMED → LOST) | Spotting system client integration |
| 5 | Ataxian custom caste glyphs (inner icons) | Phase 3 + FACTIONS.md unit list |
| 6 | Command unit auras (pheromone rings, neural links) | Phase 3, Phase 2 |
| 7 | State badges, health bars, fire posture rings | Phase 1 |
| 8 | Engagement lines, targeting reticles, rally lines | Phase 7 |
| 9 | Sensor arc rendering (friendly only) | Phase 1 |
| 10 | LOST contact fade/dissolve animations | Phase 4 |
