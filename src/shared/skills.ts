/**
 * Skill tree — content and shape. Effects are NOT wired to the simulation yet (every node
 * is `status: 'planned'`); the tree is real design data a future pass hooks up, and the
 * menu renders it as a vertical tree (root at the bottom, tiers climbing upward).
 *
 * Three sources feed one tree:
 *  - core:       shared operative spine (tiers 0–1, centre lane)
 *  - class:      one authored tree per class (tiers 1–5, lanes -1/0/+1)
 *  - attunement: grown by the world itself — the model picks a registry effect and names
 *                it in the world's voice (`recipe.attunements`); a right-hand branch.
 *
 * Owner: Agent A (shape). Content lives here so the four classes read as one system.
 */
import { ATTUNEMENT_EFFECT_INFO, CLASS_INFO, type AttunementEffectId, type ClassId } from './registry';

export type SkillKind = 'core' | 'class' | 'attunement';

export interface SkillNode {
  id: string;
  name: string;
  /** Player-facing intended effect. */
  description: string;
  /** Row, 0 at the root (bottom). */
  tier: number;
  /** Column: 0 is the spine, negative left, positive right. */
  lane: number;
  requires: string[];
  cost: number;
  kind: SkillKind;
  effectId?: AttunementEffectId;
  status: 'planned' | 'implemented';
}

export interface SkillTree {
  title: string;
  subtitle: string;
  nodes: SkillNode[];
  tiers: number;
}

export interface SkillWorldContext {
  title: string;
  attunements: Array<{ effectId: AttunementEffectId; name: string; description: string }>;
}

const planned = (node: Omit<SkillNode, 'status' | 'kind'>, kind: SkillKind): SkillNode => ({ ...node, kind, status: 'planned' });

const CORE: SkillNode[] = [
  { id: 'core.root', name: 'Relay Bond', description: 'The operative’s link to the relay. Everything grows from here.', tier: 0, lane: 0, requires: [], cost: 0 },
  { id: 'core.plating', name: 'Reinforced Plating', description: '+20 max Integrity.', tier: 1, lane: -1, requires: ['core.root'], cost: 2 },
  { id: 'core.wind', name: 'Second Wind', description: 'Dash cooldown −25%; invulnerability window +50 ms.', tier: 1, lane: 0, requires: ['core.root'], cost: 2 },
  { id: 'core.salvage', name: 'Salvager', description: 'Cleared rooms yield +1 resource.', tier: 1, lane: 1, requires: ['core.root'], cost: 2 },
].map((n) => planned(n, 'core'));

