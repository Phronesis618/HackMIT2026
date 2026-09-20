import { useEffect, useState } from 'react';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import {
  ABILITY_DETAILS, CLASS_ABILITIES, CLASS_INFO, CLASS_THEME, ENEMY_IDS, ENEMY_INFO, type EnemyId,
} from '../../shared/registry';
import { SKILL_TREES } from '../../shared/skills';
import type { UiActions, UiModel } from '../../shared/ui';
import { ENEMY_LORE } from '../../sim/training';
import { AbilityIcon } from './AbilityIcon';
import { ProvenanceBadge } from './ProvenanceBadge';
import { Codex } from './WorldPanel';

export const MENU_PAGES = ['codex', 'bestiary', 'operative', 'skills'] as const;
export type MenuPage = (typeof MENU_PAGES)[number];

const PAGE_LABEL: Record<MenuPage, string> = { codex: 'Codex', bestiary: 'Bestiary', operative: 'Operative', skills: 'Skills' };

function isTextTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

/**
 * Hollow-Knight-style full-screen menu: Tab toggles, Esc closes, 1–4 jump between pages.
 * The game keeps running underneath (co-op cannot pause); this is a place to read, not a
 * pause screen. Everything the old sidebar used to say lives here instead.
 */
export function GameMenu({ model, actions }: { model: UiModel; actions: UiActions }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>('codex');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTextTarget(e.target)) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (index >= 0) setPage(MENU_PAGES[index]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return <div className="menu-hint" aria-hidden="true">Tab · menu</div>;

  return (
    <div className="menu" role="dialog" aria-modal="false" aria-label="Expedition menu">
      <div className="menu__backdrop" onClick={() => setOpen(false)} />
      <div className="menu__frame">
        <nav className="menu__tabs" aria-label="Menu pages">
          {MENU_PAGES.map((id, i) => (
            <button key={id} type="button" className={`menu__tab ${page === id ? 'menu__tab--active' : ''}`} onClick={() => setPage(id)}>
              <span className="menu__tabkey">{i + 1}</span>
              {PAGE_LABEL[id]}
            </button>
          ))}
          <div className="menu__tabs-foot">
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Close · Esc</button>
          </div>
        </nav>
        <section className="menu__page" aria-live="polite">
          {page === 'codex' && <CodexPage model={model} />}
          {page === 'bestiary' && <BestiaryPage model={model} />}
          {page === 'operative' && <OperativePage model={model} actions={actions} />}
          {page === 'skills' && <SkillsPage />}
        </section>
      </div>
    </div>
  );
}

