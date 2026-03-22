# DRONECOM Visual Analysis — Recreation Reference
*Reference analysis from in-game screenshots. Last updated: 2026-03-19*

---

## 1. Color Palette

The palette is monochromatic with selective accent colors. No textures, no satellite imagery — all color comes from elevation-based shading and UI overlays.

### Terrain & Environment

| Element | Description | Hex / Value |
|---------|-------------|-------------|
| Void / sky | Pure black, no skybox | `#000000` |
| Terrain peaks | Near-white, highest ridges catch full light | `#D0D0D0` – `#F0F0F0` |
| Terrain midtones | Neutral gray slopes | `#606060` – `#909090` |
| Terrain lowlands | Dark charcoal, valleys and flat ground | `#252525` – `#404040` |
| Water surface | Near-black with faint teal undertone | `#0A0F10` – `#151A1C` |
| Underwater terrain | Blue-shifted dark gray, compressed contrast | `#1A2028` – `#354050` |
| Shoreline edge | Thin bright white-to-cyan fringe at waterline | `#CCDDDD` – `#E0F0F0` |
| World-edge rim glow | Bright mint/cyan emissive edge | `#80FFD0` – `#A0FFD8` |
| Grid lines (minor) | Semi-transparent white | `rgba(255, 255, 255, 0.08–0.12)` |
| Grid lines (major) | Slightly brighter white | `rgba(255, 255, 255, 0.15–0.25)` |

### UI Elements

| Element | Color | Hex |
|---------|-------|-----|
| Friendly units / text | Green | `#40C040` |
| Hostile units / text | Red-orange | `#E04030` |
| Unknown / neutral | Amber-orange | `#D09020` |
| UI body text | Off-white | `#C8C8C8` |
| Panel backgrounds | Near-black | `#0A0A0A` – `#141414` |
| Sensor arcs (radar) | Dashed orange | `#D09020` @ 40% opacity |
| Weapon range lines | Dashed, color-matched to unit affiliation | — |

### Key Principle

Terrain brightness is entirely a function of **hillshade lighting** — a single directional light from the northwest (~315 degrees azimuth, ~45 degrees elevation). This is the same convention used in real topographic maps. The result is a neutral gray "metal relief" look where slope and facing determine brightness, not any painted texture.

---

## 2. Glass Pane Water Surface & Grid Overlay

The most distinctive visual feature. Two independent flat planes create the "war room table" aesthetic.

### Water Plane

- **Geometry:** A flat, semi-transparent disc at a fixed Y altitude (sea level = 0)
- **Color:** Very dark, near-black with a subtle teal/blue tint (`#0A0F10`)
- **Opacity:** ~85–90% opaque. Underwater terrain is visible through it but heavily darkened
- **Fresnel effect:** More transparent when viewed straight down (top-down camera), more opaque/reflective at glancing angles (oblique camera). Distant water in the first screenshot appears more solid than nearby water — this is the fresnel at work
- **No wave animation:** The surface is perfectly still. This is a tactical display, not a water sim
- **Edge treatment:** The world boundary disc has a bright mint/cyan emissive rim. This creates the "illuminated glass table edge" look

### Grid Overlay

- **Geometry:** A separate flat plane at the same altitude as the water surface (or fractionally above, +0.1 units)
- **Pattern:** Regular rectangular grid aligned to geographic coordinates (lat/lon lines, not hex)
- **Line weight:** Thin, ~1px at screen resolution
- **Minor grid:** Every cell, very faint (~8–12% opacity white)
- **Major grid:** Every 10 cells, slightly brighter (~15–25% opacity white)
- **Behavior:** The grid is FLAT — it does NOT follow terrain. Land masses pierce through it from below. This is critical to the effect
- **The grid only renders on the water/flat plane.** Above-water terrain has no grid lines on its surface

### Combined Effect

Together, the water plane + grid create the impression of a physical 3D relief model placed on an illuminated glass tabletop. The grid reads as the table surface, terrain reads as the model sitting on it. This is the core visual identity.

---

## 3. Terrain Sharpness & Rendering

### Data Characteristics

- **Source:** Real-world DEM (Digital Elevation Model) data — likely SRTM 30m or ASTER resolution based on visible island detail
- **Vertex density:** Very high. No visible triangulation artifacts or polygon edges, meaning either a very dense mesh or GPU tessellation
- **No LOD degradation:** At the zoom levels shown, ridge lines and cliff faces remain crisp with no smoothing falloff

### Shading Model

