/**
 * Start screen: the premise, the loop, the controls, a class + name pick, and how to play
 * together. Shown once per browser tab (sessionStorage) and skippable with `?start=0`.
 * It sits over the running sanctuary; dismissing it drops the player straight into HQ.
 */
import { useEffect, useState } from 'react';
import { CLASS_IDS, CLASS_INFO, CLASS_THEME, type ClassId } from '../../shared/registry';
import type { UiActions, UiModel } from '../../shared/ui';
import { ClassPortrait } from './PartyPlate';

export const START_SEEN_KEY = 'relay.start.seen';

export function shouldShowStart(search: string, storage: Pick<Storage, 'getItem'> | null): boolean {
  const params = new URLSearchParams(search);
  if (params.get('start') === '0' || params.get('world') === 'fixture' || params.get('autoenter') === '1') return false;
  if (params.get('start') === '1') return true;
  try {
    return storage?.getItem(START_SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

const CONTROLS: Array<[string, string]> = [
  ['WASD / arrows', 'Move'],
  ['Mouse', 'Aim'],
  ['LMB / J', 'Strike'],
  ['Shift / Space', 'Dash (brief invulnerability)'],
  ['Q · E · R', 'Class abilities · unlock · ultimate'],
  ['F (hold)', 'Read relics · plant the Anchor · revive a crewmate'],
  ['Tab', 'Menu: codex, bestiary, operative, skills'],
];

export function StartScreen({ model, actions, onStart }: { model: UiModel; actions: UiActions; onStart: () => void }) {
  const [name, setName] = useState(model.localPlayer.displayName);
  const remote = model.connection.mode === 'remote';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const lanHint = /^(localhost|127\.0\.0\.1)/.test(host)
    ? 'Teammates on the same Wi-Fi need this laptop\'s address: run npm run dev:lan and share http://<your-ip>:5173/?mode=coop'
    : `Teammates on the same Wi-Fi open http://${host}/?mode=coop`;
  useEffect(() => setName(model.localPlayer.displayName), [model.localPlayer.displayName]);

  const commit = (): void => {
    if (name.trim() && name.trim() !== model.localPlayer.displayName) actions.setDisplayName(name.trim());
    try { window.sessionStorage.setItem(START_SEEN_KEY, '1'); } catch { /* private mode */ }
    onStart();
  };

  return (
    <div className="start" role="dialog" aria-labelledby="start-title" data-testid="start-screen">
      <div className="start__stars" aria-hidden="true" />
      <div className="start__frame">
        <header className="start__hero">
          <div className="start__brand">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M6 22a10 10 0 0 1 20 0" />
              <path d="M10.5 22a5.5 5.5 0 0 1 11 0" />
              <circle cx="16" cy="22" r="1.8" />
              <path d="M16 4v6" />
            </svg>
            <h1 id="start-title">RELAY</h1>
          </div>
          <p className="start__tagline">Worlds end. Your stories don't.</p>
          <p className="start__premise">
            You are operatives of a multiversal relay, and a world is about to fold in on itself.
            Bring one idea each to the sanctuary: a place, a creature, a rumour. The relay builds a world
            from those ideas in under a minute. Step through the portal together, fight through its rooms,
            read the notes the dead left, and plant the Anchor before the collapse. The memory wall
            keeps the receipt, the arrival photo and the kill count.
          </p>
          <ol className="start__loop" aria-label="How a run works">
            <li><b>Imagine</b><span>Each operative contributes one idea.</span></li>
            <li><b>Step through</b><span>The relay forms a world from those ideas in seconds.</span></li>
            <li><b>Anchor it</b><span>Clear the halls, find the lore, secure the Anchor.</span></li>
            <li><b>Remember</b><span>Receipts, arrivals and victories stay on your wall.</span></li>
          </ol>
        </header>

        <section className="start__setup" aria-label="Operative setup">
          <label className="field">
            <span className="field__label">Operative name</span>
            <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
          </label>
          <div className="field">
            <span className="field__label">Class</span>
            <div className="start__classes">
              {CLASS_IDS.map((id: ClassId) => (
                <button
                  key={id}
                  type="button"
                  className={`start__class ${model.localPlayer.classId === id ? 'start__class--active' : ''}`}
                  style={{ ['--plate-accent' as string]: CLASS_THEME[id].primary, ['--plate-soft' as string]: CLASS_THEME[id].secondary }}
                  onClick={() => actions.selectClass(id)}
                  aria-pressed={model.localPlayer.classId === id}
                >
                  <span className="plate__portrait"><ClassPortrait classId={id} /></span>
                  <span className="start__classname">{CLASS_INFO[id].name}</span>
                  <span className="start__classrole">{CLASS_INFO[id].role}</span>
                  <span className="start__classweapon">{CLASS_THEME[id].weapon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="start__actions">
            <button type="button" className="btn btn--primary start__play" onClick={commit}>
              {remote ? 'Join the crew' : 'Enter the sanctuary'}
            </button>
            <a className="btn btn--ghost" href={remote ? '/' : '?mode=coop'}>{remote ? 'Play solo instead' : 'Play together (LAN co-op)'}</a>
          </div>
          <p className="start__lan">{lanHint}</p>
        </section>

        <section className="start__controls" aria-label="Controls">
          <h2>Controls</h2>
          <dl>
            {CONTROLS.map(([keys, what]) => (
              <div key={keys} className="start__control">
                <dt><kbd>{keys}</kbd></dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p className="start__note">
            Click the canvas once so your keys reach the game. The Training range in the sanctuary lets you
            meet every hostile with every ability unlocked.
          </p>
        </section>
      </div>
    </div>
  );
}
