/**
 * Field Notes: every line this browser has actually been shown, grouped, plus the hint
 * switch. The deferred half of the progressive disclosure — a player who missed a prompt
 * while fighting has somewhere to find it, and nobody has to read it who does not want to.
 *
 * Notes that have not been seen are not listed at all. A list of locked rows is a spoiler
 * with extra steps.
 */
import { useSyncExternalStore } from 'react';
import { onboardingBus } from '../onboarding/bus';
import { FIELD_NOTES_TEXT, GROUP_LABEL } from '../onboarding/text';
import type { FieldNote, LessonGroup } from '../onboarding/types';
import '../styles/onboarding.css';

const ORDER: readonly LessonGroup[] = ['hub', 'controls', 'rooms', 'terrain', 'laws', 'finale'];

export function FieldNotesPage({ bus = onboardingBus }: { bus?: typeof onboardingBus }) {
  const view = useSyncExternalStore(bus.subscribe, bus.get, bus.get);
  const byGroup = new Map<LessonGroup, FieldNote[]>();
  for (const note of view.notes) {
    const list = byGroup.get(note.group) ?? [];
    list.push(note);
    byGroup.set(note.group, list);
  }
  const groups = ORDER.filter((group) => (byGroup.get(group)?.length ?? 0) > 0);

  return (
    <>
      <div className="panel__row">
        <h2 className="menu__title">{FIELD_NOTES_TEXT.title}</h2>
        <span className="badge">{view.notes.length} notes</span>
      </div>
      <p className="muted">{FIELD_NOTES_TEXT.lede}</p>

      {groups.length === 0 ? (
        <p className="muted">{FIELD_NOTES_TEXT.empty}</p>
      ) : (
        <div className="fieldnotes">
          {groups.map((group) => (
            <section key={group} className="fieldnotes__group">
              <h3 className="eyebrow">{GROUP_LABEL[group]}</h3>
              <ul className="fieldnotes__list">
                {byGroup.get(group)!.map((note) => (
                  <li key={note.id} className="fieldnotes__row">
                    {note.keys.length > 0 && (
                      <span className="fieldnotes__keys">
                        {note.keys.map((key) => <kbd className="keycap" key={key}>{key}</kbd>)}
                      </span>
                    )}
                    <span>{note.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn"
          aria-pressed={!view.hintsOff}
          onClick={() => bus.setHintsOff(!view.hintsOff)}
        >
          {view.hintsOff ? FIELD_NOTES_TEXT.hintsOff : FIELD_NOTES_TEXT.hintsOn}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => bus.reset()}>
          {FIELD_NOTES_TEXT.reset}
        </button>
      </div>
      <p className="hint">{FIELD_NOTES_TEXT.footer}</p>
    </>
  );
}
