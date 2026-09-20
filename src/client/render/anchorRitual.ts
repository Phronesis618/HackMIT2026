import type Phaser from 'phaser';
import type { AnchorState } from '../../shared/contracts';
import { ANCHOR_DISCHARGE_MS, ANCHOR_PULSE_WARNING_MS } from '../../shared/finale';
import { RELAY_LATCH_MS_SOLO } from '../../shared/custodian';

export function drawAnchorRitual(
  g: Phaser.GameObjects.Graphics, anchor: AnchorState, timeMs: number, accent: number, roomRadius: number,
): void {
  const ritual = anchor.ritual;
  if (!ritual) return;
  ritual.relays.forEach((relay, index) => {
    const active = ritual.stage !== 'locked' && index === ritual.activeRelay;
    const latched = relay.latchedMs ?? 0;
    // Phase 3: the Custodian darkens one relay at a time, and remembers where you stood at the
    // others. The ring ticking down IS the latch (BOSS_FINALE.md §4).
    const color = relay.inert === true ? 0x3b4252 : latched > 0 ? 0x7cf5ff
      : relay.activated ? 0x5ef0b0 : active ? accent : 0x64748b;
    if (latched > 0) {
      const fraction = Math.min(1, latched / RELAY_LATCH_MS_SOLO);
      g.lineStyle(3, 0x7cf5ff, 0.9).beginPath()
        .arc(relay.x, relay.y, 24, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2, false).strokePath();
      g.lineStyle(2, 0x7cf5ff, 0.5).lineBetween(relay.x, relay.y, anchor.x, anchor.y);
    }
    if (relay.inert === true) {
      g.lineStyle(2, 0x3b4252, 0.9).lineBetween(relay.x - 9, relay.y - 9, relay.x + 9, relay.y + 9);
      g.lineStyle(2, 0x3b4252, 0.9).lineBetween(relay.x + 9, relay.y - 9, relay.x - 9, relay.y + 9);
    }
    g.lineStyle(relay.activated ? 3 : 1, color, relay.activated ? 0.8 : 0.22)
      .lineBetween(relay.x, relay.y, anchor.x, anchor.y);
    g.fillStyle(color, 0.15).fillCircle(relay.x, relay.y, active ? 21 : 16);
    g.lineStyle(active ? 3 : 1.5, color, 0.9).strokeCircle(relay.x, relay.y, active ? 21 : 16);
    g.lineStyle(2, color, 0.9).strokeRect(relay.x - 6, relay.y - 6, 12, 12);
    if (active) g.lineStyle(1, color, 0.45 + Math.sin(timeMs / 170) * 0.25).strokeCircle(relay.x, relay.y, 28);
  });
  if (ritual.activeRelay > 0 && (ritual.stage === 'relays' || ritual.stage === 'core')) {
    if (ritual.pulseWarningMs > 0) {
      const warning = 1 - ritual.pulseWarningMs / ANCHOR_PULSE_WARNING_MS;
      g.lineStyle(3, 0xff5c7a, 0.5 + warning * 0.5).strokeCircle(anchor.x, anchor.y, 36 + warning * 12);
    } else {
      g.lineStyle(10, 0xff5c7a, 0.12).strokeCircle(anchor.x, anchor.y, ritual.pulseRadius);
      g.lineStyle(2, 0xff5c7a, 0.85).strokeCircle(anchor.x, anchor.y, ritual.pulseRadius);
    }
  }
  if (ritual.stage === 'discharging') {
    const fraction = ritual.dischargeMs / ANCHOR_DISCHARGE_MS;
    g.lineStyle(8 * (1 - fraction) + 1, accent, 1 - fraction)
      .strokeCircle(anchor.x, anchor.y, 30 + fraction * roomRadius);
    g.fillStyle(accent, 0.24 * (1 - fraction)).fillCircle(anchor.x, anchor.y, 36 + fraction * 120);
  }
}
