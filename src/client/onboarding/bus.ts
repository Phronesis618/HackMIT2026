/**
 * A tiny external store so React can read the onboarding layer without it being threaded
 * through `UiModel`. Same shape as `departureBus` and `hubStateBus` elsewhere in the client.
 *
 * `connectOnboarding` attaches the live engine; `CoachPrompt` and `FieldNotes` read the view
 * and call the two controls. Before anything is attached the view is simply empty, which is
 * what the tests and the server-side render path see.
 */
import type { OnboardingEngine } from './engine';
import type { OnboardingView } from './types';

const EMPTY: OnboardingView = { prompt: null, notes: [], hintsOff: false };

export interface OnboardingBus {
  get(): OnboardingView;
  subscribe(listener: () => void): () => void;
  publish(view: OnboardingView): void;
  attach(engine: OnboardingEngine | null): void;
  setHintsOff(off: boolean): void;
  reset(): void;
}

function createOnboardingBus(): OnboardingBus {
  let view: OnboardingView = EMPTY;
  let engine: OnboardingEngine | null = null;
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const listener of listeners) listener(); };
  return {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next) {
      view = next;
      emit();
    },
    attach(next) {
      engine = next;
      if (!next) {
        view = EMPTY;
        emit();
      }
    },
    setHintsOff(off) {
      engine?.setHintsOff(off);
    },
    reset() {
      engine?.reset();
    },
  };
}

export const onboardingBus: OnboardingBus = createOnboardingBus();