export function CodexPage({ model }: { model: UiModel }) {
  const world = model.world;
  if (!world) {
    return (
      <>
        <h2 className="menu__title">Codex</h2>
        <p className="muted">No world yet. Contribute an idea at headquarters and step through the portal; what you find out there is recorded here.</p>
      </>
    );
  }
  const r = world.receipt;
  return (
    <>
      <div className="panel__row">
        <h2 className="menu__title">{world.title}</h2>
        <ProvenanceBadge provenance={world.provenance} />
      </div>
      <p className="tagline">{world.tagline}</p>
      {world.provenance.source !== 'live' && (
        <p className="receipt__disclosure">
          {world.provenance.source === 'fixture' ? 'Offline fixture.' : 'Live generation failed; using an offline fixture.'}
          {' '}Your ideas are recorded, but did not shape this world.
        </p>
      )}
      <Codex world={world} discovered={model.discoveredLore} />
      <details className="notes">
        <summary>Contribution ledger · {r.lines.length} recorded</summary>
        <p className="muted">{world.themeSummary}</p>
        <p className="receipt__headline">{r.headline}</p>
        {r.lines.length > 0 ? (
          <ul className="list">
            {r.lines.map((line) => (
              <li key={line.contributionId} className={`list__item ${world.provenance.source === 'live' && line.used ? 'list__item--used' : 'list__item--unused'}`}>
                <span className="list__who">{line.playerName}</span> “{line.text}”
                <div className="list__meta">{world.provenance.source === 'live' && line.used ? `→ ${line.featureDescription ?? 'Attributed by the generation receipt'}` : 'recorded · not used in this world'}</div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No contributions were submitted for this world.</p>}
      </details>
    </>
  );
}

/** Enemy names and how they fight are always listed; what they *were* is earned from their remains. */
export function BestiaryPage({ model }: { model: UiModel }) {
  const lore = model.world?.lore ?? [];
  const found = new Set(model.discoveredLore);
  const remainsFor = (id: EnemyId) => {
    const index = lore.findIndex((f) => f.kind === 'remains' && f.enemyId === id);
    return index >= 0 ? { fragment: lore[index]!, known: found.has(index) } : null;
  };
  return (
    <>
      <h2 className="menu__title">Bestiary</h2>
      <p className="muted">How each hostile fights is field knowledge. What it was before this world ended is only known from what it leaves behind.</p>
      <ul className="bestiary">
        {ENEMY_IDS.map((id) => {
          const remains = remainsFor(id);
          return (
            <li key={id} className={`bestiary__entry ${remains?.known ? 'bestiary__entry--known' : ''}`}>
              <div className="bestiary__head">
                <span className="bestiary__name">{ENEMY_INFO[id].name}</span>
                <span className="bestiary__stat">{ENEMY_INFO[id].maxHp} integrity</span>
              </div>
              <p className="bestiary__attack">{ENEMY_LORE[id].attack}</p>
              <p className="bestiary__tip">{ENEMY_LORE[id].tip}</p>
              {remains?.known ? (
                <blockquote className="bestiary__lore">
                  <span className="codex__title">{remains.fragment.title}</span>
                  <span className="codex__source">{remains.fragment.source}</span>
                  <span>{remains.fragment.text}</span>
                </blockquote>
              ) : remains ? (
                <p className="bestiary__locked">??? · defeat one and recover what it leaves behind</p>
              ) : (
                <p className="bestiary__locked">Not encountered in this world</p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function OperativePage({ model, actions }: { model: UiModel; actions: UiActions }) {
  const classId = model.localPlayer.classId;
  const theme = CLASS_THEME[classId];
  const hud = model.hud;
  const slots = CLASS_ABILITIES[classId];
  const eUnlocked = (hud?.abilityEUnlocked ?? false) || model.phase === 'training';
  const resources = hud?.resources ?? 0;
  const host = model.connection.isHost !== false;
  const inRun = model.phase === 'expedition' || model.phase === 'training';
  return (
    <>
      <div className="panel__row">
        <h2 className="menu__title">{model.localPlayer.displayName} · {CLASS_INFO[classId].name}</h2>
        <span className="badge">{resources} resources</span>
      </div>
      <p className="muted">{theme.weapon}. {CLASS_INFO[classId].role}</p>
      <ul className="loadout" style={{ ['--class-color' as string]: theme.primary }}>
        {(['attack', 'dash', slots.q, slots.e, slots.r] as const).map((id) => {
          const detail = ABILITY_DETAILS[id];
          const locked = detail.gate === 'unlock' && !eUnlocked;
          return (
            <li key={id} className={`loadout__row ${locked ? 'loadout__row--locked' : ''}`}>
              <span className="loadout__icon"><AbilityIcon icon={detail.icon} color={locked ? '#6b7690' : theme.primary} /></span>
              <div className="loadout__body">
                <div className="loadout__head">
                  <span className="abilitybar__tooltip-key">{detail.key}</span>
                  <strong>{detail.name}</strong>
                  {detail.gate === 'ultimate' && <span className="muted">· ultimate · {Math.round(hud?.ultCharge ?? 0)}% charged</span>}
                </div>
                <p>{detail.description}</p>
                <p className="abilitybar__tooltip-stats">{detail.stats}</p>
                {locked && (
                  <button
                    type="button" className="btn btn--primary" onClick={actions.unlockAbility}
                    disabled={!actions.unlockAbility || resources < ABILITY_UNLOCK_COST || model.connection.status !== 'connected' || hud?.state === 'down'}
                  >
                    Unlock · {ABILITY_UNLOCK_COST} resources
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <h3 className="panel__subtitle">Controls</h3>
      <p className="muted">WASD / arrows move · mouse aims · J or click attacks · Shift / Space dashes · Q / E / R abilities · hold F to read a relic, plant the Anchor or revive a teammate. Cleared rooms open their exits.</p>
      <h3 className="panel__subtitle">Crew</h3>
      <ul className="crew">
        {model.players.map((p) => (
          <li key={p.id} className="crew__row">
            <span>{p.displayName}</span>
            <span className="muted">{CLASS_INFO[p.classId].name}{p.isLocal ? ' · you' : ''}</span>
          </li>
        ))}
      </ul>
      {inRun && (
        <div className="actions">
          <button type="button" className="btn" onClick={actions.returnToHeadquarters} disabled={!host || model.connection.status !== 'connected'}>
            Return to headquarters
          </button>
          {!host && <span className="hint">The host returns the crew together.</span>}
        </div>
      )}
    </>
  );
}

export function SkillsPage() {
  return (
    <>
      <h2 className="menu__title">Skills</h2>
      <p className="muted">Not yet active. The tree below is the planned shape: resources earned in runs will buy permanent operative upgrades here.</p>
      {SKILL_TREES.map((tree) => {
        const tiers = Math.max(...tree.nodes.map((n) => n.tier)) + 1;
        const lanes = Math.max(...tree.nodes.map((n) => n.lane)) + 1;
        return (
          <div key={tree.classId} className="skilltree" style={{ gridTemplateColumns: `repeat(${tiers}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${lanes}, auto)` }}>
            {tree.nodes.map((node) => (
              <div
                key={node.id}
                className={`skillnode skillnode--${node.status}`}
                style={{ gridColumn: node.tier + 1, gridRow: node.lane + 1 }}
                title={node.requires.length ? `Requires ${node.requires.join(', ')}` : 'Root'}
              >
                <span className="skillnode__name">{node.name}</span>
                <span className="skillnode__desc">{node.description}</span>
                <span className="skillnode__cost">{node.cost} · locked</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
