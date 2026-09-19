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
import { PlayerIdentitySchema, type PlayerIdentity } from '../shared/contracts';
import { randomId } from '../shared/ids';
import { createSilentAudio } from './audio';
import { createBrowserChronicle } from './chronicle';
import { GameController, IDENTITY_STORAGE_KEY, parsePreviewFlags } from './game/GameController';
import { createLocalProfileStore } from './game/profile';
import { createUiStore } from './game/uiStore';
import { PhaserWorldRenderer } from './render/PhaserWorldRenderer';
import { applyTokens } from './styles/applyTokens';
import './styles/app.css';
import { LocalSession } from './transport/LocalSession';
import { fixtureWorldProvider, serverWorldProvider } from './transport/worldProviders';
import { App } from './ui/App';

function loadIdentity(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = PlayerIdentitySchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* fall through */
  }
  const fresh: PlayerIdentity = { id: randomId('player'), displayName: `Operative-${Math.floor(Math.random() * 900 + 100)}`, classId: 'bastion' };
  try {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    /* ignore */
  }
  return fresh;
}

async function fetchLiveAvailability(): Promise<boolean> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return false;
    const data = (await res.json()) as { liveGenerationAvailable?: boolean };
    return data.liveGenerationAvailable === true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  applyTokens();
  const flags = parsePreviewFlags(window.location.search);
  const identity = loadIdentity();
  const session = new LocalSession({
    identity,
    worldProvider: flags.fixtureWorld ? fixtureWorldProvider : serverWorldProvider,
    profile: createLocalProfileStore(window.localStorage, identity.id),
  });
  const renderer = new PhaserWorldRenderer();
  const chronicle = createBrowserChronicle(window.localStorage);
  const audio = createSilentAudio();
  const liveGenerationAvailable = flags.fixtureWorld ? false : await fetchLiveAvailability();
  const store = createUiStore(GameController.initialModel(session, flags, chronicle, liveGenerationAvailable));
  const controller = new GameController({ session, renderer, chronicle, audio, store, flags, liveGenerationAvailable });

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
  document.body.innerHTML = `<pre style="color:#ff5c7a;padding:24px">RELAY failed to boot: ${err instanceof Error ? err.message : String(err)}</pre>`;
});
