import type { MemoryRecord } from '../../shared/contracts';
import type { UiActions } from '../../shared/ui';
import { useRef, useState } from 'react';
import { createFieldReport, filterMemories, MEMORY_KIND_LABELS, MEMORY_SOURCE_LABELS, memoryWorlds } from '../chronicle/memoryArchive';
import { memorySeedBlockReason, type MemorySeedContext } from '../chronicle/memorySeeds';
import { MemorySeedComposer } from './MemorySeedComposer';
import '../styles/memory-archive.css';

/** Ask the Tab menu to open on a page (GameMenu listens). Keeps rail and menu decoupled. */
export const OPEN_MENU_EVENT = 'relay:open-menu';
export function openMenu(page: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: page }));
}

/** Compact rail entry: count + the latest memory; the full wall lives in the menu's Memories page. */
export function MemoryBrief({ memories }: { memories: MemoryRecord[] }) {
  const latest = memories.reduce<MemoryRecord | null>((best, m) => (!best || m.createdAt > best.createdAt ? m : best), null);
  return (
    <button type="button" className="panel memory-brief" onClick={() => openMenu('memories')} aria-label={`Memory wall · ${memories.length} saved on this device. Open memories.`}>
      <span className="memory-brief__head">
        <span className="eyebrow">Memory wall</span>
        <span className="memory-brief__count">{memories.length} <span className="memory-brief__open" aria-hidden="true">›</span></span>
      </span>
      <span className="memory-brief__latest">{latest ? latest.title : 'Nothing yet. Memories are saved from real play.'}</span>
    </button>
  );
}

