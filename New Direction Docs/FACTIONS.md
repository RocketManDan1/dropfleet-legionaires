# Enemy Factions
*Dropfleet Legionaires — hostile forces reference*
*Last updated: 2026-03-20*

---

## Overview

Two primary enemy factions contest the sector. They are mechanically and aesthetically distinct at both the campaign level (how they spread influence, how they defend planets) and the tactical level (unit roster, combat doctrine, special rules).

Both factions are threats to Terran Federation colonies. Neither is allied with the other — they are independent aggressors that may occasionally contest the same planets in succession, or be present simultaneously in different parts of the sector.

---

## Faction 1 — Ataxian Hive

*"They don't want your resources. They want you."*

### Lore

The Ataxians are a race of highly intelligent eusocial arthropoids — effectively large-scale colonial organisms with distributed intelligence coordinated through pheromone networks and bio-electric broadcast. Individual castes are specialized for distinct roles: workers, warriors, builders, and the rare Synaptic Brood that provides strategic direction.

They do not seek to destroy human civilization so much as absorb it. Human populations on Ataxian-controlled worlds are enslaved and integrated into the Hive's labor pool. The Ataxians view this as a kindness — the chaotic inefficiency of individual will, resolved.

Their technology is a fusion of biological engineering and captured Terran hardware. Weapons are grown, not manufactured. Their vehicles are often living things with armored carapaces that heal between engagements.

### Campaign Behaviour

- **Spreads rapidly** when unchecked. Influence increases faster than Khroshi.
- **Loses influence quickly** under sustained pressure. They respond to direct threat rather than maintaining deep logistics.
- **Breakthrough doctrine**: when multiple planets drop below 30% influence simultaneously, the Hive concentrates effort on one and surges it toward 100%. Identifying the surge target and deploying there is the co-op challenge.
- **Swarm reinforcements**: mid-mission enemy reinforcement rate is high. Early kills matter less than late ones — a trickle of casualties will be replaced, a decisive kill of a Synaptic Brood unit can break the reinforcement cycle.

### Tactical Unit Roster

Ataxian units use the same stat system as Terran units but have a distinct visual signature and naming convention. Castes replace unit classes.

| Caste | Equivalent UnitClass | Notes |
|---|---|---|
| **Scurrier** | `infantry` | Light, numerous, fast. Low individual threat. Mass fire. |
| **Warrior** | `ifv` | Primary close-assault caste. Heavily chitin-armored. |
| **Siege Walker** | `mbt` | Large walker platform. Slow, very heavy armor. |
| **Burrow Engine** | `arty_sp` | Launches bio-acid mortar rounds. Indirect fire unit. |
| **Skitter Scout** | `scout` | Six-legged, extremely fast. Size 1. |
| **Spore Drone** | `fixed_wing` | Small unmanned flier. Carries contact-burst acid payload. |
| **Synaptic Brood** | `hq` | Command organism. When destroyed, nearby units lose coherence (suppression spike on all Ataxian units within 300m). |
| **Carrier Beast** | `apc` | Living transport. Carries Scurrier and Warrior castes. |

### Special Rules (Tactical)

**Bio-regeneration:** Ataxian vehicles with `survivability ≥ 4` slowly regenerate 1 crew point per 60 seconds while not under fire. Crew can be recovered up to their starting value, not increased beyond it.

**Pheromone Suppression Resistance:** Ataxian units have a natural suppression floor — suppression cannot be raised above 70 by fire alone. It requires the destruction of a nearby Synaptic Brood unit to allow full suppression buildup. This makes routing Ataxian forces difficult without targeting their command organisms first.

**Swarm Overrun:** Scurrier units that reach `full_halt` within 30m of an enemy ground unit initiate a melee overrun. The target unit takes 1 crew casualty per second until it moves away or the Scurrier unit is destroyed. Melee range attacks bypass armor entirely.

---

## Faction 2 — Khroshi Syndicalists

*"Free will is a resource drain. We are here to correct the inefficiency."*

### Lore

The Khroshi are not aliens. They are human — or were. A century ago the Khroshi Collective was a radical political movement advocating centralized resource allocation and the elimination of economic competition. When the movement seized control of a cluster of industrial worlds in the Bernard's Star periphery, they went further than theory: voluntary neural integration with the Collective's governing intelligencia. Then mandatory integration for citizens. Then for conquered populations.

