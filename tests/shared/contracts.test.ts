import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ContributionSchema,
  GameEventSchema,
  GameSnapshotSchema,
  PlayerIdentitySchema,
  RoomSpecSchema,
  WorldFixtureSchema,
  formatIssues,
} from '../../src/shared/contracts';
import { ENEMY_IDS, MOTIF_IDS, PROP_IDS, isEnemyId, isMotifId, isPropId } from '../../src/shared/registry';
import { sampleContributions, sampleEvents, samplePlayers, sampleSnapshot } from '../../src/shared/samples';
import { VisualTokensSchema, tokens, tokensToCssVariables } from '../../src/shared/tokens';
import { headquartersRoom } from '../../src/sim/headquarters';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');

describe('world fixtures', () => {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

  it('has at least one fixture', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} satisfies WorldFixtureSchema and only uses registry ids`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
      const parsed = WorldFixtureSchema.safeParse(raw);
      if (!parsed.success) throw new Error(formatIssues(parsed.error));
      const fixture = parsed.data;
      expect(fixture.rooms.length).toBe(fixture.plannedRoomCount);
      for (const room of fixture.rooms) {
        for (const p of room.props) expect(isPropId(p.propId)).toBe(true);
        for (const e of room.encounters) expect(isEnemyId(e.enemyId)).toBe(true);
      }
      for (const m of fixture.art.motifIds) expect(isMotifId(m)).toBe(true);
      // The final room is the guardian / Anchor encounter.
      const finalRoom = fixture.rooms[fixture.rooms.length - 1]!;
      expect(finalRoom.isFinal).toBe(true);
      expect(finalRoom.tiles.join('').split('A').length - 1).toBe(1);
    });
  }
});

describe('RoomSpec validation', () => {
  it('rejects a room whose exit is not on an X tile', () => {
    const bad = { ...headquartersRoom, exits: [{ x: 1, y: 1, toRoomIndex: 0, direction: 'south' as const }] };
    expect(RoomSpecSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects ragged rows', () => {
    const tiles = [...headquartersRoom.tiles];
    tiles[3] = tiles[3]!.slice(0, -1);
    expect(RoomSpecSchema.safeParse({ ...headquartersRoom, tiles }).success).toBe(false);
  });
  it('rejects unknown tile characters', () => {
    const tiles = [...headquartersRoom.tiles];
    tiles[1] = tiles[1]!.replace('.', '?');
    expect(RoomSpecSchema.safeParse({ ...headquartersRoom, tiles }).success).toBe(false);
  });
  it('accepts the headquarters room', () => {
    expect(RoomSpecSchema.safeParse(headquartersRoom).success).toBe(true);
  });
});

describe('sample data', () => {
  it('sample snapshot is a valid GameSnapshot', () => {
    const parsed = GameSnapshotSchema.safeParse(sampleSnapshot);
    if (!parsed.success) throw new Error(formatIssues(parsed.error));
  });
  it('sample events are valid, ordered and id-unique', () => {
    const ids = new Set<string>();
    for (const event of sampleEvents) {
      const parsed = GameEventSchema.safeParse(event);
      if (!parsed.success) throw new Error(`${event.id}: ${formatIssues(parsed.error)}`);
      expect(ids.has(event.id)).toBe(false);
      ids.add(event.id);
    }
    const ticks = sampleEvents.map((e) => e.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });
  it('sample players and contributions validate and use sample- prefixes', () => {
    for (const p of samplePlayers) {
      expect(PlayerIdentitySchema.safeParse(p).success).toBe(true);
      expect(p.id.startsWith('sample-')).toBe(true);
    }
    for (const c of sampleContributions) {
      expect(ContributionSchema.safeParse(c).success).toBe(true);
      expect(c.id.startsWith('sample-')).toBe(true);
    }
  });
});

describe('registry', () => {
  it('has no duplicate ids', () => {
    for (const list of [MOTIF_IDS, PROP_IDS, ENEMY_IDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('visual tokens', () => {
  it('design/tokens.json satisfies the schema', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../design/tokens.json'), 'utf8'));
    const parsed = VisualTokensSchema.safeParse(raw);
    if (!parsed.success) throw new Error(formatIssues(parsed.error));
  });
  it('flattens to CSS variables', () => {
    const vars = tokensToCssVariables(tokens);
    expect(vars['--color-neonCyan']).toBe(tokens.color.neonCyan);
    expect(vars['--space-md']).toBe(`${tokens.space.md}px`);
    expect(vars['--motion-baseMs']).toBe(`${tokens.motion.baseMs}ms`);
  });
});
