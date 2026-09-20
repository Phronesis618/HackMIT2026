import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import {
  ABILITY_DETAILS, CLASS_ABILITIES, CLASS_INFO, CLASS_THEME, ENEMY_IDS, ENEMY_INFO, type EnemyId,
} from '../../shared/registry';
import { buildSkillTree, ownsSkillNode, skillPurchaseCheck, type SkillNode, type SkillPurchaseRefusal } from '../../shared/skills';
import { tokens } from '../../shared/tokens';
import type { UiActions, UiModel } from '../../shared/ui';
import { ENEMY_LORE } from '../../sim/training';
import { focusMenu, installMenuKeyboard } from '../game/keyboardFocus';
import { AbilityIcon } from './AbilityIcon';
import { ProvenanceBadge } from './ProvenanceBadge';
import { Codex } from './WorldPanel';
import { MemoryWall, OPEN_MENU_EVENT } from './MemoryWall';

export const MENU_PAGES = ['codex', 'bestiary', 'operative', 'skills', 'controls', 'memories'] as const;
export type MenuPage = (typeof MENU_PAGES)[number];

const PAGE_LABEL: Record<MenuPage, string> = { codex: 'Codex', bestiary: 'Bestiary', operative: 'Operative', skills: 'Skills', controls: 'Controls', memories: 'Memories' };

/**
 * Hollow-Knight-style full-screen menu: Tab opens from the stage, Esc closes, 1–6 select pages.
 * The game keeps running underneath (co-op cannot pause); this is a place to read, not a
 * pause screen. Everything the old sidebar used to say lives here instead.
 */
