# RELAY — product brief

**Tagline:** Worlds end. Your stories don't.
**Track:** HackMIT 2026 Entertainment. **Platform:** desktop browser (Chrome/Edge/Firefox, keyboard + mouse).

## Fantasy

Players are operatives of a multiversal organization. At headquarters they pitch ideas for an
unstable world, step through a portal into the world those ideas shaped, explore and fight
through three connected rooms, implant an Anchor in the third to stop the collapse, and return
with resources and shared memories that hang on the headquarters wall.

**Emotional differentiator:** *"We imagined this place together, experienced something there
together, and brought back something that remembers it."*

## Two modes, one game

1. **Public solo** — an accessible website; the simulation runs in the browser, world
   generation runs on our server (secrets stay server-side).
2. **LAN co-op** — hosted on a teammate's laptop; one authoritative simulation on the host,
   2–4 clients, two laptops as the first verification target.

Both use the same simulation and content contracts (`src/shared`, `src/sim`).

## The demo sequence (5–7 minute presentation; gameplay is one segment)

headquarters (walkable) → contribute ideas → generate a world → creation receipt shows whose
ideas shaped what → enter the portal → first-room reveal → move, fight, dash, use an ability →
arrival keepsake appears on the memory wall. Judges must see the social payoff **without**
finishing the run.

## Full target

- Headquarters + three expedition rooms; room three holds the guardian and the Anchor.
- Four classes — Bastion, Shade, Beacon, Weaver — each with basic attack, Q ability, dash and
  an unlockable E ability. Unlocks introduce **new behaviour**, not stat percentages.
- Build one complete playable slice before adding class/room breadth.
- Voice is optional later; not part of the bootstrap.

## Generation rules

- Runtime AI produces **validated structured data**, never executable code.
- Pipeline: contributions → `WorldRecipe` → validation/compiler → `RoomSpec` + `ArtRecipe` →
  trusted renderer.
- Themes must differ in structures, motifs, props and encounters — not just colours.
- First room first (target: ready within one minute). Later rooms generate while players play
  and never change a committed room.
- A bounded live attempt resolves to a **clearly labelled** playable fallback. Fixtures or
  cached content are never presented as fresh generation.
- No model calls in the combat loop. No generated HTML/JS/SVG/XML/URLs/expressions.

## Social rules

- Attribute actual player contributions to observable world features.
- Creation receipt immediately after generation.
- Arrival keepsake saved when players actually enter the first room (no completion required).
- Subsequent memories only from real gameplay events; shown on the HQ wall; device-local
  persistence.
- Never invent friends, rescues, completed runs or past experiences.

## Non-goals for the hackathon

Accounts, databases, cross-device progression, voice chat, mobile, procedural infinite runs,
sponsor integrations unrelated to the loop above.
