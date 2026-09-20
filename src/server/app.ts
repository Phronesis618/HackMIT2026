/**
 * RELAY server assembly — Agent A. One Node process serves:
 *   GET  /api/health   liveness + generation mode (never secrets)
 *   GET  /api/config   safe client-facing config
 *   POST /api/world    GenerationRequest -> PreparedWorld (validated both ways)
 *   WS   /ws           realtime (see network/realtime.ts)
 *   GET  /*            production client bundle from dist/client when built
 *
 * Tests import `createRelayServer` and listen on an ephemeral port; `index.ts` is the
 * CLI entry. Generation internals live behind src/server/generation (Agent B).
 */
import fs from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { formatIssues, GenerationRequestSchema, GenerationStatusSchema, PreparedWorldSchema } from '../shared/contracts';
import { describeForClient, type ServerConfig } from './config';
import { createGenerationService, type GenerationService } from './generation';
import { attachRealtime, type RealtimeHandle } from './network/realtime';

export interface RelayServer {
  httpServer: http.Server;
  realtime: RealtimeHandle;
  generation: GenerationService;
  listen(): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
const START_TIME = Date.now();

export function createRelayServer(config: ServerConfig, deps: { log?: (m: string) => void } = {}): RelayServer {
  const log = deps.log ?? ((m: string) => console.log(`[server] ${m}`));
  const generation = createGenerationService({
    ...config.generation,
    fixturesDir: config.fixturesDir,
    log: (m) => log(`generation: ${m}`),
  });

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log(`unhandled error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.end();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (url.pathname === '/api/health' && method === 'GET') {
      const info = generation.info();
      sendJson(res, 200, {
        ok: true,
        service: 'relay',
        uptimeMs: Date.now() - START_TIME,
        generation: {
          requestedMode: info.requestedMode,
          effectiveMode: info.effectiveMode,
          liveConfigured: info.liveConfigured,
          liveImplemented: info.liveImplemented,
          fixtureIds: info.fixtureIds,
        },
        realtimeClients: realtime.clientCount(),
      });
      return;
    }

    if (url.pathname === '/api/config' && method === 'GET') {
      sendJson(res, 200, describeForClient(config));
      return;
    }

    if (url.pathname === '/api/world' && method === 'POST') {
      const body = await readJsonBody(req);
      if (body === undefined) {
        sendJson(res, 400, { error: 'Body must be JSON (max 256 KB).' });
        return;
      }
      const parsed = GenerationRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: 'Invalid GenerationRequest', issues: formatIssues(parsed.error) });
        return;
      }
      const started = Date.now();
      const controller = new AbortController();
      const disconnect = () => controller.abort();
      res.once('close', disconnect);
      req.once('aborted', disconnect);
      const streaming = (req.headers.accept ?? '').split(',').some((item) => {
        const [mediaType, ...parameters] = item.trim().split(';');
        return mediaType?.trim().toLowerCase() === 'application/x-ndjson'
          && !parameters.some((parameter) => /^q\s*=\s*0(?:\.0*)?$/i.test(parameter.trim()));
      });
      try {
        if (res.destroyed || req.aborted) return;
        if (!streaming) {
          const world = PreparedWorldSchema.parse(await generation.prepareWorld(parsed.data, (s) =>
            log(`world ${parsed.data.requestId}: ${s.phase} — ${s.message}`), controller.signal));
          if (controller.signal.aborted) return;
          log(`world ${parsed.data.requestId}: ${world.provenance.source} "${world.recipe.title}" in ${Date.now() - started}ms`);
          sendJson(res, 200, world);
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        let committedRooms = 0;
        const stream = generation.prepareWorldStream(parsed.data, (rawStatus) => {
          controller.signal.throwIfAborted();
          const status = GenerationStatusSchema.parse(rawStatus);
          if (status.requestId !== parsed.data.requestId) throw new Error('Mismatched generation status.');
          res.write(`${JSON.stringify({ type: 'status', status })}\n`);
        }, controller.signal);
        try {
          for await (const rawWorld of stream) {
            controller.signal.throwIfAborted();
            const world = PreparedWorldSchema.parse(rawWorld);
            const writable = res.write(`${JSON.stringify({ type: 'world', world })}\n`);
            committedRooms = world.rooms.length;
            if (!writable) await once(res, 'drain', { signal: controller.signal });
            await setImmediate(undefined, { signal: controller.signal });
          }
          if (committedRooms !== parsed.data.plannedRoomCount) throw new Error('Generation produced an incomplete world.');
        } catch {
          if (!controller.signal.aborted && !res.destroyed) {
            res.write(`${JSON.stringify({
              type: 'error',
              message: committedRooms
                ? 'Later-room generation failed; committed rooms remain playable.'
                : 'World generation failed. Please try again.',
            })}\n`);
          }
        }
        if (!res.destroyed) res.end();
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        controller.abort();
        res.off('close', disconnect);
        req.off('aborted', disconnect);
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: `No route ${method} ${url.pathname}` });
      return;
    }

    if (method === 'GET' && config.staticDir) {
      serveStatic(config.staticDir, url.pathname, res);
      return;
    }

    sendJson(res, 404, {
      error: 'Client bundle not built. Run `npm run build` for production, or use `npm run dev` (Vite serves the client on :5173).',
    });
  }

  const realtime = attachRealtime(httpServer, { generation, log: (m) => log(`realtime: ${m}`) });

  return {
    httpServer,
    realtime,
    generation,
    listen: () =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => {
          const addr = httpServer.address();
          const port = typeof addr === 'object' && addr ? addr.port : config.port;
          resolve({ port, host: config.host });
        });
      }),
    close: async () => {
      await realtime.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) return undefined;
    chunks.push(buf);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.map': 'application/json',
};

function serveStatic(root: string, urlPath: string, res: http.ServerResponse): void {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  let filePath = path.normalize(path.join(root, decoded));
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: unknown paths render the app shell.
    filePath = path.join(root, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const immutable = decoded.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}