/** Device-local memory wall (menu page). Only ever shows records derived from real events. */
export function MemoryWall({ memories, actions, context }: { memories: MemoryRecord[]; actions: UiActions; context?: MemorySeedContext }) {
  const archiveRef = useRef<HTMLElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [worldId, setWorldId] = useState('');
  const [kind, setKind] = useState('');
  const [limit, setLimit] = useState(18);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [seedId, setSeedId] = useState<string | null>(null);
  const [seedStatus, setSeedStatus] = useState('');
  const selectedMemory = memories.find((memory) => memory.id === seedId);
  const seedBlocked = context ? memorySeedBlockReason(context) : null;
  const worlds = memoryWorlds(memories);
  const selectedWorld = worlds.some((world) => world.id === worldId) ? worldId : '';
  const ordered = filterMemories(memories, expanded ? { query, worldId: selectedWorld, kind } : { query: '', worldId: '', kind: '' });
  const closeComposer = (): void => {
    setSeedId(null);
    archiveRef.current?.focus();
  };
  const download = (): void => {
    let url: string | undefined;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(new Blob([createFieldReport(ordered)], { type: 'text/plain;charset=utf-8' }));
      link.href = url;
      link.download = 'relay-field-report.txt';
      document.body.append(link);
      link.click();
      setDownloadStatus('Field report download requested. It includes the matching records and their source events.');
    } catch {
      setDownloadStatus('The browser could not download this report. Your saved memories are unchanged.');
    } finally {
      link.remove();
      if (url) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  };
  return (
    <section ref={archiveRef} tabIndex={-1} className={`wall ${expanded || selectedMemory ? 'wall--expanded' : ''}`} aria-label="Device-local memory wall" onKeyDown={(event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    }}>
      <div className="wall__head">
        <h2 className="panel__title">Memory wall</h2>
        <span className="muted">{memories.length === 0 ? 'Nothing yet. Memories are saved from real play on this device.' : `${memories.length} saved on this device`}</span>
        {memories.length > 0 && (
          <div className="wall__actions">
            <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Close archive' : 'Browse archive'}
            </button>
            {confirmClear ? <>
              <span className="hint">Erase memories on this device?</span>
              <button type="button" className="btn" onClick={() => { actions.clearMemories(); setConfirmClear(false); closeComposer(); }}>Erase memories</button>
              <button type="button" className="btn btn--ghost" onClick={() => { setConfirmClear(false); archiveRef.current?.focus(); }}>Cancel</button>
            </> : <button type="button" className="btn btn--ghost" onClick={() => setConfirmClear(true)}>Clear</button>}
          </div>
        )}
      </div>
      {selectedMemory && context && <MemorySeedComposer key={selectedMemory.id} memory={selectedMemory} context={context} actions={actions} onClose={closeComposer} onSubmit={() => {
        closeComposer();
        setSeedStatus('Check your idea in the HQ contribution console. Prepare another world there to use the current ideas.');
      }} />}
      {seedStatus && <p className="hint" role="status">{seedStatus}</p>}
      {expanded && seedBlocked && <p className="hint">{seedBlocked}</p>}
      {expanded && memories.length > 0 && (
        <>
          <div className="memory-archive__tools">
            <label>
              <span className="field__label">Search memories</span>
              <input className="input" type="search" placeholder="World, fragment, or operative" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(18); }} />
            </label>
            <label>
              <span className="field__label">World</span>
              <select className="input" value={selectedWorld} onChange={(event) => { setWorldId(event.target.value); setLimit(18); }}>
                <option value="">All worlds</option>
                {worlds.map((world) => <option key={world.id} value={world.id}>{world.title} · {world.id.slice(-8)}</option>)}
              </select>
            </label>
            <label>
              <span className="field__label">Record type</span>
              <select className="input" value={kind} onChange={(event) => { setKind(event.target.value); setLimit(18); }}>
                <option value="">All records</option>
                {Object.entries(MEMORY_KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={download} disabled={ordered.length === 0}>Save field report</button>
            <button type="button" className="btn btn--ghost" onClick={() => { setQuery(''); setWorldId(''); setKind(''); setLimit(18); }}>Reset filters</button>
          </div>
          <p className="hint memory-archive__status" role="status">{ordered.length} matching records · reports include all matches, with operative names and source events.</p>
          {downloadStatus && <p className="hint" role="status">{downloadStatus}</p>}
        </>
      )}
      <div className="wall__cards">
        {ordered.length === 0 && (
          <p className="wall__empty">{memories.length === 0 ? 'Prepare a world for your first receipt. Enter it for your first keepsake.' : 'No saved memories match these filters.'}</p>
        )}
        {ordered.slice(0, limit).map((m) => (
          <article key={m.id} className={`card card--${m.kind}`}>
            {m.thumbnailDataUrl && <img className="card__thumb" src={m.thumbnailDataUrl} alt={`Captured arrival in ${m.worldTitle}`} loading="lazy" />}
            <div className="card__body">
              <div className="card__meta">
                <span className="badge badge--kind">{MEMORY_KIND_LABELS[m.kind]}</span>
                <span className={`badge badge--${m.provenanceSource === 'live' ? 'live' : m.provenanceSource === 'procedural' ? 'procedural' : m.provenanceSource === 'fixture' ? 'fixture' : 'fallback'}`}>
                  {MEMORY_SOURCE_LABELS[m.provenanceSource]}
                </span>
                <time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString()}>{new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
              </div>
              <h3 className="card__title">{m.title}</h3>
              <p className="memory-archive__world">{m.worldTitle}</p>
              <p className="card__summary">{m.summary}</p>
              <p className="card__people">{m.participants.map((p) => p.displayName).join(', ')}</p>
              <details className="memory-archive__evidence">
                <summary>Recorded evidence</summary>
                <p>World: {m.worldId}<br />Events: {m.sourceEventIds.join(', ')}</p>
              </details>
              {context && <div className="memory-archive__card-actions">
                <button type="button" className="btn" disabled={seedBlocked !== null} title={seedBlocked ?? 'Draft an idea from this saved record'} aria-label={`Use memory: ${m.title}`} onClick={() => {
                  setSeedId(m.id);
                  setSeedStatus('');
                }}>Use for next world</button>
              </div>}
            </div>
          </article>
        ))}
      </div>
      {ordered.length > limit && <button type="button" className="btn memory-archive__more" onClick={() => setLimit(limit + 18)}>Show more records · {ordered.length - limit} remaining</button>}
    </section>
  );
}
