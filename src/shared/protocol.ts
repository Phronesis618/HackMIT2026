/**
 * WebSocket protocol between a RELAY client and the host/server (LAN multiplayer).
 * Owner: Agent A. Every message is validated with these schemas on both ends.
 */
import { z } from 'zod';
import {
  ClassIdSchema,
  ContributionSchema,
  GameEventSchema,
  GameSnapshotSchema,
  GenerationStatusSchema,
  IdString,
  PlayerIdentitySchema,
  PlayerIntentSchema,
  PreparedWorldSchema,
} from './contracts';

export const PROTOCOL_VERSION = 1;

export const LobbySchema = z.object({
  sessionId: IdString,
  hostPlayerId: IdString.nullable(),
  players: z.array(z.object({ identity: PlayerIdentitySchema, connected: z.boolean() })).max(4),
});
export type Lobby = z.infer<typeof LobbySchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    playerId: IdString.nullable(),
    displayName: z.string().trim().min(1).max(24),
    classId: ClassIdSchema,
    resumeToken: z.string().min(16).max(128).optional(),
    lastEventSequence: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({ type: z.literal('ping'), sentAt: z.number() }).strict(),
  z.object({ type: z.literal('intent'), intent: PlayerIntentSchema.strict() }).strict(),
  z.object({
    type: z.literal('identity'),
    displayName: PlayerIdentitySchema.shape.displayName,
    classId: ClassIdSchema,
  }).strict(),
  z.object({
    type: z.literal('contribution'),
    text: z.string().trim().min(1).max(200),
    contributionId: IdString.optional(),
  }).strict(),
  z.object({ type: z.literal('request_world'), requestId: IdString.optional() }).strict(),
  z.object({ type: z.literal('enter_portal') }).strict(),
  /** HUB.md §7: the sender is (or is no longer) standing at the departure gate. The server confirms it against the snapshot. */
  z.object({ type: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ type: z.literal('return_to_hq') }).strict(),
  z.object({ type: z.literal('unlock_ability') }).strict(),
  z.object({ type: z.literal('purchase_skill'), nodeId: z.string().min(1).max(64) }).strict(),
  /** Floors: vote for (host: decide) the next biome while `snapshot.floor.biomeChoice` is open. */
  z.object({ type: z.literal('choose_biome'), biomeId: IdString }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    playerId: IdString,
    serverTimeMs: z.number(),
    isHost: z.boolean(),
    resumeToken: z.string().min(16).max(128),
    lobby: LobbySchema,
    snapshot: GameSnapshotSchema,
    world: PreparedWorldSchema.nullable(),
    contributions: z.array(ContributionSchema).max(24),
    generation: GenerationStatusSchema,
    eventSequence: z.number().int().nonnegative(),
    events: z.array(GameEventSchema).max(2048),
    historyTruncated: z.boolean(),
  }),
  z.object({ type: z.literal('lobby'), lobby: LobbySchema }),
  z.object({ type: z.literal('pong'), sentAt: z.number(), serverTimeMs: z.number() }),
  z.object({ type: z.literal('snapshot'), snapshot: GameSnapshotSchema }),
  z.object({ type: z.literal('events'), events: z.array(GameEventSchema).max(2048), eventSequence: z.number().int().nonnegative() }),
  z.object({ type: z.literal('contributions'), contributions: z.array(ContributionSchema).max(24) }),
  z.object({ type: z.literal('generation_status'), status: GenerationStatusSchema }),
  z.object({ type: z.literal('world'), world: PreparedWorldSchema, requestId: IdString }),
  z.object({
    type: z.literal('error'), message: z.string().max(200),
    action: z.string().max(40).optional(), requestId: IdString.optional(),
  }),
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