- **Hillshade only:** A single directional light from the northwest. No ambient occlusion, no environment mapping, no PBR
- **No textures:** The grayscale value is purely from the dot product of the surface normal and the light direction. No albedo maps, no satellite imagery
- **Light direction:** Approximately `normalize(vec3(-0.3, 0.8, -0.25))` — northwest azimuth, steep elevation
- **Contrast:** High. The `pow(diffuse, 0.7)` or similar gamma curve steepens the light falloff, creating dark shadows in valleys and bright highlights on ridges
- **Slope darkening:** Steep cliff faces render darker than they would from pure diffuse lighting alone. An additional slope factor darkens near-vertical surfaces

### Vertical Exaggeration

The terrain height appears exaggerated by roughly **1.5–2x** relative to real-world proportions. This makes features more dramatic and readable at tactical zoom levels. Without exaggeration, most terrain would look nearly flat from the typical camera distance.

### No Smoothing

Sharp ridge lines and cliff edges are preserved — no aggressive normal smoothing, no post-process blur on the terrain. This gives the "metal relief casting" appearance.

---

## 4. Uniform Water Level — Terrain and Water as Separate Entities

### Architecture

The terrain mesh and water surface are completely independent geometries with no intersection logic:

1. **Terrain mesh:** A continuous heightmap mesh that extends both above AND below sea level. The geometry does not stop or clip at the waterline — it continues down to the ocean floor
2. **Water plane:** A separate flat disc geometry positioned at Y = sea level, clipped to the circular world boundary
3. **No boolean operations:** There is no CSG intersection, no vertex clipping, no stencil masking at the waterline

### Render Order

```
Pass 1: Terrain mesh (opaque, full depth write)
Pass 2: Water plane (transparent, alpha blend, no depth write)
Pass 3: Grid overlay (transparent, alpha blend, no depth write)
Pass 4: Edge glow / rim (additive blend)
Pass 5: Unit icons and UI (screen-space overlay)
```

### Result

- Above-water terrain naturally "pokes through" the water and grid planes because it was rendered first with depth write enabled
- Below-water terrain is visible through the semi-transparent water plane, appearing darkened and color-shifted
- The waterline boundary emerges naturally from the geometry intersection without any explicit shoreline geometry

---

## 5. Underwater Terrain — Refraction & Depth Attenuation

### Visual Treatment

Underwater terrain has four distinct modifications compared to above-water terrain:

#### 5a. Darkening (Depth Attenuation)
- Underwater terrain is rendered at roughly **40–60% of above-water brightness**
- This simulates light absorption by the water column
- Deeper areas are darker than shallow areas — the attenuation is depth-proportional

#### 5b. Color Shift (Blue-Green Tint)
- The neutral gray of above-water terrain shifts to a cold blue-gray underwater
- The tint is subtle but visible: approximately a 20–30% mix toward `vec3(0.08, 0.12, 0.18)`
- This simulates selective color absorption by water (red wavelengths absorbed first)

#### 5c. Contrast Compression
- The dynamic range of underwater terrain is compressed — the difference between the darkest and lightest underwater features is much narrower than on land
- Underwater features are readable but muted, preventing them from competing visually with above-water terrain

#### 5d. No Geometric Distortion
- There is NO UV-offset refraction (no wobble, no displacement). The "refraction" appearance comes entirely from the color treatment + the semi-transparent water plane layered on top
- This is an important simplification — real refraction distortion would be expensive and would hurt readability

### Shader Implementation Pattern

```glsl
if (worldPosition.y < seaLevel) {
    float depth = (seaLevel - worldPosition.y) / maxDepth;
    depth = clamp(depth, 0.0, 1.0);

    // Darken based on depth
    color *= mix(0.6, 0.25, depth);

    // Blue-green tint
    vec3 underwaterTint = vec3(0.08, 0.12, 0.18);
    color = mix(color, underwaterTint, 0.25 + 0.15 * depth);

    // Compress contrast toward a mid-dark value
    vec3 midGray = vec3(0.06, 0.07, 0.09);
    color = mix(midGray, color, mix(0.7, 0.4, depth));
}
```

---

## 6. Shoreline, Terrain & Undersea — Color Zone Transitions

Three distinct visual zones with sharp boundaries at the waterline.

### Zone A: Above Water (Land)

- **Full-contrast grayscale hillshade**
- Brightness range: `#141414` (deep valleys) to `#F0F0F0` (bright peaks)
- Pure neutral gray — no color tinting of any kind
- All visual information comes from slope and light direction
- This is the "hero" zone — maximum detail and contrast

### Zone B: Shoreline Edge

