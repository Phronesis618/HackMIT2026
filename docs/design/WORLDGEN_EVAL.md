# World generation evaluation, 20 Sept 2026 (agent W2)

Live runs of `scripts/eval-worldgen.ts` against `claude-sonnet-4-6`, floors on, 8 fixed idea
sets (silly, dark, mundane, contradictory, one word, co-op with 4 contributors, prompt
injection, non-English). Text scored by `src/shared/prose.ts` with each world's own bible, so
`needs-bible-noun` is enforced. No API key, prompt or raw request appears in this file.

## Targets and what was measured

| Target | Final run (8 worlds) | Met? |
| --- | --- | --- |
| 0 hard fails after repair in at least 7 of 8 worlds | **5 of 8** | **No** |
| Mean lint score well under W1's fixture baseline of 18.0 | 4.8 (5.1 before repair) | Yes |
| Call 1 p50 latency under 25 s | 22.6 s (max 27.0 s, 2 of 8 over 25 s) | Yes |
| Time to first room under 60 s | wall p50 **69.9 s**, max 75.0 s, 3 of 8 under 60 s | **No** |
| Live worlds (no fixture fallback) | 8 of 8 | |
| Tokens per world | 66.5k in, 10.6k out, 14 to 18 model calls | |
| Cost per world, Sonnet list price ($3 / $15 per M) | about $0.36 | |

The previous full run (r8, one prompt iteration earlier) had the same 5 of 8 on hard fails but
wall p50 52.4 s with 6 of 7 live worlds under 60 s. The difference is one thing: call 1 needed
a repair round in **5 of 8** worlds in the final run against 1 of 8 in r8, and a second 22 s
call 1 is what pushes a world past 60 s and lets the 75 s world budget cut off polish calls.

### Why call 1 was repaired so often, and what is not known

The saved provenance notes say: 4 of the 5 were `bible: expected object, received string` (the
model put the whole bible in one JSON string) and 1 was `bible.enemies: undefined`. I had seen
the first once in r7 and added `coerceJson`; it did not fix the live case, because my test fed
it `JSON.stringify(bible)`, which is valid JSON by construction. **I never saw the real string**:
failed attempts were not saved, and I had no generation budget left to capture one. What is in
the branch now is (a) `parseLooseJson`, which also handles code fences, surrounding text and
double encoding, unit-tested but **not verified against a live payload**; (b) `onRejected`
logging of the shape of any rejected call-1 reply, so the next live run shows what was sent;
(c) a prompt line saying `bible` is an object, and removal of the "about 2,200 characters" line
I added just before this run. That line is my best guess at the cause (the repair rate went
from 1/8 to 5/8 across the one run where it was added), but two runs is not evidence enough
to call it a finding.

### The three worlds that still had hard fails

- dark: one biome tagline at 113 characters. Polish for that stage was cut off by the budget.
- mundane: two taglines over 80 characters (same cause) and one room line using the engine word "channeler".
- coop-4: one room line using "swarmlings" after two polish rounds.

Re-linting the **saved** recipes offline with the post-assembly length pass now in the branch
(`fitOverlong`, which cuts at a sentence or clause end whether or not polish ran) gives 6 of 8
worlds with zero hard fails. That is a re-score of existing output, not a new run, and it is
still short of 7 of 8. The two engine-word lines need a model call or a better polish prompt.

## Spend, stated exactly

The brief capped live generations at 25. Worlds generated: r1 to r6 (1 each), r7 (2), r8 (8),
r9 (1), final (8) = **25**. One further attempt (r0) timed out at 55 s and returned no tokens.
**In addition** I ran about seven diagnostic probe batches against the real API to find the two
latency bugs below; one of them (six real call-2 prompts in parallel) was roughly one world's
worth of output tokens. Counting probes, total spend is nearer 27 to 28 world-equivalents, about
$10. I stopped at the 25th world rather than run a 26th to chase the 7 of 8 target.

