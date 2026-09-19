# design/

Agent C owns this folder. `tokens.json` holds visual token VALUES (keys/schema live in
`src/shared/tokens.ts`). Put original sprite sheets, audio and reference boards here and state
the license/origin of anything not made by the team. No copied game assets.

The sanctuary architecture, portal platform, character silhouettes, props and motif markings
in `src/client/render/` are original procedural vector drawings authored for RELAY. They
require no downloaded assets, external URLs or font requests. Character poses follow
authoritative snapshots; combat effects follow game events. The archive frames in the
canvas are empty architecture; actual event-derived keepsakes appear in the memory wall.

`audio/cues.json` contains original tone sequences authored for RELAY. The browser synthesizes
them with Web Audio after a user gesture; there are no samples, downloads or third-party
audio licenses. Sound can be muted in the top bar; that preference is stored on the device.