- A thin, bright **white-to-cyan fringe** exactly at the waterline
- Width: approximately 1–3 pixels at screen resolution — very thin but high contrast against the dark water
- Likely causes (two possibilities):
  1. **Explicit foam/surf line:** A bright emissive line rendered where terrain height is within a narrow band of sea level (e.g., `abs(height - seaLevel) < threshold`)
  2. **Natural shading artifact:** Terrain normals at the water crossing tend to face nearly horizontal, catching more sidelight and appearing brighter. The contrast against the dark water amplifies this
- The bright shoreline is critical for readability — it makes coastlines instantly visible from any camera distance

### Zone C: Underwater

- **Immediate transition** below the waterline — not a gradual fade from shore outward
- Blue-green color shift kicks in as soon as terrain drops below sea level
- Progressive darkening with depth: shallow seafloor is dim, deep seafloor is very dark
- Still readable enough to see underwater topography (ridges, submarine canyons, continental shelves)
- Lower contrast than land — features are visible but subdued
- The underwater terrain provides spatial context (you can see the shape of the ocean floor) without pulling visual attention from the tactically relevant above-water terrain

### Transition Sharpness

The transition between land and water is **sharp, not gradual.** There is no "wet sand" gradient zone or beach transition. The terrain crosses sea level and immediately changes visual treatment. This is consistent with the tactical display aesthetic — the system cares about above/below sea level as a binary state.

---

## 7. World Boundary & Edge Treatment

### Disc Edge Rim Glow

- The entire world is rendered as a **circular disc** with a defined boundary
- The rim of the disc has a bright **mint/cyan emissive glow** (`#80FFD0`)
- The glow has two components:
  1. **Tight bright ring:** A thin, high-intensity line at the exact disc edge
  2. **Outer haze:** A softer, wider glow extending slightly beyond the edge, ~30% intensity
- The glow is rendered on a separate plane below the disc (visible from above as an underglow)

### Edge Taper

- Terrain height smoothly tapers to sea level as it approaches the disc edge
- This prevents abrupt cliff walls at the world boundary
- The taper starts at roughly 85–90% of the disc radius

### Underside

- The disc has a visible underside — a dark rim wall and a dark bottom cap
- Color: very dark gray-green (`#080A08` rim, `#040504` bottom)
- This gives the world a physical "puck" or "tabletop model" appearance when viewed at oblique angles

---

## 8. Current Implementation Status

The existing [terrain.ts](../client/src/terrain.ts) already implements most of these elements:

| Feature | Status | Notes |
|---------|--------|-------|
| Heightmap terrain mesh | Done | PlaneGeometry with vertex displacement |
| Grayscale hillshade | Done | Northwest directional light, slope darkening |
| Flat water plane | Done | CircleGeometry at sea level, transparent |
| Grid overlay | Done | Minor + major grid lines, flat plane |
| Disc edge glow | Done | Ring geometry + underglow shader |
| Disc underside | Done | Rim wall + bottom cap |
| Spherical curvature | Done | Quadratic drop-off from center |
| Edge taper | Done | Smooth terrain-to-sea-level transition at boundary |
| Underwater darkening | Done | Depth-proportional darkening + blue-green tint + contrast compression |
| Shoreline fringe | Done | Bright white/cyan edge at waterline, tight 0.008 band |
| Fresnel water opacity | Done | View-angle-based alpha: 0.45 top-down → 0.90 grazing |
| Underwater contrast compression | Done | Depth-proportional compression toward dark midpoint |

### Priority Improvements

1. **Shoreline fringe** — Add a bright white/cyan edge detection where terrain crosses sea level. High visual impact for low implementation cost
2. **Fresnel water** — Vary water opacity based on view angle. More transparent looking down, more opaque at glancing angles
3. **Underwater treatment** — Strengthen blue tint, add depth-proportional darkening, compress contrast range
4. **Grid rendered only on water** — Currently the grid follows terrain; it should be flat on the water plane only, with terrain poking through

---

## Reference Notes

- The DRONECOM aesthetic is deliberately cheap to render. The entire visual language is shading math and geometry — no textures, no PBR, no environment maps
- The "war room table" effect (terrain model on glass tabletop) comes from the flat grid + transparent water + terrain piercing through, not from any single shader trick
- The mint/cyan accent color (`#80FFD0`) is the only chromatic color in the environment. Everything else is grayscale. This makes it the strongest visual anchor for the world boundary
- Unit colors (green/red/orange) are chosen for maximum contrast against the grayscale terrain — they read instantly from any distance
