import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_CUE_IDS, cueForEvent, voiceForWorld } from '../../src/client/audio';
import { WorldFixtureSchema, type GameEvent } from '../../src/shared/contracts';
import crystal from '../../fixtures/worlds/crystal-tide.json';
import roots from '../../fixtures/worlds/root-archive.json';
import spire from '../../fixtures/worlds/vantage-spire.json';

const worlds = [crystal, roots, spire].map((f) => WorldFixtureSchema.parse(f));

describe('world voice', () => {
  it('derives a distinct, deterministic voice from each generated world', () => {
    const voices = worlds.map((w) => voiceForWorld(w.art));
    expect(voices.map((v) => v.timbre)).toEqual(['glass', 'deep', 'deep']);
    expect(voices.map((v) => voiceForWorld(worlds[voices.indexOf(v)]!.art))).toEqual(voices);
    for (const v of voices) {
      expect(v.root).toBeGreaterThanOrEqual(55);
      expect(v.root).toBeLessThanOrEqual(104);
      expect(v.brightness).toBeGreaterThan(0);
      expect(v.brightness).toBeLessThan(1);
      expect(v.scale[0]).toBe(0);
    }
    expect(new Set(voices.map((v) => v.root)).size).toBeGreaterThan(1);
  });
});

describe('event cues', () => {
  it('maps every audible event to a registered cue and distinguishes taking damage from dealing it', () => {
    const base = { id: 'x', tick: 1, timeMs: 16 };
    const events: GameEvent[] = [
      { ...base, type: 'enemy_damaged', enemyId: 'e', byPlayerId: 'p', amount: 1, remainingHp: 1 },
      { ...base, type: 'player_damaged', playerId: 'p', amount: 1, remainingHp: 1, sourceEnemyId: 'e' },
      { ...base, type: 'lore_discovered', playerId: 'p', fragmentIndex: 0, kind: 'relic', title: 't', source: 's', text: 'x', x: 0, y: 0 },
      { ...base, type: 'anchor_planted', worldId: 'w', roomIndex: 2, playerIds: ['p'] },
      { ...base, type: 'enemy_attacked', enemyId: 'e', x: 0, y: 0, facing: 0, hitPlayerIds: [] },
    ];
    const cues = events.map(cueForEvent);
    expect(cues).toEqual(['hit', 'player_hit', 'lore', 'anchor', 'enemy_shot']);
    for (const cue of cues) expect(AUDIO_CUE_IDS).toContain(cue);
    expect(cueForEvent({ ...base, type: 'exit_reached', playerId: 'p', roomIndex: 0, toRoomIndex: 1 })).toBeNull();
  });

  // A21: a canister going up and the departure ritual both had pictures and no sound.
  it('gives the canister blast a cue, and keeps every cue documented in design/audio/cues.json', () => {
    const base = { id: 'x', tick: 1, timeMs: 16 };
    expect(cueForEvent({ ...base, type: 'terrain_detonated', x: 10, y: 10, radius: 70, hitPlayerIds: ['p'], hitEnemyIds: ['e'] })).toBe('terrain_blast');
    expect(AUDIO_CUE_IDS).toContain('departure'); // played by GameController from the departure bus

    const documented = JSON.parse(readFileSync(join(__dirname, '../../design/audio/cues.json'), 'utf8')) as { cues: Record<string, string> };
    expect(Object.keys(documented.cues).sort()).toEqual([...AUDIO_CUE_IDS].sort());
    for (const line of Object.values(documented.cues)) expect(line.length).toBeGreaterThan(10);
  });
});
