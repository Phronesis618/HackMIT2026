import { useEffect, useState } from 'react';
import { crewReadiness, GATE_FORCE_START_UI_MS, type CrewReadiness } from '../../shared/headquarters';
import { CLASS_THEME } from '../../shared/registry';
import type { UiPlayer } from '../../shared/ui';

/**
 * Co-op ready-up at the departure gate (HUB.md §7). Nothing is decided here: `ready` arrives
 * stamped on the server's snapshot and reaches the hub UI through `UiModel.players`.
 */
export function gateFromPlayers(players: readonly UiPlayer[]): CrewReadiness {
  return crewReadiness(players);
}

/** `1 / 2 READY`, or `READY` for a crew of one. */
export function gateReadout(gate: CrewReadiness): string {
  return gate.solo ? 'READY' : `${gate.ready} / ${gate.total} READY`;
}

/**
 * One seat can never strand the crew: after `GATE_FORCE_START_UI_MS` of a closed gate the host's
 * button opens anyway. The server allows the override a little earlier (`GATE_FORCE_START_MS`),
 * so the press is never refused. Returns true while that override is on offer.
 */
export function useGateOverride(blocked: boolean): boolean {
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    if (!blocked) {
      setOffered(false);
      return;
    }
    const timer = setTimeout(() => setOffered(true), GATE_FORCE_START_UI_MS);
    return () => clearTimeout(timer);
  }, [blocked]);
  return offered;
}

/** One chip per seat along the top of the hub stage; the local operative is outlined cyan. */
export function CrewStrip({ players }: { players: readonly UiPlayer[] }) {
  if (players.length < 2) return null;
  const gate = gateFromPlayers(players);
  return (
    <ul className="hq-crew" aria-label="Crew at the departure gate">
      {players.map((seat) => {
        const connected = seat.connected !== false;
        const ready = seat.ready === true;
        return (
          <li
            key={seat.id}
            className={`hq-crew__chip${seat.isLocal ? ' hq-crew__chip--local' : ''}${ready ? ' hq-crew__chip--ready' : ''}${connected ? '' : ' hq-crew__chip--offline'}`}
            style={{ ['--seat-color' as string]: CLASS_THEME[seat.classId].primary }}
          >
            <span className="hq-crew__name">{seat.displayName}</span>
            <span className="hq-crew__class">{CLASS_THEME[seat.classId].title}</span>
            <span className="hq-crew__state">{!connected ? 'offline' : ready ? 'ready' : 'not ready'}</span>
          </li>
        );
      })}
      <li className="hq-crew__gate" role="status">{gateReadout(gate)}</li>
    </ul>
  );
}
