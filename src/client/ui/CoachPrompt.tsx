/**
 * The one band. Bottom centre of the stage, at most one line, never over the operative, the
 * ability bar, the minimap or the HUD strip (docs/design/ONBOARDING.md §5).
 *
 * It renders whatever the onboarding engine has decided to say. It makes no decisions of its
 * own, holds no timers, and cannot be clicked.
 */
import { useSyncExternalStore } from 'react';
import { onboardingBus } from '../onboarding/bus';
import '../styles/onboarding.css';

export function CoachPrompt({ bus = onboardingBus }: { bus?: typeof onboardingBus }) {
  const view = useSyncExternalStore(bus.subscribe, bus.get, bus.get);
  const prompt = view.prompt;
  return (
    <div className="coach" role="status" aria-live="polite" data-coach={prompt ? prompt.id : 'none'}>
      {prompt && (
        <p className={`coach__line coach__line--${prompt.group}`} key={prompt.id}>
          {prompt.keys.map((key) => (
            <kbd className="keycap coach__key" key={key}>{key}</kbd>
          ))}
          <span className="coach__text">{prompt.text}</span>
        </p>
      )}
    </div>
  );
}
