# UI audit — right rail and bottom bar (agent U1, 2026-09-20)

Screenshots: BEFORE `/tmp/relay-shots/ui/before/`, AFTER `/tmp/relay-shots/ui/after/`
(hub, combat, menu, final room, co-op at 1280x720, 1280x800, 1440x900, 1920x1080; never committed).

## 1. Problems found (from the BEFORE screenshots)

| # | Where | What | Why it is a problem |
|---|-------|------|---------------------|
| 1 | Run, bottom | The Memory Wall strip takes 28vh under the canvas during combat (200 px at 720p). | Archive content, zero combat value, and it shrinks the 16:9 canvas to 774x435 at 1280x720 — 60% of the width — leaving two dead black pillars inside the stage frame. |
| 2 | Run, bottom centre | The ability bar floats *over* the playfield (covers the bottom two tile rows, a door and pickups). | Chrome hides gameplay; enemies can stand under it. |
| 3 | Run, right | There is no right rail at all: no objective, hostile count, room progress, crew, resources or world identity while playing. Room name appears three times instead (top bar telemetry, in-canvas title, `// caption`). | Redundant tertiary info, missing primary/secondary info. |
| 4 | Run | Integrity is only a ~90 px in-canvas bar in the top-left of the letterboxed canvas, with no number. Resources are invisible outside the menu. | Health is *the* primary stat; it is the smallest thing on screen and is not where the eye rests (abilities). |
| 5 | Ability bar | Key caps overlap the bottom edge of the icon (negative margin), 10 px names truncate ("Magnetic Sh…"), the lock is an emoji, the R slot is a different size *and* sits 8 px lower so the baselines of caps/names do not align. | Misaligned baselines, truncation, inconsistent radii (10 px rounded frames in a 2–4 px square system), off-token colour `#6b7690`. |
| 6 | Ability bar | Cooldown is a top-down darkening block + number; unavailable/locked/cooldown/charging all look like "grey". Ult charge is a number over a murky fill. | States are not distinguishable at a glance; no radial sweep (the fastest-read cooldown form). |
| 7 | Hub, bottom | The "Unlock · 3" primary button hangs off the top of the bar over the canvas and collides with the Departure Gate label; the toast notice sits on top of the Memory Wall text. | Overlap / z-order collisions. |
| 8 | Hub, right rail | At 1280x720 the rail is clipped: the primary action (Prepare world) is at the very bottom edge and everything after it needs scrolling; in co-op it is fully below the fold. | Primary CTA not visible at the demo resolution. |
| 9 | Hub, right rail | Hierarchy is flat: a 5-line directory, two hint paragraphs, a disclosure, the form, two CTAs, a dashed training box, a status box and two more hint paragraphs all at the same weight. 11–12.5 px body copy in five different sizes (10, 11, 12, 12.5, 13.5, 14, 15, 17). | No type scale, no primary/secondary/tertiary separation. |
| 10 | Hub + run | Controls are explained four times: floor glyphs in the canvas, the `WASD / arrows…` chip top-right of the stage, "quick controls" disclosure, and a closing hint paragraph in the rail. | Redundant; lead asked for controls to live in the menu. |
| 11 | Everywhere | Panel treatments differ: rail panels are hairline + ticks, `.generation` is a box in a box, `.training-entry` is dashed amber with off-token `#ffb347`, the ability bar is a rounded drop-shadowed slab, HQ station panel has a 3 px coloured top border and its own hex colours. | Reads as several UIs. |
| 12 | Everywhere | Spacing is ad hoc (3, 6, 7, 9, 10, 12, 14 px) rather than a 4/8 grid. | Uneven rhythm, visible in the rail and the bar. |
| 13 | Top bar | Three bordered badges + two ghost buttons compete at the same weight; warm, cyan and green accents all in one strip. | Too many competing accents for tertiary info. |
| 14 | Stage | `// THRESHOLD CONCOURSE` caption overlaps the canvas corner and duplicates the in-world title. `TAB · MENU` is a 10 px fixed label in the page corner, over the memory wall. | Tiny text (< 12 px rule in ART_DIRECTION), floating with no anchor. |
| 15 | Menu | No Controls or Memories page; the menu is the declared home for "everything explanatory". | The two things the lead wants moved have nowhere to go. |
| 16 | 1920 | Rail is a fixed 360 px and the bar a fixed 52 px icon size; at 1920 the bar is tiny relative to the canvas, at 1280 the rail is 28% of the width. | Does not scale gracefully. |

## 2. Research — what good action-roguelike HUDs do

1. **Urgency-based hierarchy.** Primary (health, ammo/abilities) is persistent and anchored; secondary (cooldowns, objectives) is grouped; tertiary (lore, records, controls) lives in menus. — Rocketbrush, *Designing practical and pretty HUD*; Sunstrike, *HUD in video games*.
2. **Anchor to edges/corners, never float over the action.** Hades puts health bottom-left and boons/resources in corners; Dead Cells keeps health bottom-left next to the skill slots; Gungeon uses the four corners only. Centre of the screen belongs to the fight.
3. **Health sits next to the abilities** so one glance reads "can I act / should I act" (Dead Cells, Diablo's orb-bar-orb, League's bar with HP under the abilities). Reduces eye travel — the core point of Dalvi's *HUD redesign for Hades*.
4. **Cooldowns as shape, numbers only as a supplement.** Radial sweep / depleting fill reads faster than digits (Rocketbrush; League-style conic sweep + seconds).
5. **Distinct unavailable states.** Locked ≠ cooling ≠ charging ≠ disabled: League uses grey+lock, dark sweep, blue "no mana", and desaturation respectively.
6. **Little chrome, one treatment.** Hyper Light Drifter and Gungeon use almost no panel framing; what exists shares one border/scale so it recedes. Outline/shadow behind anything drawn over a busy scene.
7. **Diegetic/spatial first for moment-to-moment prompts** (Ardeni, *Types of UI in gaming*): interaction prompts at the object, not in a panel. RELAY already does this with the in-world Integrity bar and station prompts — keep, and do not duplicate them in panels.
8. **Group related resources** into one cluster to cut decision cost (Dalvi): currency with the things it buys.