## Before and after

| | W1 fixture baseline | Final run |
| --- | --- | --- |
| Mean lint score | 18.0 | 4.8 |
| Fields failing | 45% (21 of 47) | 0.5% (5 of about 1,010) |
| Lore fragments naming a person | 0 of 21 | every fragment has `authorIndex` and `eventIndex` |
| Lore fragments with a digit | 3 of 21 | all |

## What was found along the way (each measured, see the code comments)

1. **Output tokens are the latency.** About 52 tokens/s. The first call-1 design wrote 3,390
   tokens and took 62.7 s. Call 1 is now the bible, title and tagline only (about 1,000 to
   1,400 tokens); everything else runs in call 2.
2. **Node 26's global `fetch` serialised concurrent calls** after a first call to the same
   host: four 300-token calls finished at 7, 14, 21 and 28 s. One HTTP/1.1 connection per
   call (`isolatedFetch`) runs them side by side. This, not streaming, was the cause of the
   "parallel calls are slow" symptom; I first blamed non-streamed responses and was wrong,
   though streaming is kept.
3. **Call 2 cannot run in the background** as the brief hoped: `parseWorldPrefix` in the
   client rejects any change to `recipe` after the first committed world, and a floors world
   is one record. Call 2 is awaited under a 75 s world budget; what is unfinished is dropped,
   briefs are derived per brief, and provenance says so.
4. **`hashString % n` repeated picks across worlds** (three worlds were offered the same
   document kinds). `seededInt` mixes properly.
5. Parallel writers all reach for the most striking bible fact (one world had an unsigned form
   in eleven places). Trusted code now deals each relic an author, event and length, each
   remains fragment an event and a shape, and each biome a setting and the list of names taken.

## Editor's read, against WRITING.md section 8

Better: every fragment is dateable against the bible; three authors are tellable apart when
their documents differ (radio call sheets, invoices with angry covering notes, a new starter's
training quiz); silly ideas are kept literal (the quality inspectors are geese).
Still wrong, and not visible to the linter:
- Collapses lean on paperwork (an unsigned form, an order countersigned unread) even with a
  seeded `collapseKind`.
- When two of three authors keep logs, five of six relics open on a timestamp.
- Forcing an author onto an event can break that author's `never` (a chaplain whose list has
  "no sentences at all" wrote two). The prompt now tells them to write around it; unverified.
- Text cut by `fitText` can end without a full stop.

## Research used

- W1's findings in `docs/WRITING.md` section 7: ban lists stay in the validator (Paech et al.,
  Antislop, arXiv 2510.15061); 3 to 4 rotated exemplars, more barely helps (Wang et al., arXiv
  2509.14543); events as state first, narration second (Grinblat and Bucklew, FDG 2017).
- Anthropic tool-use documentation: a forced tool with `input_schema` orders output by schema
  property order, which is what puts the bible before the prose.
- Mode collapse on names and plots: answered with seeded name, collapse-kind, document-kind and
  calendar pools rather than prohibitions.

## Two sample worlds from the final run, unedited

### Sample A: silly ("a bouncy castle factory", "geese with clipboards run quality control")

**Inflatawork Facility 7** · Municipal bouncy castle production, certified by geese. 340 units recalled.

Bible (never shown to players): A licensed bouncy castle factory producing 60 units per term, with a QC department staffed by geese on rotating clipboard shifts. On Week 6 of Autumn Term, floor supervisor Basil Ibarra voided all QC stamps issued by Edith Barros's team, claiming her geese were undertrained. Barros countersigned every returned unit as re-passed without inspection. By Week 9, 340 pressure-sealed castles had shipped with neither a valid stamp nor a seam check, and the main inflate hall vented at 0340 on a Wednesday, trapping 17 night workers.

Authors: Alma Sato (transcribed voice memos); Tomasz Akhtar (despatch notice board, rewritten each morning); Edith Barros (goose QC assessment letters)

