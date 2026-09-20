/** Device-local persistence: round-trip, salvage on corruption, reset, and hostile storage. */
import { describe, expect, it } from 'vitest';
import {
  clearOnboarding, emptyState, loadOnboarding, ONBOARDING_STORAGE_KEY, saveOnboarding, type OnboardingState,
} from '../../src/client/onboarding';
import { memoryStorage } from './onboardingFixture';

const full: OnboardingState = {
  version: 1,
  off: true,
  seen: { 'run.attack': 10, 'note.terrain.pits': 20 },
  satisfied: { 'run.attack': 11 },
  notes: [{ id: 'run.attack', group: 'controls', keys: ['LMB'], text: 'Attack. The mouse aims.', atMs: 10 }],
};

describe('onboarding localStore', () => {
  it('round-trips a full state', () => {
    const storage = memoryStorage();
    saveOnboarding(storage, full);
    expect(loadOnboarding(storage)).toEqual(full);
  });

  it('returns an empty state for a missing or unparseable entry', () => {
    expect(loadOnboarding(memoryStorage())).toEqual(emptyState());
    expect(loadOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: '{not json' }))).toEqual(emptyState());
    expect(loadOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: '"a string"' }))).toEqual(emptyState());
  });

  it('salvages the good half when one note is corrupt', () => {
    const corrupt = JSON.stringify({
      version: 1,
      off: false,
      seen: { 'run.dash': 5, 'bad.entry': 'not a number' },
      satisfied: { 'run.dash': 6 },
      notes: [
        { id: 'run.dash', group: 'controls', keys: ['Shift'], text: 'Dash. It passes through danger.', atMs: 5 },
        { id: 'broken', group: 'not-a-group', text: 7 },
      ],
    });
    const state = loadOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: corrupt }));
    expect(state.seen).toEqual({ 'run.dash': 5 });
    expect(state.satisfied).toEqual({ 'run.dash': 6 });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]!.id).toBe('run.dash');
  });

  it('salvages an entirely wrong shape into an empty-but-valid state', () => {
    const state = loadOnboarding(memoryStorage({ [ONBOARDING_STORAGE_KEY]: '[1,2,3]' }));
    expect(state).toEqual(emptyState());
  });

  it('survives a storage that throws on every call', () => {
    const hostile = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(loadOnboarding(hostile)).toEqual(emptyState());
    expect(() => saveOnboarding(hostile, full)).not.toThrow();
    expect(() => clearOnboarding(hostile)).not.toThrow();
  });

  it('clears the entry', () => {
    const storage = memoryStorage();
    saveOnboarding(storage, full);
    clearOnboarding(storage);
    expect(loadOnboarding(storage)).toEqual(emptyState());
  });
});
