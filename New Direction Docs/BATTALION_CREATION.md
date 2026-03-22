# Battalion Creation
*Dropfleet Legionaires — player onboarding and force assignment*
*Last updated: 2026-03-20*

---

## First Login Flow

```
Account creation / login
  └── Main Menu
        ├── "Join the War Effort"   (new account — no battalion yet)
        └── "Resume Command"        (returning player — battalion exists)
```

New players select **Join the War Effort** and are walked through battalion creation before being dropped into the sector map.

---

## Battalion Creation: Two-Axis Selection

A battalion is defined by two choices made at creation. Both are permanent — they cannot be changed after the campaign begins.

### Axis 1 — Sector of Origin

Where the battalion was raised. Affects stat buffs applied to all units in the battalion regardless of type.

| Sector | Buff | Flavour |
|---|---|---|
| **Terran Sector** | +Radio chance / +Leadership (rally range +25m, radio success +10%) | Core Federation worlds. Well-supplied, experienced command cadre. |
| **Gliese Sector** | +Movement (all units +10% maxSpeedM) | Frontier worlds. Long distances, fast-moving operations culture. |
| **Bernard's Star** | −Cost (all units cost 5% fewer supply points to replace) | Industrial hub. Efficient logistics, keeps the battalion in the field longer. |

*Sector buffs are passive and always active — no toggle or cooldown.*

---

### Axis 2 — Battalion Type

Determines the **fixed starting roster** assigned to the player. There is no unit selection, no points budget, no customization at this stage — the player receives a doctrine-correct Table of Organization and Equipment (TOE) for their chosen type.

Full roster breakdowns with unit counts and point costs are in **FORCE_ROSTERS.md**.

| Type | Roster Summary | Total Units | Total SP Value | Design Role |
|---|---|---|---|---|
| **Armored** | 2 tank companies + 1 mech rifle company | 74 | ~14,400 | Break fortified positions, destroy enemy armor. Highest firepower, highest replacement cost. |
| **Mechanized** | 3 mech rifle companies + attached tank platoon | 110 | ~14,300 | Combined arms at platoon level. Most flexible. High unit count but expensive IFVs. |
| **Motorized** | 3 rifle companies + weapons company | 97 | ~3,800 | Fast, numerous, cheap to replace. Struggles against armor without support. |
| **Support** | 2 artillery batteries + AA battery + logistics company | 61 | ~6,300 | Cannot take objectives alone. Provides fire support and supply to co-op partners. |
| **Droptroops** | 3 light rifle companies + organic aviation | 78 | ~5,100 | Orbital insertion, deep strike. Light on the ground, helicopters are irreplaceable. |

**The starting roster is the peak of baseline equipment.** Over the campaign, attrition pulls you down the upgrade ladder. Campaign milestones push you back up — potentially past your starting point. See **REPLACEMENT_AND_REINFORCEMENT.md** for the full replacement economy.

---

## What Happens After Selection

1. Player confirms sector + type
2. Server assigns the fixed TOE from FORCE_ROSTERS.md
3. Player names their battalion
4. Player is dropped into the sector map with their transport fleet at a friendly system
5. First mission available immediately

There is no roster review or editing before the first deployment. You command what you're given.

---

## Battalion Management (Between Missions)

Between missions, players can reorganize their roster from a dedicated **Order of Battle** screen.

### What Players Can Do

- **Drag and drop** companies and platoons to reorder them
- **Assign units to companies** — move a platoon from Company B to Company A
- **Designate the HQ unit** for each company (sets which unit provides rally bonus)
- **Flag units as reserve** — kept off the deployment list (preserve them from risk)
- **View casualty status** — see which units are combat ineffective and need replacement
- **Replace destroyed units** — spend supply points on the Replacement Screen (see REPLACEMENT_AND_REINFORCEMENT.md)
- **Repair damaged units** — spend SP to restore combat ineffective units

### What the OOB Adjusts Automatically

When units are moved between companies and platoons, the order of battle display re-draws the hierarchy. Company designations (A, B, C) and platoon numbers update accordingly. There is no manual renaming required.

### Deployment Selection

When queuing into a mission, players select which portion of the battalion to deploy. The default is the whole available roster minus reserved and combat ineffective units. Players can choose to deploy fewer forces to reduce risk to experienced units, at the cost of less firepower on the map.

---

## Battalion Identity

Each battalion has:
- A **player-chosen name** (set at creation)
- A **sector patch** (visual indicator of origin sector)
- A **type designation** (e.g., "1st Mechanized" or "7th Armored")
- A **kill count and missions completed** counter (displayed on the sector map and in-lobby)
- A **combat record** — casualties taken, planets liberated, time in theater

The kill count and record are visible to other players. There is no ranking or competition — it is a record of shared history.

---

*Fixed roster definitions: FORCE_ROSTERS.md*
*Replacement and reinforcement economy: REPLACEMENT_AND_REINFORCEMENT.md*
*Sector map and deployment flow: CAMPAIGN_OVERVIEW.md*
*Enemy factions: FACTIONS.md*
