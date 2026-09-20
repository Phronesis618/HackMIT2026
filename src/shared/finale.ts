import type { AnchorState, EnemyState } from './contracts';

export const RELAY_ACTIVATION_RANGE = 42;
export const ANCHOR_PULSE_WARNING_MS = 1300;
export const ANCHOR_PULSE_SPEED = 180;
export const ANCHOR_DISCHARGE_MS = 1600;

export function guardianPhase(hp: number, maxHp: number): 1 | 2 | 3 {
  return hp > maxHp * 2 / 3 ? 1 : hp > maxHp / 3 ? 2 : 3;
}

export function guardianTitle(enemy: EnemyState): string {
  const phase = enemy.bossPhase ?? guardianPhase(enemy.hp, enemy.maxHp);
  return ['THE LAST CUSTODIAN · WATCH', 'THE LAST CUSTODIAN · FRACTURE', 'THE LAST CUSTODIAN · LAST LIGHT'][phase - 1]!;
}

export function anchorInstruction(anchor: AnchorState, cleared: boolean): string {
  const ritual = anchor.ritual;
  if (!ritual) return anchor.state === 'planted' ? 'Anchor secured'
    : anchor.state === 'planting' ? `Planting Anchor · ${Math.floor(anchor.progress * 100)}%`
      : 'Hold F at the Anchor to secure this world';
  if (!cleared) return 'Defeat the Custodian to release the relays';
  switch (ritual.stage) {
    case 'locked':
    case 'relays': return `Relay ${Math.min(3, ritual.activeRelay + 1)}/3 · tap F at the lit relay · dash through pulses`;
    case 'core': return 'Circuit restored · return to the Anchor and tap F to release it';
    case 'discharging': return 'RELAY ESTABLISHED · the world is holding';
    case 'complete': return 'World secured · your signal will remain';
  }
}
