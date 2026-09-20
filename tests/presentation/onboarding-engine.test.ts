/**
 * The scheduler: one prompt at a time, priority, cooldown, suppression during a telegraph,
 * dismissal the moment the player does the thing, never twice, and the "already did it
 * unprompted" rule (docs/design/ONBOARDING.md §3).
 */
import { describe, expect, it } from 'vitest';
import { OnboardingEngine, PROMPT_COOLDOWN_MS, loadOnboarding, type OnboardingState } from '../../src/client/onboarding';
import { context, ME, MATE, player, snapshot, uiModel, memoryStorage } from './onboardingFixture';

const hqModel = () => uiModel({ phase: 'headquarters' });
const hqSnapshot = () => snapshot({ phase: 'headquarters', worldId: null, roomId: null, roomIndex: null });

function engineWith(state?: OnboardingState) {
  const saved: OnboardingState[] = [];
  const engine = new OnboardingEngine({ state, onPersist: (next) => saved.push(next) });
  return { engine, saved };
}

describe('onboarding scheduler', () => {
  it('shows the hub movement prompt once the hub has been live for a moment', () => {
    const { engine } = engineWith();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 500 }));
    expect(engine.getView().prompt).toBeNull();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');
    expect(engine.getView().prompt?.keys).toEqual(['W', 'A', 'S', 'D']);
  });

  it('drops the prompt the moment the player does the thing, and never shows it again', () => {
    const { engine } = engineWith();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2100, facts: { moved: true } }));
    expect(engine.getView().prompt).toBeNull();
    // Later, back at the hub, with the fact forgotten: still retired.
    engine.tick(context({ nowMs: 999_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 60_000 }));
    expect(engine.getView().prompt?.id).not.toBe('hub.move');
  });

  it('never shows a lesson the player satisfied unprompted', () => {
    const { engine } = engineWith();
    // The player walks before the 1.5 s trigger window opens.
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 400, facts: { moved: true } }));
    expect(engine.getState().satisfied['hub.move']).toBeDefined();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 4000, facts: { moved: true } }));
    expect(engine.getView().prompt?.id).not.toBe('hub.move');
    expect(engine.getView().notes.some((note) => note.id === 'hub.move')).toBe(false);
  });

  it('shows one prompt at a time and takes the higher priority first', () => {
    const { engine } = engineWith();
    const downed = snapshot({
      players: [player(ME), player(MATE, { state: 'down', hp: 0 })],
      enemies: [{ id: 'e1', enemyId: 'husk', x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing' }],
    });
    // Both `coop.revive` (80) and `run.attack` (63) are triggered; revive wins.
    const ctx = context({ snapshot: downed, phaseMs: 4000, facts: { teammateDown: true } });
    engine.tick(ctx);
    expect(engine.getView().prompt?.id).toBe('coop.revive');
  });

  it('a downed teammate preempts whatever note is on screen', () => {
    const { engine } = engineWith();
    engine.tick(context({ snapshot: snapshot({ floor: { biomeId: 'b', roomId: 'r', tier: 0, path: ['b'], map: [], doorsLocked: true, biomeChoice: null } }), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('note.doors');
    const down = snapshot({
      players: [player(ME), player(MATE, { state: 'down' })],
      floor: { biomeId: 'b', roomId: 'r', tier: 0, path: ['b'], map: [], doorsLocked: true, biomeChoice: null },
    });
    // No cooldown wait: the higher priority takes the band immediately.
    engine.tick(context({ nowMs: 10_100, snapshot: down, phaseMs: 2100, facts: { teammateDown: true } }));
    expect(engine.getView().prompt?.id).toBe('coop.revive');
  });

  it('keeps a quiet gap between one prompt leaving and the next arriving', () => {
    const { engine } = engineWith();
    const enemies = [{ id: 'e1', enemyId: 'husk' as const, x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing' as const }];
    engine.tick(context({ nowMs: 1000, snapshot: snapshot({ enemies }), phaseMs: 4000 }));
    expect(engine.getView().prompt?.id).toBe('run.attack');
    // The attack is done; the dash lesson is now triggered, but not in the same breath.
    const after = { snapshot: snapshot({ enemies }), phaseMs: 4100, facts: { attacked: true, tookDamage: true } };
    engine.tick(context({ nowMs: 1100, ...after }));
    expect(engine.getView().prompt).toBeNull();
    engine.tick(context({ nowMs: 1100 + PROMPT_COOLDOWN_MS - 50, ...after }));
    expect(engine.getView().prompt).toBeNull();
    engine.tick(context({ nowMs: 1100 + PROMPT_COOLDOWN_MS + 10, ...after }));
    expect(engine.getView().prompt?.id).toBe('run.dash');
  });

  it('says nothing while an enemy is winding up, and resumes afterwards', () => {
    const { engine } = engineWith();
    const telegraphing = snapshot({
      enemies: [{
        id: 'e1', enemyId: 'husk', x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'attacking',
        telegraph: { kind: 'melee', x: 200, y: 200, facing: 0, range: 40, arcRad: 1, remainingMs: 300 },
      }],
    });
    engine.tick(context({ snapshot: telegraphing, phaseMs: 4000, blocked: true }));
    expect(engine.getView().prompt).toBeNull();
    const clear = snapshot({ enemies: [{ id: 'e1', enemyId: 'husk', x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing' }] });
    engine.tick(context({ nowMs: 20_000, snapshot: clear, phaseMs: 4300 }));
    expect(engine.getView().prompt?.id).toBe('run.attack');
  });

  it('drops the live prompt if the stage becomes blocked', () => {
    const { engine } = engineWith();
    const enemies = [{ id: 'e1', enemyId: 'husk' as const, x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing' as const }];
    engine.tick(context({ snapshot: snapshot({ enemies }), phaseMs: 4000 }));
    expect(engine.getView().prompt?.id).toBe('run.attack');
    engine.tick(context({ snapshot: snapshot({ enemies }), phaseMs: 4100, blocked: true }));
    expect(engine.getView().prompt).toBeNull();
  });

  it('lets a prompt expire on its own clock when the player never acts', () => {
    const { engine } = engineWith();
    engine.tick(context({ nowMs: 0, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');
    engine.tick(context({ nowMs: 14_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 16_000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');
    engine.tick(context({ nowMs: 15_500, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 17_500 }));
    expect(engine.getView().prompt).toBeNull();
  });

  it('never shows a once-per-device note twice, across a reload', () => {
    const storage = memoryStorage();
    const first = new OnboardingEngine({ onPersist: (state) => { storage.setItem('relay.onboarding.v1', JSON.stringify(state)); } });
    const sealed = snapshot({ floor: { biomeId: 'b', roomId: 'r1', tier: 0, path: ['b'], map: [], doorsLocked: true, biomeChoice: null } });
    first.tick(context({ snapshot: sealed, phaseMs: 500 }));
    expect(first.getView().prompt?.id).toBe('note.doors');

    const second = new OnboardingEngine({ state: loadOnboarding(storage) });
    second.tick(context({ nowMs: 500_000, snapshot: sealed, phaseMs: 500 }));
    expect(second.getView().prompt).toBeNull();
    expect(second.getView().notes.some((note) => note.id === 'note.doors')).toBe(true);
  });

  it('records a silent lesson in Field Notes without ever showing it', () => {
    const { engine } = engineWith();
    const ritual = snapshot({
      anchor: {
        x: 0, y: 0, state: 'planted', progress: 1,
        ritual: { stage: 'relays', relays: [
          { x: 0, y: 0, activated: false }, { x: 1, y: 0, activated: false }, { x: 2, y: 0, activated: false },
        ], activeRelay: 0, pulseRadius: 0, pulseWarningMs: 0, dischargeMs: 0 },
      },
    });
    engine.tick(context({ snapshot: ritual, phaseMs: 4000 }));
    expect(engine.getView().prompt?.id).not.toBe('note.ritual');
    expect(engine.getView().notes.map((note) => note.id)).toContain('note.ritual');
  });

  it('the off switch hides the band, and reset forgets everything', () => {
    const { engine } = engineWith();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');

    engine.setHintsOff(true);
    expect(engine.getView().prompt).toBeNull();
    expect(engine.getView().hintsOff).toBe(true);
    engine.tick(context({ nowMs: 30_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 3000 }));
    expect(engine.getView().prompt).toBeNull();

    engine.setHintsOff(false);
    engine.reset();
    expect(engine.getView().notes).toEqual([]);
    expect(engine.getState().seen).toEqual({});
    engine.tick(context({ nowMs: 40_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt?.id).toBe('hub.move');
  });

  it('`?hints=off` silences the tab without touching what the device remembers', () => {
    const { engine } = engineWith();
    engine.setSessionOff(true);
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    expect(engine.getView().prompt).toBeNull();
    expect(engine.getState().off).toBe(false);
  });

  it('a `run`-scoped lesson may return in a later run, a `device` note may not', () => {
    const { engine } = engineWith();
    const enemies = [{ id: 'e1', enemyId: 'husk' as const, x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing' as const }];
    engine.tick(context({ snapshot: snapshot({ enemies }), phaseMs: 4000, facts: { runId: 'w1' } }));
    expect(engine.getView().prompt?.id).toBe('run.attack');
    // Same run: already shown, so it does not come back after expiring.
    engine.tick(context({ nowMs: 40_000, snapshot: snapshot({ enemies }), phaseMs: 40_000, facts: { runId: 'w1' } }));
    expect(engine.getView().prompt).toBeNull();
    // New world, and the player still never attacked.
    engine.tick(context({ nowMs: 60_000, snapshot: snapshot({ enemies }), phaseMs: 4000, facts: { runId: 'w2' } }));
    expect(engine.getView().prompt?.id).toBe('run.attack');
  });

  it('writes each shown line into Field Notes exactly once, with its group', () => {
    const { engine } = engineWith();
    engine.tick(context({ model: hqModel(), snapshot: hqSnapshot(), phaseMs: 2000 }));
    engine.tick(context({ nowMs: 20_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 20_000, facts: { moved: true } }));
    engine.tick(context({ nowMs: 22_000, model: hqModel(), snapshot: hqSnapshot(), phaseMs: 22_000, facts: { moved: true } }));
    const notes = engine.getView().notes;
    expect(notes.filter((note) => note.id === 'hub.move')).toHaveLength(1);
    expect(notes.find((note) => note.id === 'hub.move')?.group).toBe('hub');
    expect(notes.find((note) => note.id === 'hub.weapon')?.text).toBe('Take a weapon. The stands are northwest.');
  });
});
