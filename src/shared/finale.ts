import type { AnchorState, EnemyState, LoreFragment } from './contracts';
import { custodianTitle, type ResolvedCustodian } from './custodian';

export const RELAY_ACTIVATION_RANGE = 42;
export const ANCHOR_PULSE_WARNING_MS = 1300;
export const ANCHOR_PULSE_SPEED = 180;
export const ANCHOR_DISCHARGE_MS = 1600;
/** Every relic read takes 150 ms off the discharge, to a floor of 1000 ms (BOSS_FINALE §6). */
export const ANCHOR_DISCHARGE_MS_PER_RELIC = 150;
export const ANCHOR_DISCHARGE_RELIC_CAP = 4;

export function guardianPhase(hp: number, maxHp: number): 1 | 2 | 3 {
  return hp > maxHp * 2 / 3 ? 1 : hp > maxHp / 3 ? 2 : 3;
}

export function guardianTitle(enemy: EnemyState, custodian?: ResolvedCustodian | null): string {
  const phase = (enemy.bossPhase ?? guardianPhase(enemy.hp, enemy.maxHp)) as 1 | 2 | 3;
  if (custodian) return custodianTitle(custodian, phase);
  return ['THE LAST CUSTODIAN · WATCH', 'THE LAST CUSTODIAN · FRACTURE', 'THE LAST CUSTODIAN · LAST LIGHT'][phase - 1]!;
}

/**
 * Relic fragments actually read this run. Reading is the only thing that shortens the ritual, so
 * it counts relics the crew held F beside, never relics the world merely contains.
 */
export function relicsRead(discovered: readonly number[], lore: readonly LoreFragment[]): number {
  return discovered.filter((index) => lore[index]?.kind === 'relic').length;
}

/** 0-1 relics read: nothing. 2-3: one relay already remembers you. 4+: two. */
export function preActivatedRelays(relics: number): number {
  return Math.min(2, Math.floor(relics / 2));
}

export function anchorDischargeMs(relics: number): number {
  return ANCHOR_DISCHARGE_MS - ANCHOR_DISCHARGE_MS_PER_RELIC * Math.min(ANCHOR_DISCHARGE_RELIC_CAP, relics);
}

export function anchorInstruction(anchor: AnchorState, cleared: boolean): string {
  const ritual = anchor.ritual;
  if (!ritual) return anchor.state === 'planted' ? 'Anchor secured'
    : anchor.state === 'planting' ? `Planting Anchor · ${Math.floor(anchor.progress * 100)}%`
      : 'Hold F at the Anchor to secure this world';
  if (!cleared) return 'Defeat the Custodian to release the relays';
  const remembered = ritual.relays.filter((relay) => relay.activated).length;
  switch (ritual.stage) {
    case 'locked':
    case 'relays': {
      const head = remembered > 0 && remembered === ritual.activeRelay
        ? `${remembered === 1 ? 'One relay' : `${remembered} relays`} already remember you · ` : '';
      return `${head}Relay ${Math.min(3, ritual.activeRelay + 1)}/3 · tap F at the lit relay · dash through pulses`;
    }
    case 'core': return 'Circuit restored · return to the Anchor and tap F to release it';
    case 'discharging': return 'RELAY ESTABLISHED · the world is holding';
    case 'collapse': return 'The world is coming down · get back to the portal';
    case 'extraction': return 'Stand on a pedestal to carry one thing out';
    case 'stranded': return 'The Anchor held. The crew did not get out.';
    case 'complete': return 'World secured · your signal will remain';
  }
}
