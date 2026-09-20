/**
 * Every player-facing string the onboarding layer can show, in one table so the lint test
 * can walk it. House style is docs/WRITING.md: plain, concrete, imperative, at most ten
 * words, no mysticism, never the player's feelings. Key names are rendered as key caps by
 * `CoachPrompt` and are deliberately NOT part of the prose — George Fan's eight-word budget
 * is a budget for words, not for a picture of a key (docs/design/ONBOARDING.md §3).
 *
 * Nothing here states an event. The layer teaches rules and controls; the Quartermaster,
 * the receipt and the memory wall are the only things that talk about what happened, and
 * they are bound by docs/PRODUCT.md's honesty rules.
 */
import type { TerrainFeatureId } from '../../shared/registry';

/** Hub: the three things a stranger has to do, in order, and the payoff pointer. */
export const HUB_TEXT = {
  move: 'Walk.',
  weapon: 'Take a weapon. The stands are northwest.',
  idea: 'Write one idea. It shapes the world.',
  prepare: 'Prepare the world. The gate needs one.',
  gate: 'The gate is south. Walk onto it.',
  receipt: 'The receipt names whose idea became what.',
  /** Co-op guest: preparing a world is host-only, so say so once instead of greying a button. */
  guestGate: 'The host prepares the world and opens the gate.',
} as const;

/** In a run: one control each, triggered where the control first matters. */
export const RUN_TEXT = {
  move: 'Walk.',
  attack: 'Attack. The mouse aims.',
  dash: 'Dash. It passes through danger.',
  abilityQ: 'Your class ability is ready.',
  unlockE: 'Unlock a second ability on the Operative page.',
  abilityR: 'Ultimate ready.',
  map: 'Hold for the floor map.',
  revive: 'Stand over them to revive.',
} as const;

/** First-encounter notes: one flat sentence about a thing that just came into view. */
export const NOTE_TEXT = {
  doors: 'Doors hold until the room is clear.',
  choice: 'Pick on the facts, not the name.',
  gatekeeper: 'This move comes back at the end.',
  ritual: 'Tap F at each lit relay, then the core.',
  collapse: 'The map shows the way back.',
  relic: 'One relic. It goes on the hub shelf.',
} as const;

/** Room kinds, on first entry to one of that kind. Combat and entrance rooms need no caption. */
export const ROOM_KIND_TEXT = {
  rest: 'Rest room. One heal waits here.',
  treasure: 'Treasure room. No fight, one cache.',
  lore: 'Lore room. Reading fills the Codex.',
  elite: 'Elite room. One hard fight, better reward.',
  exit: 'Exit room. Clear it, then pick a door.',
} as const;

export type NotedRoomKind = keyof typeof ROOM_KIND_TEXT;

/**
 * Terrain. The line is the world's own name for the feature followed by the engine's plain
 * effect: "Deck plating: the burn ramps while you stand in it." The world half comes from
 * `WorldRecipe.terrainSkins[].name`, which nothing else in the client reads; the engine half
 * is fixed here and carries no number, because a room may retune the numbers
 * (`RoomSpec.terrainIntensity`).
 */
export const TERRAIN_NAME: Record<TerrainFeatureId, string> = {
  hazard_floor: 'Scalding floor',
  canisters: 'Volatile canister',
  pits: 'Open pit',
  vents: 'Timed vent',
  cover: 'Low cover',
  breakable_walls: 'Cracked barrier',
  rubble: 'Rubble',
  conduits: 'Conduit',
  bridges: 'Raised crossing',
};

export const TERRAIN_EFFECT: Record<TerrainFeatureId, string> = {
  hazard_floor: 'the burn ramps while you stand in it',
  canisters: 'one hit and it blows, both ways',
  pits: 'dash across, or knock something in',
  vents: 'it fires on a beat you can watch',
  cover: 'stops shots, not footsteps',
  breakable_walls: 'attack it to open a route',
  rubble: 'slows footsteps, not dashes',
  conduits: 'faster footsteps',
  bridges: 'a route over the wall',
};

/** The longest line the band is laid out for. Past this the world's own name is dropped. */
export const MAX_LINE = 72;

export function terrainLine(feature: TerrainFeatureId, worldName?: string): string {
  const name = (worldName ?? '').trim() || TERRAIN_NAME[feature];
  const line = `${name}: ${TERRAIN_EFFECT[feature]}`;
  return line.length <= MAX_LINE ? line : `${TERRAIN_NAME[feature]}: ${TERRAIN_EFFECT[feature]}`;
}

/**
 * A world law: the world's name for it, then the engine's own effect line with this world's
 * real numbers. Both halves are written elsewhere (the model, then `lawEffectText`), so this
 * only joins them and keeps the band from overflowing.
 */
export function lawLine(name: string, effect: string): string {
  // One rule per line. `lawEffectText` often states two or three numbers in separate
  // sentences; the first one is the rule, and the world panel still holds all of them.
  const flat = effect.trim().replace(/\s+/g, ' ');
  // A full stop only ends a sentence when a space follows it: "1.8x" is one number.
  const first = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  const clean = `${name.trim().replace(/\s+/g, ' ')}: ${first}`;
  if (clean.length <= MAX_LINE) return clean;
  const cut = clean.slice(0, MAX_LINE - 1);
  const stop = cut.lastIndexOf(' ');
  return `${(stop > MAX_LINE / 2 ? cut.slice(0, stop) : cut).replace(/[,.;:]$/, '')}…`;
}

/** Field Notes page copy. */
export const FIELD_NOTES_TEXT = {
  title: 'Field Notes',
  lede: 'Every note this world has shown you.',
  empty: 'Nothing yet. Notes arrive as you meet each thing.',
  hintsOn: 'Hints on',
  hintsOff: 'Hints off',
  reset: 'Show every hint again',
  footer: 'Kept on this browser only.',
} as const;

export const GROUP_LABEL = {
  hub: 'Headquarters',
  controls: 'Controls',
  rooms: 'Rooms',
  terrain: 'Terrain',
  laws: 'World laws',
  finale: 'The end of a run',
} as const;

/** Everything above that is prose, flattened for `tests/presentation/onboarding-prose.test.ts`. */
export function allAuthoredStrings(): string[] {
  const lines: string[] = [
    ...Object.values(HUB_TEXT),
    ...Object.values(RUN_TEXT),
    ...Object.values(NOTE_TEXT),
    ...Object.values(ROOM_KIND_TEXT),
    ...Object.values(FIELD_NOTES_TEXT),
  ];
  for (const feature of Object.keys(TERRAIN_NAME) as TerrainFeatureId[]) lines.push(terrainLine(feature));
  return lines;
}