Today the Khroshi Syndicalists are a post-human empire. Individual members retain bodies and personalities but their executive will — the part that chooses — is surrendered to the Syndicate Mind. They describe this as freedom from the tyranny of desire. They are terrifyingly efficient.

Khroshi forces are a mix of:
- **Unaugmented humans** — fringe populations that haven't been integrated yet; used as expendable frontal forces
- **Augmented Syndicates** — enhanced soldiers with neural combat links, superior fire discipline
- **Automatons** — fully autonomous machines running on Syndicate protocols

### Campaign Behaviour

- **Spreads slowly** but is deeply resistant to being dislodged. Khroshi-held planets require sustained multi-mission effort to liberate.
- **Fortification focus**: Khroshi players will find entrenched positions, defensive lines, and pre-sighted kill zones rather than mobile engagements.
- **Prioritizes high-value targets**: They spread influence toward industrial planets and population centers, not randomly. Reading their expansion pattern tells players where they are going next.
- **Attrition strategy**: They are designed to cost the player more than they spend. Taking a Khroshi planet is always expensive. The question is whether it is worth it.

### Tactical Unit Roster

| Designation | Equivalent UnitClass | Notes |
|---|---|---|
| **Syndicate Infantry** | `infantry` | Average stats but suppression-resistant (+20 suppression floor due to neural discipline) |
| **Conscript Mob** | `infantry` | Unintegrated humans. Low stats, high cost to the players (many of them). |
| **Integration Team** | `at_infantry` | Augmented close-assault specialists. High accuracy, ATGM and demo charges. |
| **Syndicate IFV** | `ifv` | Standard armored carrier. Automation-assisted targeting (higher FC than equivalent Terran IFV). |
| **Automaton Walker** | `mbt` | Fully autonomous heavy platform. No crew — cannot be suppressed. Destroyed or fully functional. |
| **Broadcast Node** | `hq` | Relay for the Syndicate Mind. Provides suppression resistance aura to nearby units. Destroying it causes all nearby Khroshi units to lose their suppression floor bonus for 60 seconds. |
| **Coordinated Battery** | `arty_sp` | High accuracy artillery (FC bonus to scatter). Fires in coordinated salvos — multiple rounds land simultaneously. |
| **Interceptor Drone** | `fixed_wing` | Fast, radar-guided AA + anti-infantry. FC ≥ 100. SEAD target. |

### Special Rules (Tactical)

**Neural Suppression Resistance:** Syndicate units (not Conscripts) have a suppression floor of 20. They cannot be routed by suppression alone — they must be physically destroyed. Killing the Broadcast Node removes this floor for nearby units for 60 seconds.

**Automaton Immunity:** Automaton Walkers have no crew and cannot be suppressed. They are either at full effectiveness or destroyed. No morale states apply. They take normal damage — they are not invulnerable, just unshakeable.

**Coordinated Fire:** Khroshi artillery fires in coordinated salvos. When a Coordinated Battery fires, it sends 2–3 rounds with a 3-second spacing, all aimed at the same target point. Players have a brief window to move units away from the impact zone before the second and third rounds land.

---

## Faction Identification on the Sector Map

Each faction has a distinct color scheme on the sector map:

| Faction | Zone color | Symbol style |
|---|---|---|
| Ataxian Hive | Deep red / crimson hatch | Organic/irregular boundary lines |
| Khroshi Syndicalists | Dark purple / violet hatch | Hard geometric boundary lines |
| Contested (both factions active) | Overlapping hatch, amber border | — |

Faction symbols on individual planets display the controlling faction's icon and current influence percentage.

---

## What We Don't Know Yet

These aspects of the factions need further design work:

- **Named commanders / elites**: Should high-priority planets have named enemy commanders that, when killed, reduce sector-wide enemy activity?
- **Faction-specific mission types**: Ataxian hive-clearing vs. Khroshi fortification assault vs. mixed.
- **Inter-faction conflict**: Can Ataxian and Khroshi fight each other on the same planet if both have influence there? What do players do in that scenario?
- **Faction tech escalation**: Do enemy units upgrade over campaign time if players don't apply pressure? (e.g., Ataxians field Siege Walkers more frequently after week 2)

---

*Campaign spread behaviour: CAMPAIGN_OVERVIEW.md*
*Tactical combat rules: Game Systems Overview.md*
*Unit stat schema: Unit Schema Spec.md*