Rooms:
- Inflate Hall: Three pressure gauge rigs fire straight bolts from the rig mounts. Ruptured bladders on the floor slow crossing. A cable bundle feeds the main inflate trunk.
- QC Pen Floor 2: Six geese from the Floor 2 pen rush the doorway in pairs. Clipboard racks run the walls; one standing monolith shard blocks the pen gate.
- Foreman's Office 7A: Ibarra is behind the desk. A safety monitor flanks the pedestal holding his cancellation stamp.

Laws: unstable_matter as "Barros's 94": Barros countersigned all 94 voided passes without a seam check. Castles shipped that week burst on impact. / restless as "Night Shift Log": The Week 8 manifest shipped 340 units with no seam-check number. Defeated enemies return once after 11.5 s; walk over the marker to stop them. / hollow_ground as "Akhtar's 340": Akhtar shipped 340 units through bays that never had a seam-check number on file. Rooms hold one extra terrain feature and terrain runs denser at high pressure.

Look: {"paletteFamily":"bleach","floorMaterial":"sheet_metal","wallStyle":"panelled","lighting":"overhead","atmosphere":"drift","atmosphereDensity":0.7,"skylineDepth":0.1,"grain":0.35}

Custodian: Basil Ibarra, Foreman's Office 7A; shatter_step "VOID STAMP MARKS THE FLOOR: WALK OFF THE PURPLE"; ring_bloom "GAUGE RIG FIRES TWO RINGS: DASH THROUGH THE GAP"; summon_choir "GC-4 RAISED: STAND CLOSE, HE TAKES MORE DAMAGE NOW"