export function GameMenu({ model, actions }: { model: UiModel; actions: UiActions }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<MenuPage>('codex');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => installMenuKeyboard({
    isOpen: () => open,
    menu: () => menuRef.current,
    open: () => setOpen(true),
    close: () => setOpen(false),
    selectPage: (index) => setPage(MENU_PAGES[index]!),
  }), [open]);

  useEffect(() => {
    if (open && menuRef.current) return focusMenu(menuRef.current);
  }, [open]);

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const target = (e as CustomEvent<string>).detail as MenuPage;
      if (MENU_PAGES.includes(target)) setPage(target);
      setOpen(true);
    };
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, []);

  return (
    <>
    <button type="button" className="btn btn--ghost" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'expedition-menu' : undefined} onClick={() => setOpen(true)}>
      Menu
    </button>
    {!open && <div className="menu-hint" aria-hidden="true">Tab · menu</div>}
    {open && createPortal(<div id="expedition-menu" ref={menuRef} className="menu" role="dialog" aria-modal="true" aria-label="Expedition menu" tabIndex={-1}>
      <div className="menu__backdrop" onClick={() => setOpen(false)} />
      <div className="menu__frame">
        <nav className="menu__tabs" aria-label="Menu pages">
          {MENU_PAGES.map((id, i) => (
            <button key={id} type="button" data-menu-page={i} aria-current={page === id ? 'page' : undefined} className={`menu__tab ${page === id ? 'menu__tab--active' : ''}`} onClick={() => setPage(id)}>
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
          {page === 'skills' && <SkillsPage model={model} actions={actions} />}
          {page === 'controls' && <ControlsPage />}
          {page === 'memories' && <MemoryWall memories={model.memories} actions={actions} context={model} />}
        </section>
      </div>
    </div>, document.body)}
    </>
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
      <p className="muted">How each hostile fights is on this page. What it did before this world ended is on the thing it drops.</p>
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
              <span className="loadout__icon"><AbilityIcon icon={detail.icon} color={locked ? tokens.color.mist300 : theme.primary} /></span>
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

const CONTROLS: { group: string; rows: { keys: string[]; action: string }[] }[] = [
  { group: 'Move', rows: [
    { keys: ['W', 'A', 'S', 'D'], action: 'Move (arrows also work)' },
    { keys: ['Mouse'], action: 'Aim' },
    { keys: ['Shift', 'Space'], action: 'Dash' },
  ] },
  { group: 'Fight', rows: [
    { keys: ['LMB', 'J'], action: 'Attack · breaks cracked barriers' },
    { keys: ['Q'], action: 'Class ability' },
    { keys: ['E'], action: 'Second ability · unlocked at headquarters' },
    { keys: ['R'], action: 'Ultimate · fires at 100% charge' },
  ] },
  { group: 'Interact', rows: [
    { keys: ['F'], action: 'Use a station · tap at a lit relay' },
    { keys: ['Hold F'], action: 'Read a relic · revive a teammate · plant the Anchor' },
  ] },
  { group: 'Interface', rows: [
    { keys: ['Tab'], action: 'Open / close this menu' },
    { keys: ['1', '–', '6'], action: 'Jump to a menu page' },
    { keys: ['Esc'], action: 'Close the menu' },
  ] },
];

/** Every binding in one place, so the HUD only has to say "Tab · menu". */
export function ControlsPage() {
  return (
    <>
      <h2 className="menu__title">Controls</h2>
      <p className="muted">After the Custodian falls, tap F at each lit relay, dodge the Anchor pulses, then return to the core and release the signal. Cleared rooms open their exits.</p>
      <div className="controls">
        {CONTROLS.map((section) => (
          <section key={section.group} className="controls__group">
            <h3 className="eyebrow">{section.group}</h3>
            <dl className="controls__list">
              {section.rows.map((row) => (
                <div key={row.action} className="controls__row">
                  <dt>{row.keys.map((k) => (k === '–' ? <span key={k} className="controls__sep">–</span> : <kbd key={k} className="keycap">{k}</kbd>))}</dt>
                  <dd>{row.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

const LANE_W = 150;
const TIER_H = 118;

/**
 * Vertical tree, Nine Sols style: root at the bottom, tiers climb; hairline connectors
 * drawn in SVG behind circular nodes; selecting a node opens its detail beside the tree.
 * Implemented nodes are bought here with resources (`skillPurchaseCheck` is the same rule the
 * sim enforces); planned nodes say so and cannot be bought.
 */
const REFUSAL_LABEL: Record<SkillPurchaseRefusal, string> = {
  unknown: 'Unavailable',
  planned: 'Not yet in the game',
  owned: 'Owned',
  requires: 'Needs the node below it',
  resources: 'Not enough resources',
};

function selectedState(node: SkillNode, owned: readonly string[]): string {
  if (node.status === 'planned') return 'Planned · not in the game yet';
  if (node.cost === 0) return 'Innate';
  if (ownsSkillNode(node, owned)) return 'Active';
  return 'Available · not bought';
}

export function SkillsPage({ model, actions, selectedId: initialId = 'core.root' }: {
  model: UiModel; actions?: Pick<UiActions, 'purchaseSkill'>; selectedId?: string;
}) {
  const world = model.world ? { title: model.world.title, attunements: model.world.attunements } : null;
  const tree = buildSkillTree(model.localPlayer.classId, world);
  const owned = model.hud?.skillNodeIds ?? [];
  const [selectedId, setSelectedId] = useState<string>(initialId);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tree.title]);

  const lanes = tree.nodes.map((n) => n.lane);
  const minLane = Math.min(...lanes);
  const maxLane = Math.max(...lanes);
  const width = (maxLane - minLane + 1) * LANE_W;
  const height = tree.tiers * TIER_H;
  const pos = (n: SkillNode) => ({ x: (n.lane - minLane) * LANE_W + LANE_W / 2, y: (tree.tiers - 1 - n.tier) * TIER_H + TIER_H / 2 });
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const selected = byId.get(selectedId) ?? tree.nodes[0]!;
  const theme = CLASS_THEME[model.localPlayer.classId];
  const resources = model.hud?.resources ?? 0;

  return (
    <div className="skills" style={{ ['--class-color' as string]: theme.primary }}>
      <div className="skills__head">
        <div>
          <h2 className="menu__title">{tree.title}</h2>
          <p className="muted">{tree.subtitle}</p>
        </div>
        <span className="badge">{resources} resources</span>
      </div>
      <p className="skills__note">Buy a node and its effect applies at once, for you only. Attunements are written by the world you are in. Nodes marked planned are not in the game yet.</p>
      <div className="skills__body">
        <div className="skilltree__scroll" ref={scrollRef}>
          <div className="skilltree" style={{ width, height }}>
            <svg className="skilltree__lines" width={width} height={height} aria-hidden="true">
              {tree.nodes.flatMap((n) => n.requires.map((req) => {
                const from = byId.get(req);
                if (!from) return null;
                const a = pos(from);
                const b = pos(n);
                const midY = (a.y + b.y) / 2;
                return (
                  <path
                    key={`${req}->${n.id}`}
                    className={`skilltree__line skilltree__line--${n.kind}`}
                    d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`}
                  />
                );
              }))}
            </svg>
            {tree.nodes.map((n) => {
              const { x, y } = pos(n);
              const capstone = n.kind === 'class' && n.tier === 5;
              const active = n.status === 'implemented' && ownsSkillNode(n, owned);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`skillnode skillnode--${n.kind} skillnode--${n.status} ${active ? 'skillnode--owned' : ''} ${capstone ? 'skillnode--capstone' : ''} ${selected.id === n.id ? 'skillnode--selected' : ''}`}
                  style={{ left: x, top: y }}
                  onClick={() => setSelectedId(n.id)}
                  aria-pressed={selected.id === n.id}
                  aria-label={`${n.name}: ${n.description}`}
                >
                  <span className="skillnode__ring" />
                  <span className="skillnode__label">{n.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <aside className="skilltree__detail">
          <span className={`skilltree__kind skilltree__kind--${selected.kind}`}>{selected.kind === 'attunement' ? 'World attunement' : selected.kind === 'core' ? 'Operative core' : CLASS_INFO[model.localPlayer.classId].name}</span>
          <h3 className="skilltree__name">{selected.name}</h3>
          <p className="skilltree__desc">{selected.description}</p>
          {selected.lore && <p className="skilltree__desc muted">{selected.lore}</p>}
          <dl className="skilltree__meta">
            <dt>Cost</dt><dd>{selected.cost === 0 ? 'Innate' : `${selected.cost} resources`}</dd>
            <dt>Tier</dt><dd>{selected.tier === 0 ? 'Root' : selected.tier}</dd>
            <dt>Requires</dt><dd>{selected.requires.length ? selected.requires.map((r) => byId.get(r)?.name ?? r).join(', ') : '—'}</dd>
            <dt>State</dt><dd>{selectedState(selected, owned)}</dd>
          </dl>
          {selected.effectId && <p className="hint">Engine effect: <code>{selected.effectId}</code></p>}
          {selected.cost > 0 && selected.status === 'implemented' && !ownsSkillNode(selected, owned) && (() => {
            const refusal = skillPurchaseCheck(tree, selected.id, owned, resources);
            const canBuy = refusal === null && !!actions?.purchaseSkill && model.connection.status === 'connected' && model.hud?.state !== 'down';
            return (
              <button type="button" className="btn btn--primary" disabled={!canBuy} onClick={() => actions?.purchaseSkill?.(selected.id)}>
                {refusal === null ? `Buy · ${selected.cost} resources` : REFUSAL_LABEL[refusal]}
              </button>
            );
          })()}
        </aside>
      </div>
    </div>
  );
}