Sources: <https://rocketbrush.com/blog/designing-practical-and-pretty-hud-in-video-games>,
<https://sunstrikestudios.com/en/blog/HUD_design_in_games/>,
<https://medium.com/@bramhadalvi/hud-redesign-fdc332d05291>,
<https://medium.com/@lorenzoardeni/types-of-ui-in-gaming-diegetic-non-diegetic-spatial-and-meta-5024ce6362d0>,
<https://www.gameuidatabase.com/gameData.php?id=499> (Enter the Gungeon screens), <https://madegooddesigns.com/game-ui-design/>.

## 3. The system

**Layout.** Three fixed regions around an unobstructed stage:

```
┌ top bar (instrument strip) ─────────────────────────────┐
│ stage (16:9 canvas, nothing on top of it    │ right rail │
│ except in-the-moment prompts)               │  minimap   │
│                                             │  objective │
├─────────────────────────────────────────────│  crew      │
│ command bar: vitals │ abilities │ resources │  world     │
└─────────────────────────────────────────────│  memories  │
```

- The rail uses the width the letterboxed canvas was wasting; the command bar is its own
  grid row under the stage, so the playfield is never covered. Removing the Memory Wall strip
  makes the canvas *larger* than before at every size (1280x720: 774x435 → ~930x523).
- Rail width `clamp(288px, 23vw, 360px)`; bar height 88 px (96 px ≥ 1600 w).
- **Minimap slot:** `.hud-minimap-slot` (component `MinimapSlot` in `Hud.tsx`), first item of
  the run rail, square, 180–220 px, `data-slot="minimap"`. Empty by design — F3 fills it.

**Spacing.** 4/8 grid only: 4, 8, 12, 16, 24. Panel padding 16 (12 in the bar), gap between rail panels 8.

**Type scale** (one scale, four steps + display): 11 mono stamp (uppercase labels, key caps) ·
12 secondary · 13 body · 15 emphasis/number · 17 display title. Nothing below 11; body ≥ 12 per ART_DIRECTION.

**Colour roles (tokens only).** cyan = machine/ready; warm lamp = human (memory, lore, currency);
danger = integrity critical/hostiles; success = integrity healthy / cleared; mist300 = secondary text;
class colour only on the ability frames. One accent per panel.

**Panel treatment.** One: hairline `--hair` border, corner ticks, `rgba(9,13,22,.86)` plane, 2 px radius,
mono eyebrow with square bullet. Nested boxes lose their frame (divider line instead).

**Hierarchy.** Primary: integrity + abilities (bar, largest, brightest). Secondary: objective, hostiles,
resources, crew. Tertiary: world identity, memories, controls → collapsed in rail / menu pages.

**Ability slot.** 56 px square frame (ult same size, distinguished by double border + lamp colour, not
by shape/offset), key cap *below* the frame on one baseline, conic cooldown sweep + seconds,
locked = dashed frame + lock glyph + cost, unavailable = desaturated + strike, charging = bottom-up fill + %.

## 4. Lead's additions

- **Controls → menu.** New `Controls` page (menu key 5). HUD keeps only `Tab · menu`. The hub
  chip `WASD / arrows…` and the rail's controls paragraph are hidden by CSS (markup untouched —
  HQ files are not mine to restructure). The floor glyphs are drawn by
  `RoomScene.drawControlsFloorHint` — **F3 to remove** (render files are out of my ownership).
- **Memory Wall → menu + rail.** Bottom strip removed. New `Memories` page (menu key 6) holds the
  full wall incl. Clear. The rail shows a compact `MemoryWall` entry (count + latest) that opens it.

## 5. Look-fix rounds

1. **Round 1** — built the three-region layout (rail + command bar), removed the bottom Memory Wall
   strip, added Controls/Memories menu pages. Looked: name truncated to "Op…" in vitals, HQ
   directory still visible at 720p (headquarters.css loads later and won), CTA buttons wrapping,
   dash icon vanished under the sweep, memory entry clipped at 720p.
2. **Round 2** — fixed those (specificity, nowrap, lighter sweep, 2-line tagline clamp, rail fade).
   Looked: black letterbox bands inside the stage at 16:10; "Contribute" wrapping; name crushed.
3. **Round 3** — stage now hugs its 16:9 canvas and the bar sits directly under it (no bands,
   shorter eye travel). Looked: command bar overlapped the stage at 1280x720.
4. **Round 4** — root cause: a pre-existing rule reset `.notice` to `position: relative`, so the
   toast took a third app-grid row (this is also why it used to sit on the Memory Wall). Fixed;
   notice now floats at the top of the stage under the wayfinder. Vitals identity is responsive
   (class stamp < 1440, name ≥ 1440, both ≥ 1600).

## 6. Left for others

- `RoomScene.drawControlsFloorHint` (hub floor key glyphs) and the in-canvas Integrity bar / room
  title duplicate DOM HUD info — render files, F3 to remove or keep as diegetic.
- `HeadquartersPanel.tsx` still says "quick controls" in its disclosure summary and keeps a
  controls paragraph in markup (hidden by CSS) — W3/HQ owner to delete the copy.
- At 16:10 (1280x800, 1440x900) ~100 px under the command bar is empty by design (the canvas is 16:9).
- Debrief and the HQ station panel were not reachable by script; they use the shared `.panel`
  treatment and were only checked structurally.