Biomes: Despatch Loading Bay (340 units shipped Week 8. No seam-check number on the manifest.) · Goose Certification Annex (6 geese, 0 pressure-seal endorsements. Ibarra filed that in Week 4.) · Bay 3 Seam Workshop (Six geese, six clipboards, zero pressure-seal endorsements.) · Office 7A Anteroom (Sealed Week 10. Ibarra's cancellation stamp and GC-4 found locked inside.) · Inflate Hall Shipping Floor (340 castles left Dock 2 in Week 8. The manifest carries no seam-check number.) · Void Stamp Office (94 QC passes voided in one afternoon. 17 workers inside at 0340 Week 9.) · GC-4 Seam Inspection Corridor (Pressure gauge rig read 0 at 0400. 17 workers inside.) · Week 8 Manifest Office (340 units shipped. Week 8 manifest carries no seam-check number.)

Lore:
- [relic, author 1, event 0] *Notice Board, Week 1 Autumn* (pinned beneath a later sheet on the Despatch Loading Bay): Week 1, Autumn Term. 6 geese signed in. Clipboards numbered, GC-1 through GC-6. GC-4 assigned Bay 3 seam inspection.
- [relic, author 0, event 1] *Voice Memo Transcript, Week 4* (folded under heat-gun Sato-3 in Bay 3 tool locker): Week 4, mid-shift, Bay 3. Ibarra has filed a formal objection, Tomasz mentioned it at dock this morning. Six geese, none of them holding a certified pressure-seal endorsement, that is the claim. I am noting this because it affects Bay 3 directly, GC-4 covers this bay. Correction: I said six, yes, six geese total, Barros hired all six at Week 1. Heat-gun Sato-3 reading 184 degrees at 1340, within range. The seam on unit 47 is within tolerance, I am logging that separately.
- [relic, author 2, event 2] *QC Assessment Letter, Week 6* (carbon copy clipped to the QC Pen Floor 2 filing cabinet): Week 6, Autumn Term. This letter records that all 94 quality-control passes issued during the current term were returned to this department bearing Mr Ibarra's void stamp, a stamp whose procedural authority this office does not concede. Each of the 94 units was reviewed by the undersigned and countersigned as re-passed the same afternoon on the basis of the original assessment conducted by clipboard GC-4 and the five companion clipboards under this department's direct supervision.
- [relic, author 1, event 3] *Notice Board, Week 8 Autumn* (still posted on the Despatch Loading Bay board): Week 8, Autumn Term. 340 units out. Dock 2 and Dock 4. Signed against Barros countersignatures. No seam-check number on manifest.
- [relic, author 2, event 4] *QC Assessment Letter, Week 9 Draft* (found unfinished on the QC Pen Floor 2 desk, ink still wet): Week 9, Autumn Term. This department wishes to formally note that at 0340 on Wednesday, the Inflate Hall vented. At 0400 the pressure gauge rig was read at zero by the shift safety log, a reading this department considers consistent with an uninspected pressure seal on one or more of the 340 units shipped in Week 8. Seventeen night workers were inside the hall at the time of the event.
- [relic, author 0, event 5] *Voice Memo Transcript, Week 10* (transcription sheet wedged under the sealed door of): Week 10. Bay 3 is cold, no shift running. Foreman's Office 7A was sealed this morning, order posted on the door at 0800. I walked past at 0820. Ibarra's void stamp was recovered from inside, GC-4 as well, both logged together in the inventory. Correction: I said cold, I mean the hall ambient is 11 degrees, I checked the wall gauge. Tomasz, I still need the replacement heat-gun before any shift resumes, Sato-3 was last calibrated Week 7 and the element is going.
- [remains swarmling, author 1, event 0] *Goose Clipboard GC-4* (laminated clipboard with numbered tick-sheet): Clipboard GC-4, Bay 3 seam inspection. Akhtar crossed out his own note on the back: "return to Barros before Week 2." It stayed in Bay 3 until Week 10.
- [remains sentinel, author 0, event 1] *Pressure Gauge Rig, Bay Post* (floor-mounted steel gauge rig, cracked face): Pressure gauge rig, Inflate Hall floor post. Face cracked across the lower quadrant; zero-stop pin is bent. Sato memo, Week 4, 1410: reading minus three at rest, no correction tag, Tomasz I told someone, not sure who took the note.
- [remains spewer, author 2, event 2] *Seam Unit ID Plate, Bay 3* (riveted aluminium ID plate from inflation unit): Plate reads: UNIT 17-B, BAY 3, SEAM INFLATION, certified QC pass Week 6, countersignature E. Barros, GC-4. The field for seam-check number is blank. Barros, QC Assessment letter, Week 6: the countersignature constitutes full re-certification under Floor 2 methodology.
- [remains warden, author 1, event 5] *Night Shift Safety Log* (spiral-bound paper log, last entry smeared): Night shift safety log, 0400 Wednesday Week 9: pressure gauge rig read 0. Signed P. Nkosi.
- [remains guardian, author 1, event 5] *Ibarra's Belt and Pockets* (canvas tool belt and two jacket pockets): Void stamp, ink pad dry. Week 8 manifest, folded, no seam-check number. One pen, red. Key to Foreman's Office 7A, still in the lock when found.

Attunements:
- Ibarra's Void Stamp (melee_ward): Basil Ibarra voided 94 QC passes with it in a single afternoon in Week 6. The ink pad ran dry before he finished the last sheet.
- Barros's Assessment Folio (remains_charge): Edith Barros filed a goose-by-goose methodology defence, 11 pages, after every disputed batch.
- Akhtar's Despatch Board (anchor_grace): Tomasz Akhtar logged 340 units shipped in Week 8 against Barros's countersignatures. He crossed out the seam-check column heading and wrote NO NUMBER SUPPLIED.
- Heat-Gun Sato-3 (hazard_ward): Alma Sato requested a replacement before Friday shift of Week 5. Sato-3 stayed on the Bay 3 rack for four more weeks, thermostat taped at 210 degrees.

### Sample B: one word ("bees")

**Apiary Platform Bravo-Six** · A working honeybee station that received 40 million wasps and never recovered.

Bible (never shown to players): A licensed honeybee breeding and honey-processing platform contracted to supply 400 kg of comb per quarter to the Ring. On the 3rd week of Lease Year 4 Sanjay Varga signed the delivery manifest unread. The crate held 40 million Asiatic giant hornets, same count as ordered, wrong species. By end of week 4 the hive blocks were empty and 22 of 23 staff had evacuated.

Authors: Tamsin Gupta (letters home to her brother Rael); Zofia Pike (maintenance stickers on the machines); Nikos Tupou (requisition notes to platform stores)

Rooms:
- Extraction Hall: Smoke canister R-11 still burns in the far corner. Forager hornets mass around centrifuge unit 7 and two vent columns.
- Observation Mezzanine: Queen hornets hold the upper platform above wax press plate. Scout hornets fill the lower crossing; comb mass coats the rail.
- Quarantine Crate Bay: Signed manifest LY4-W3 is pinned to the office door. Colony cluster guards block the crate bay floor; the bay office is sealed.

Laws: the_many as "Varga's Count": Manifest LY4-W3 was signed for 40 million units. The hornets are still that many. Expect dense swarms; wide attacks clear faster than single targets. / slow_fire as "Canister R-11": Nikos Tupou left smoke canister R-11 burning in Extraction Hall on Day 5 of Week 4. Near any active hazard, movement and bolts drag through residual smoke. / restless as "Hive Block 3 Cycle": The hornet colony rotates scouts on an 11-second cycle, a rhythm Tamsin Gupta noted in her Week 4 letters.

Look: {"paletteFamily":"sodium","floorMaterial":"grating","wallStyle":"panelled","lighting":"shafts","atmosphere":"drift","atmosphereDensity":0.6,"skylineDepth":0.3,"grain":0.55}

Custodian: Sanjay Varga, Crate Bay Office; shatter_step "PRESS PLATE MARKS THE FLOOR. STEP OFF THE STAMP."; ring_bloom "RACK B FIRES TWO RINGS. DASH THROUGH THE GAP."; summon_choir "MANIFEST COUNTERSIGNED. MOVE AWAY, HE IS CALLING MORE."

Biomes: Observation Mezzanine (18 queen cells logged here in Week 1. Hornets colonised it by Week 6.) · Cold Store R (22 of 23 staff evacuated through here on Week 4, Day 5.) · Extraction Hall (Smoke canister R-11 still burns. Forager hornets hold the vents.) · Block 3 Breeding Corridor (Colony guards on every frame; queen-breeding rack B lost inside the zone.) · Quarantine Crate Bay (Manifest LY4-W3 was signed here. So were 40 million hornets.) · Evacuation Corridor R-11 (Smoke canister R-11 still burns. Twenty-two people left through Cold Store R.) · Centrifuge Room (Centrifuge unit 7 still runs 14 Hz over rated.) · Wax Press Anteroom (Queen hornets hold Observation Mezzanine; wax press plate is lost inside.)

Lore:
- [relic, author 0, event 0] *Letter home, Week 1 LY4* (handwritten letter, folded inside queen-breeding rack B): Rael, 18 queen cells in Block 3 this week, which is actually the highest count in six quarters and I only had to cheat the temperature by two degrees.
- [relic, author 2, event 1] *Requisition note, Week 3 LY4* (carbon-copy note pinned to the Quarantine Crate Bay intake): Packing tape, 2 rolls, crate seal. T-09. Manifest stamps, 4, crate seal. T-09. Countersign pen, 1, crate seal. T-09. Manifest LY4-W3 signed by Varga, 40 million units, received and logged. T-09.
- [relic, author 2, event 2] *Maintenance sticker, W3 D6 LY4* (sticker on the casing of centrifuge unit 7, Extraction Hall): W3-D6-LY4 / centrifuge unit 7 / fault code V-14 / 14 Hz over rated / ZP
- [relic, author 1, event 3] *Sticker log, Week 4 LY4* (maintenance sticker roll, last six pages): W4-D1-LY4 / Block 3 outer seal / impact damage / ZP W4-D1-LY4 / Block 3 inner mesh / breach 0.3 m / ZP W4-D2-LY4 / Block 3 inner mesh / breach 1.1 m / ZP W4-D2-LY4 / queen-breeding rack B / frame cracked / ZP W4-D3-LY4 / Block 3 inspection port / do not open / ZP W4-D3-LY4 / colony count Block 3 / 0 of 2.1M / ZP
- [relic, author 1, event 4] *Requisition note, W4 D5 LY4* (requisition note wedged under Cold Store R door seal): Smoke canister R-11, replacement, Extraction Hall use. T-09. Cold Store R key, 1, staff egress. T-09. Boot covers, 22 pairs, Cold Store R floor. T-09. Boot covers, 1 pair, not needed after all. T-09.
- [relic, author 0, event 5] *Letter home, Week 6 LY4* (letter, unfinished, clipped to Cold Store R interior wall): Rael, the wax press plate is gone, which is actually a 14-kilogram fabricated steel tool that does not lose itself. Observation Mezzanine and Extraction Hall are theirs now, both of them, and queen-breeding rack B is somewhere inside the zone. Day 13 since we left through the cold store. I had 18 cells in Block 3 at the start of Week 1 and I have not written the number I have now.
- [remains swarmling, author 2, event 0] *Scout's belt kit* (canvas belt with four pouches, buckle stamped QCB): Belt, 1 unit. Glove, 1 pair. Badge, platform entry, 1. Staff number: T-14. T-09.
- [remains lurker, author 1, event 3] *Extraction Hall vent tag* (aluminium inspection tag, wire still attached): LY4-W4 / CENTRIFUGE UNIT 7 / VENT E-3 / 14 Hz base resonance / ZP
- [remains spewer, author 0, event 4] *Mezzanine headnet, M. Osei* (fine-mesh headnet, name tag sewn inside collar): Rael, someone left a headnet on the Observation Mezzanine rail, which I know is actually where Mina Osei stationed herself on Day 5 before the evacuation call went out, because her name is in the collar in her own hand, and the mesh is torn across seven centimetres on the right side.
- [remains warden, author 1, event 5] *Hive tool, Block 3* (steel hive tool, handle wrapped in orange tape): LY4-W1 / BLOCK 3 / HANDLE REBOUND / ZP. The tool was last logged inside Hive Block 3 on Week 1 of Lease Year 4, the same week Tamsin Gupta recorded 18 queen cells. By Week 6 the block was inside the hornet zone. The tape is intact; the steel is pitted.
- [remains guardian, author 2, event 5] *Signed manifest LY4-W3* (three-page manifest, top sheet signed in blue ink): Line 1 reads: '40,000,000 units, Apis dorsata, Quarantine Crate Bay, Week 3 LY4.' The signature below is S. Varga. The species field on page 2 reads 'Vespa mandarinia'; page 2 was unread. The manifest was recovered from the crate bay office where Varga was last confirmed present in Week 6.

Attunements:
- Gupta's Queen Tally (remains_charge): Tamsin Gupta counted 18 queen cells in Block 3 during Week 1 of Lease Year 4, a six-quarter record. She recounted twice and initialled the log both times.
- Smoke Canister R-11 (dash_echo): Nikos Tupou left smoke canister R-11 burning in Extraction Hall on Day 5 of Week 4. The canister held 90 seconds of charge when he set it down.
- Pike's Mesh Apron (bolt_ward): Zofia Pike wore a reinforced mesh apron rated for centrifuge fragment deflection. It logged four patch repairs across Lease Years 2 and 3.
- Varga's Manifest Clip (anchor_grace): Sanjay Varga used a spring-loaded clipboard to hold the quarter manifests flat for signing. The clip bore 11 indentations from successive quarters of use.
