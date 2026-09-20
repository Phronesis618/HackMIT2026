# Exemplar bank

101 exemplars across four invented worlds, written for RELAY in imitation of the structures described in `docs/WRITING.md` section 6. Original text; nothing copied. Every exemplar passes `lintProse` with its world's bible (`tests/shared/prose.test.ts` checks this on each run).

| File | World | Authors and registers |
| --- | --- | --- |
| `cinder-ward-9.json` | Orbital quarantine ward locked by its billing system | night nurse's handover notes · billing clerk's letters · union steward's grievance forms |
| `tollgate-meridian.json` | Desert rail customs post with a train shut in the gate | chief inspector's seizure receipts · smuggler's letters to her brother · signalman's timetable notes |
| `glasshouse-12.json` | Seed-trial dome whose irrigation controller lost its yield cap | trial lead's plant labels · cook's menu board · the controller's own log |
| `swan-lock.json` | Canal lock and its pub, drained over a 3-pint bet | a child's letters to her mum · the landlady's slate of tabs and bets · a skipper's verses painted on her cabin |

Swan Lock is the world with no institution in it: no forms, no log, a private cause. Keep at least one such world in the bank, or every generated world comes back as an office.

A fifth world, Halloran Deep, is the worked example in `docs/WRITING.md` and supplies two more exemplars per type there.

## File shape

```
{ "world", "licence", "bible": { premise, collapse, people[], places[], objects[], events[], authors[], enemies{} },
  "exemplars": [ { "id", "kind", "world", "author"?, "bibleRefs": [...], "title"?, "source"?, "name"?, "effectId"?, "enemyId"?, "text" } ] }
```

`kind` is a `ProseKind` from `src/shared/prose.ts`. Per world: 6 `relic`, 4 `remains`, 3 each of `roomLine`, `boonDescription`, `itemBlurb`, `biomeTagline`, `bossCallout`. Totals: 18 relics, 12 remains, 9 of each other type. `bibleRefs` lists the event ids, places, objects or enemy kinds the text draws on. `name` is the boon, item or biome name that goes with the text.

## How to inject them

1. Pick by `kind`. Show 3 or 4 per request, never the whole bank: past a handful, more samples do not improve imitation (Wang et al., arXiv 2509.14543), and a fixed set becomes a rhythm the model copies.
2. Rotate. Seed the choice from the world seed so a retry sees the same set and a new world sees a different one. Take the samples from at least two files so no single register dominates.
3. Show each exemplar together with the bible facts it used: `bibleRefs` resolved to the event sentence and the author entry. The thing to imitate is the step from fact to fragment, so the model must see both halves.
4. Tell the model the exemplars are from other worlds and that reusing their names, numbers or objects is an error. The linter's `needs-bible-noun` rule catches this, because those names are absent from the new world's bible.
5. Relics vary on purpose from 2 sentences to about 10, and some are funny and some are flat. Keep that spread in any subset you show.