const CLASS_TREES: Record<ClassId, Array<Omit<SkillNode, 'status' | 'kind'>>> = {
  bastion: [
    { id: 'bastion.sweep', name: 'Wider Sweep', description: 'Arc-blade arc +30%; strikes hit up to three targets.', tier: 2, lane: -1, requires: ['core.plating'], cost: 3 },
    { id: 'bastion.plate', name: 'Plated Guard', description: 'Bulwark lasts 3.2 s and blocks 90% of melee instead of 80%.', tier: 2, lane: 0, requires: ['core.wind'], cost: 3 },
    { id: 'bastion.footing', name: 'Held Ground', description: 'Immune to knockback while Bulwark is up; +10% move speed with the shield down.', tier: 3, lane: -1, requires: ['bastion.sweep'], cost: 4 },
    { id: 'bastion.reflect', name: 'Mirror Plating', description: 'Bolts blocked by Bulwark are thrown back along their line.', tier: 3, lane: 0, requires: ['bastion.plate'], cost: 4 },
    { id: 'bastion.radius', name: 'Wide Shockwave', description: 'Shockwave radius 135 → 180; stun +0.5 s.', tier: 3, lane: 1, requires: ['core.salvage', 'bastion.plate'], cost: 4 },
    { id: 'bastion.taunt', name: 'Beacon of Steel', description: 'Enemies within 200 prefer you over allies while Bulwark is up.', tier: 4, lane: -1, requires: ['bastion.footing'], cost: 5 },
    { id: 'bastion.aftershock', name: 'Aftershock', description: 'Shockwave leaves a 2 s zone that slows anything crossing it.', tier: 4, lane: 1, requires: ['bastion.radius'], cost: 5 },
    { id: 'bastion.slam', name: 'Deeper Slam', description: 'Aegis Slam damage +25% and it fully recharges Bulwark.', tier: 4, lane: 0, requires: ['bastion.reflect'], cost: 5 },
    { id: 'bastion.last_light', name: 'Bastion of Last Light', description: 'At 25% Integrity, Bulwark raises itself once per room.', tier: 5, lane: 0, requires: ['bastion.taunt', 'bastion.slam', 'bastion.aftershock'], cost: 8 },
  ],
  shade: [
    { id: 'shade.edge', name: 'Keen Edge', description: 'Phase blades +4 damage; attack cadence +10%.', tier: 2, lane: -1, requires: ['core.plating'], cost: 3 },
    { id: 'shade.step', name: 'Long Step', description: 'Phase Step range 112 → 150 and it passes through bolts.', tier: 2, lane: 0, requires: ['core.wind'], cost: 3 },
    { id: 'shade.afterimage', name: 'Afterimage', description: 'Phase Step leaves a decoy that draws melee attacks for 1 s.', tier: 3, lane: -1, requires: ['shade.edge'], cost: 4 },
    { id: 'shade.echo', name: 'Twin Step', description: 'Phase Step may be cast twice within 1.5 s.', tier: 3, lane: 0, requires: ['shade.step'], cost: 4 },
    { id: 'shade.veil', name: 'Longer Shroud', description: 'Shroud lasts 3.2 s and the empowered strike also slows.', tier: 3, lane: 1, requires: ['core.salvage', 'shade.step'], cost: 4 },
    { id: 'shade.bleed', name: 'Opened Vein', description: 'Empowered Shroud strikes deal 30% of their damage again over 3 s.', tier: 4, lane: -1, requires: ['shade.afterimage'], cost: 5 },
    { id: 'shade.storm', name: 'Wider Storm', description: 'Blade Storm radius +30% and a fourth cut.', tier: 4, lane: 0, requires: ['shade.echo'], cost: 5 },
    { id: 'shade.hunter', name: 'Hunter’s Patience', description: 'Killing from Shroud refunds half its cooldown.', tier: 4, lane: 1, requires: ['shade.veil'], cost: 5 },
    { id: 'shade.unseen', name: 'Never Seen', description: 'Enemies lose you for 0.6 s after every dash.', tier: 5, lane: 0, requires: ['shade.bleed', 'shade.storm', 'shade.hunter'], cost: 8 },
  ],
  beacon: [
    { id: 'beacon.reach', name: 'Far Lantern', description: 'Lantern staff range 240 → 300.', tier: 2, lane: -1, requires: ['core.plating'], cost: 3 },
    { id: 'beacon.flare', name: 'Bright Flare', description: 'Flare radius +25%; marked enemies take 40% more instead of 30%.', tier: 2, lane: 0, requires: ['core.wind'], cost: 3 },
    { id: 'beacon.embers', name: 'Embers', description: 'Flare leaves a 3 s burning zone.', tier: 3, lane: -1, requires: ['beacon.reach'], cost: 4 },
    { id: 'beacon.chain', name: 'Chain Mark', description: 'Killing a marked enemy spreads the mark to the nearest hostile.', tier: 3, lane: 0, requires: ['beacon.flare'], cost: 4 },
    { id: 'beacon.rally', name: 'Wider Rally', description: 'Rally range 200 → 280 and heals 45.', tier: 3, lane: 1, requires: ['core.salvage', 'beacon.flare'], cost: 4 },
    { id: 'beacon.pierce', name: 'Piercing Light', description: 'Basic strikes pass through the first enemy hit.', tier: 4, lane: -1, requires: ['beacon.embers'], cost: 5 },
    { id: 'beacon.lance', name: 'Sunlance', description: 'Solar Lance width doubles and marks for 6 s.', tier: 4, lane: 0, requires: ['beacon.chain'], cost: 5 },
    { id: 'beacon.mend', name: 'Standing Mend', description: 'Rallied allies regenerate 2 Integrity/s for its duration.', tier: 4, lane: 1, requires: ['beacon.rally'], cost: 5 },
    { id: 'beacon.dawn', name: 'Dawn Protocol', description: 'When an ally is downed, Rally is instantly ready.', tier: 5, lane: 0, requires: ['beacon.pierce', 'beacon.lance', 'beacon.mend'], cost: 8 },
  ],
  weaver: [
    { id: 'weaver.loom', name: 'Tight Loom', description: 'Plasma loom strikes slow for 1.5 s instead of 1 s.', tier: 2, lane: -1, requires: ['core.plating'], cost: 3 },
    { id: 'weaver.tether', name: 'Long Tether', description: 'Tether range 220 → 300; pulls stun for 0.4 s.', tier: 2, lane: 0, requires: ['core.wind'], cost: 3 },
    { id: 'weaver.snare', name: 'Snare Line', description: 'Tether also catches enemies between you and the target.', tier: 3, lane: -1, requires: ['weaver.loom'], cost: 4 },
    { id: 'weaver.rewind', name: 'Deep Rewind', description: 'Rewind reaches 5 s back and clears slows and marks.', tier: 3, lane: 0, requires: ['weaver.tether'], cost: 4 },
    { id: 'weaver.wake', name: 'Rewind Wake', description: 'Rewind leaves a damaging seam along the path you retrace.', tier: 3, lane: 1, requires: ['core.salvage', 'weaver.tether'], cost: 4 },
    { id: 'weaver.knot', name: 'Knotted Time', description: 'Enemies you slow also attack 30% slower.', tier: 4, lane: -1, requires: ['weaver.snare'], cost: 5 },
    { id: 'weaver.collapse', name: 'Wider Collapse', description: 'Collapse pull 200 → 260 and it holds enemies 0.6 s longer.', tier: 4, lane: 0, requires: ['weaver.rewind'], cost: 5 },
    { id: 'weaver.thread', name: 'Spare Thread', description: 'Rewind may be cast on a downed ally to stand them up at 20 Integrity.', tier: 4, lane: 1, requires: ['weaver.wake'], cost: 5 },
    { id: 'weaver.reweave', name: 'Reweave', description: 'Once per room, lethal damage instead rewinds you 3 s.', tier: 5, lane: 0, requires: ['weaver.knot', 'weaver.collapse', 'weaver.thread'], cost: 8 },
  ],
};

