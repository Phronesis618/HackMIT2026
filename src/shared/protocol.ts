/**
 * WebSocket protocol between a RELAY client and the host/server (LAN multiplayer).
 * Owner: Agent A. Every message is validated with these schemas on both ends.
 *
 * Foundation status: the server accepts connections and answers hello/ping. Snapshot
 * and intent relay are Agent A's multiplayer slice (feat/core), not implemented yet.
 */
import { z } from 'zod';
import {
  ClassIdSchema,
  ContributionSchema,
  GameEventSchema,
  GameSnapshotSchema,
  GenerationStatusSchema,
  IdString,
  PlayerIntentSchema,
  PreparedWorldSchema,
} from './contracts';

export const PROTOCOL_VERSION = 1;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    playerId: IdString.nullable(),
    displayName: z.string().trim().min(1).max(24),
    classId: ClassIdSchema,
  }),
  z.object({ type: z.literal('ping'), sentAt: z.number() }),
  z.object({ type: z.literal('intent'), intent: PlayerIntentSchema }),
  z.object({ type: z.literal('contribution'), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('request_world') }),
  z.object({ type: z.literal('enter_portal') }),
  z.object({ type: z.literal('return_to_hq') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    playerId: IdString,
    serverTimeMs: z.number(),
    isHost: z.boolean(),
  }),
  z.object({ type: z.literal('pong'), sentAt: z.number(), serverTimeMs: z.number() }),
  z.object({ type: z.literal('snapshot'), snapshot: GameSnapshotSchema }),
  z.object({ type: z.literal('events'), events: z.array(GameEventSchema) }),
  z.object({ type: z.literal('contributions'), contributions: z.array(ContributionSchema) }),
  z.object({ type: z.literal('generation_status'), status: GenerationStatusSchema }),
  z.object({ type: z.literal('world'), world: PreparedWorldSchema }),
  z.object({ type: z.literal('error'), message: z.string().max(200) }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: unknown): ClientMessage | null {
  const parsed = ClientMessageSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

export function decodeServerMessage(raw: unknown): ServerMessage | null {
  const parsed = ServerMessageSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data : null;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    else if (typeof raw === 'object' && raw !== null && 'toString' in raw) raw = String(raw);
    else return null;
  }
  try {
    return JSON.parse(raw as string);
  } catch {
    return null;
  }
}
