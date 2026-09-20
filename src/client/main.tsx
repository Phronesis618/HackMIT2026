/**
 * Application assembly — Agent A. Composes the session, renderer, chronicle, audio,
 * UI store and controller, then mounts React. Nothing else in the client should
 * construct these objects.
 *
 * URL flags (for Agent C's preview path, see docs/ARCHITECTURE.md):
 *   ?world=fixture            load the bundled fixture world without a backend
 *   ?world=fixture&room=1     ...and jump straight into room index 1
 *   ?world=fixture&autoenter=1  ...and enter room 0 immediately
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import type { GameSession } from '../shared/session';
import { createBrowserAudio } from './audio';
import { createBrowserChronicle } from './chronicle';
import { GameController, parsePreviewFlags } from './game/GameController';
import { createIdentityPersistence } from './game/identity';
import { connectFloorsUi, createUiStore } from './game/uiStore';
import { PhaserWorldRenderer } from './render/PhaserWorldRenderer';
import { applyTokens } from './styles/applyTokens';
import './styles/app.css';
import './styles/floors.css';
import './styles/finale.css';
import { LocalSession } from './transport/LocalSession';
import { RemoteSession } from './transport/RemoteSession';
import { fixtureWorldProvider, serverWorldProvider } from './transport/worldProviders';
import { App } from './ui/App';

/** Per-tab storage for the co-op resume credential (a reload must come back as the same operative). */
function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const ClientConfigSchema = z.object({ liveGenerationAvailable: z.boolean() });

async function fetchLiveAvailability(): Promise<boolean | null> {
  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const parsed = ClientConfigSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.liveGenerationAvailable : null;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  applyTokens();
  const params = new URLSearchParams(window.location.search);
  const coOp = params.get('mode') === 'coop';
  const flags = parsePreviewFlags(coOp ? '' : window.location.search);
  const availability = flags.fixtureWorld ? false : await fetchLiveAvailability();
  if (availability === null && !coOp) flags.fixtureWorld = true;
  const identityPersistence = createIdentityPersistence(params.get('as'), window);
  const identity = identityPersistence.load();
  const session: GameSession = coOp
    ? new RemoteSession({ identity, resumeStorage: tabStorage(), resumeScope: identityPersistence.scope })
    : new LocalSession({ identity, worldProvider: flags.fixtureWorld ? fixtureWorldProvider : serverWorldProvider });
  const renderer = new PhaserWorldRenderer();
  const chronicle = createBrowserChronicle(window.localStorage);
  const audio = createBrowserAudio();
  const liveGenerationAvailable = availability === true;
  const store = createUiStore(GameController.initialModel(session, flags, chronicle, liveGenerationAvailable));
  store.set({ audioMuted: audio.isMuted() });
  if (availability === null) store.set({ notice: { kind: 'info', text: coOp
    ? 'No co-op server is reachable. Start the RELAY server or switch to Solo for offline play.'
    : 'No generation server is reachable. Solo play uses a clearly labelled offline fixture.' } });
  const controller = new GameController({
    session, renderer, chronicle, audio, store, flags, liveGenerationAvailable,
    persistIdentity: identityPersistence.save,
  });
  connectFloorsUi(session, store, controller.actions); // floors UI bridge (agent F3): UiModel.floor + actions.chooseBiome
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) controller.dispose();
  });

  const rootEl = document.getElementById('app-root');
  if (!rootEl) throw new Error('#app-root missing from index.html');
  createRoot(rootEl).render(
    <StrictMode>
      <App
        store={store}
        actions={controller.actions}
        onStageReady={(stage) => {
          controller.attachStage(stage).catch((err: unknown) => {
            console.error('[relay] failed to start', err);
            store.set({ notice: { kind: 'error', text: `Failed to start: ${err instanceof Error ? err.message : String(err)}` } });
          });
        }}
      />
    </StrictMode>,
  );

  // Handy for debugging in the browser console; not an API.
  (window as unknown as { relay?: unknown }).relay = { session, controller, store };
}

boot().catch((err: unknown) => {
  console.error('[relay] boot failed', err);
  const error = document.createElement('pre');
  error.textContent = `RELAY failed to boot: ${err instanceof Error ? err.message : String(err)}`;
  document.body.replaceChildren(error);
});