/**
 * Builds the tree the menu shows: core spine + this class + the world's attunement branch
 * (a chain up the right edge, rooted in the Salvager node). Attunements are the part of
 * the tree that changes with the players' prompt, because the world itself wrote them.
 */
export function buildSkillTree(classId: ClassId, world: SkillWorldContext | null): SkillTree {
  const nodes: SkillNode[] = [...CORE, ...CLASS_TREES[classId].map((n) => planned(n, 'class'))];
  const attunements = world?.attunements ?? [];
  attunements.forEach((a, i) => {
    const id = `attune.${i}.${a.effectId}`;
    nodes.push({
      id, name: a.name,
      description: `${a.description} (${ATTUNEMENT_EFFECT_INFO[a.effectId].summary})`,
      tier: 2 + i, lane: 2, requires: [i === 0 ? 'core.salvage' : `attune.${i - 1}.${attunements[i - 1]!.effectId}`],
      cost: 3 + i, kind: 'attunement', effectId: a.effectId, status: 'planned',
    });
  });
  const tiers = Math.max(...nodes.map((n) => n.tier)) + 1;
  return {
    title: `${CLASS_INFO[classId].name} tree`,
    subtitle: world ? `Attuned to ${world.title}` : 'No world attuned — attunements grow once a world is prepared',
    nodes,
    tiers,
  };
}
