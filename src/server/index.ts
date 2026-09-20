/**
 * CLI entry: `npm run dev:server` (tsx watch) / `npm start` (tsx).
 * Flags: --host 0.0.0.0 (LAN), --port 9000. Env: see .env.example.
 */
import { describeForClient, loadDotEnv, loadServerConfig } from './config';
import { createRelayServer } from './app';

loadDotEnv();
const config = loadServerConfig();
const server = createRelayServer(config);

server
  .listen()
  .then(({ port, host }) => {
    const shownHost = host === '0.0.0.0' ? 'localhost (and this machine\'s LAN address)' : host;
    console.log(`[server] RELAY listening on http://${shownHost}:${port}  (env: ${config.nodeEnv})`);
    console.log(
      `[server] static client: ${config.staticDir ? config.staticDir : 'not built — dev uses Vite on :5173'}`,
    );
    console.log(
      `[server] generation: requested=${config.generation.mode} provider=${config.generation.provider} available=${describeForClient(config).liveGenerationAvailable} model=${config.generation.provider === 'anthropic' ? config.generation.anthropicModel : config.generation.openaiModel}`,
    );
    if (host === '0.0.0.0') {
      console.log('[server] LAN mode: teammates connect to http://<your-lan-ip>:' + port);
    }
  })
  .catch((err: unknown) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });

const shutdown = (): void => {
  server
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
