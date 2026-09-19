# RELAY demo runbook

## Start a solo or LAN host

```bash
npm ci
npm run check
npm run build
HOST=0.0.0.0 npm start
```

Open `http://localhost:8787` for solo play. For co-op, everyone opens
`http://<host-lan-ip>:8787/?mode=coop` on the same network, or uses **Join co-op**.
The first connected player hosts the shared crew. One server holds one crew of at most four
players. No player needs an OpenAI account; only the Node server uses generation credentials.

For a container host, use the production-container commands in the README.

## Presentation sequence

1. Start at headquarters. Choose a class and enter a display name.
2. Each player contributes an idea. The host presses **Prepare world**.
3. Read the creation receipt before entering. State the provenance label aloud:
   **LIVE**, **OFFLINE FIXTURE**, or **FALLBACK FIXTURE**. Unused contributions must remain
   visibly unused; authored fixtures do not become generated worlds because a player typed.
4. Enter the portal together. Pause briefly for the first-room reveal and arrival keepsake.
5. Show movement, a directional attack, a dash through danger and the class's Q ability.
6. Clear a room, spend the earned resource on the E unlock and demonstrate its effect.
7. Continue through three rooms. Defeat the Guardian, approach the Anchor and hold F.
8. Review the debrief, return to headquarters and show the new event-derived memories.
9. Reload to show that the memory wall persists on this browser. Co-op shares event content;
   storage and captured arrival images belong to each browser.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD or arrows |
| Aim | Mouse |
| Attack | J or left click |
| Dash | Shift or Space |
| Class ability | Q |
| Unlocked ability | E |
| Interact / revive | Hold F nearby |
| Sound | Sound on/off in the top bar |

Attacks and abilities are presses, not automatic repeats. Release movement before typing an
idea. Sound starts after a user gesture.

## Generation configuration

Default mode uses validated fixtures and makes no paid requests. To enable live generation,
set `RELAY_GENERATION_MODE=live`, `OPENAI_API_KEY`, and an available `OPENAI_MODEL` on the
server, then restart it. Never expose the key through a `VITE_` variable.

The receipt reports the actual generation source. Missing credentials, timeouts, rejected
model output, or unavailable models can fall back to an explicitly labelled fixture.
The first committed room can be entered while later rooms arrive; an uncommitted exit must
wait for its destination.

## Recovery

- If the crew disconnects, use the displayed connection state to rejoin; do not present a
  frozen scene as active multiplayer.
- If the host leaves, check who now owns the host controls before requesting another world.
- A failed run returns through the debrief to headquarters for another attempt.
- Do not clear the memory wall while demonstrating persistence.
- For an offline solo rehearsal, use `/?world=fixture`. Preview room jumps
  (`&room=1` or `&room=2`) are inspection aids, not evidence of completing an expedition.

## Evidence

Use `docs/QA.md` for the verified scope and external prerequisites. A local two-client test
does not establish Wi-Fi/firewall behavior on the venue's network. Rehearse that network
before presenting.
