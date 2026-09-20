/**
 * Skill tree — SCAFFOLD ONLY. The shape is real so the menu can render it and a future
 * pass can wire nodes to the simulation; every node below is a placeholder and none of
 * them do anything yet (`status: 'planned'`). Owner: Agent A (shape).
 */
import type { ClassId } from './registry';

export interface SkillNode {
  id: string;
  name: string;
  /** Player-facing summary of the intended effect. */
  description: string;
  /** Column/row on the tree grid; connectors are drawn to `requires`. */
  tier: number;
  lane: number;
  requires: string[];
  cost: number;
  status: 'planned' | 'implemented';
}

export interface SkillTree {
  classId: ClassId | 'all';
  title: string;
  nodes: SkillNode[];
}

const shared: SkillNode[] = [
  { id: 'core.integrity', name: 'Reinforced Plating', description: '+20 max Integrity.', tier: 0, lane: 1, requires: [], cost: 2, status: 'planned' },
  { id: 'core.dash', name: 'Second Wind', description: 'Dash cooldown −25%.', tier: 1, lane: 0, requires: ['core.integrity'], cost: 3, status: 'planned' },
  { id: 'core.salvage', name: 'Salvager', description: 'Cleared rooms yield +1 resource.', tier: 1, lane: 2, requires: ['core.integrity'], cost: 3, status: 'planned' },
  { id: 'core.revive', name: 'Field Medic', description: 'Revive teammates twice as fast.', tier: 2, lane: 0, requires: ['core.dash'], cost: 4, status: 'planned' },
  { id: 'core.ult', name: 'Overcharge', description: 'Ultimate charges 30% faster.', tier: 2, lane: 2, requires: ['core.salvage'], cost: 4, status: 'planned' },
  { id: 'core.relay', name: 'Relay Attunement', description: 'Reading a relic restores Integrity.', tier: 3, lane: 1, requires: ['core.revive', 'core.ult'], cost: 6, status: 'planned' },
];

export const SKILL_TREES: SkillTree[] = [{ classId: 'all', title: 'Operative core', nodes: shared }];
