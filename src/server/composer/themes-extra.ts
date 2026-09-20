/**
 * Second batch of authored content per theme (applied in themes.ts): one more relic and two
 * more room lines each, so two worlds of the same theme rarely repeat a description. Written
 * to the house style (docs/WRITING.md): a number or a physical object in every line, no
 * ominous closers, nobody tells the player what they feel.
 */
import type { LoreTemplate } from './themes';

export interface ThemeExtra {
  relic: LoreTemplate;
  entry: string;
  mid: string;
}

export const THEME_EXTRAS: Record<string, ThemeExtra> = {
  pirates: {
    relic: { title: 'Grog ration card', source: 'nailed to the galley hatch', text: 'Rations for 31 hands, cut to 19, cut to 6. The last line adds two rations back and a note in the quartermaster\'s hand: they came back up the ladder. Feed them anyway.' },
    entry: 'Two grapple lines still hold the {word} to the dock; a third lies cut on the deck plates.',
    mid: 'Nine sealed crates stand in a row under one swinging lantern; the tenth is open and empty.',
  },
  drowned: {
    relic: { title: 'Diver\'s slate', source: 'clipped to a rusted air line at the nave door', text: 'Depth 14 metres. Bells audible through the water at 3 minutes. At 9 minutes the {word} moved along the north arcade toward the choir. Air for 4 minutes more. Going down the nave anyway.' },
    entry: 'Water stands knee-deep between 12 arches; the nearest bell rope hangs into it and moves against the current.',
    mid: 'Three bells hang above the flooded gallery, and the smallest one rings every 40 seconds with no rope attached.',
  },
  jungle: {
    relic: { title: 'Seed register', source: 'tied to a root with copper wire', text: 'Bed 4: {word}, planted the 2nd, sprouted the 3rd, flowering by the 5th. Bed 5: same seed, planted the 2nd, no sprout. The register keeper wrote Bed 5 in a shaking hand and did not fill Bed 6.' },
    entry: 'Roots as thick as a man\'s waist have lifted 40 floor slabs; a lantern still burns at the far arch.',
    mid: 'Six lanterns hang from a single living root that crosses the hall at head height and drips sap on the floor.',
  },
  frozen: {
    relic: { title: 'Thermometer log', source: 'pencilled on the back of a station map', text: 'Day 1: minus 31. Day 4: minus 52. Day 6: minus 68 and the {word} stopped reporting. Day 7: minus 70, and the instrument on the east wall was still recording it after the crew were not.' },
    entry: 'Ice has sealed 3 of the 4 doors in this hall; the fourth stands open with a coat frozen to its handle.',
    mid: 'Eleven crystal columns hold the ceiling, and the frost on the floor keeps 11 sets of boot prints ending at the same column.',
  },
  desert: {
    relic: { title: 'Water tally', source: 'scored on the lip of a cistern', text: 'Skins: 40, then 22, then 9. Day 12 has one stroke and the word {word} beside it. The cistern below the tally is 3 metres deep and holds dry sand.' },
    entry: 'Sand has buried the entry court to the height of the second step; 5 monoliths stand clear of it.',
    mid: 'Gilded lanterns hang at 12 intervals along a passage of 30 carved slabs, and 2 of the slabs have been pushed out from behind.',
  },
  volcanic: {
    relic: { title: 'Tap schedule', source: 'chalked on the crucible housing', text: 'Tap the crucible at 6, at 12, at 18. The 18 has been rubbed out and 24 written over it, then 30. Slag on the housing has run over the numbers and set 4 centimetres thick.' },
    entry: 'Slag heaps flank the gate 2 metres high and the floor between them glows through 3 cracks.',
    mid: 'A gear-train of 7 wheels turns over the molten channel; the eighth wheel lies in the channel, half melted.',
  },
  neon: {
    relic: { title: 'Till receipt', source: 'curled in a dead register at stall 17', text: 'Stall 17. 3 items, 2 paid in cash, 1 marked owed: the {word}. Timestamp 02:14. The register printed 4,000 more receipts after that with no items on them.' },
    entry: 'Forty shuttered stalls line the street under signage that lights one shop name at a time, left to right.',
    mid: 'Nine terminals on the concourse show the same ticker of prices for goods no stall sells any more.',
  },
  haunted: {
    relic: { title: 'Funeral programme', source: 'folded into a pew in the ossuary cloister', text: 'Order of service for the {word}. 11 hymns, 11 readings, 11 names in the acknowledgements. The programme is dated for a Sunday 40 years after the stone above the pew says the church closed.' },
    entry: 'Grave-lanterns mark a path between 20 leaning monoliths; 3 of the graves are open and their earth is heaped on the path.',
    mid: 'Arches of stacked bone frame the cloister, and 11 lanterns burn on the north wall for 11 chalk names.',
  },
  void: {
    relic: { title: 'Dish alignment card', source: 'clipped to the great dish\'s drive housing', text: 'Azimuth 214, elevation 31: star 4473. Aligned by hand on the 9th because the drive motor refused the coordinates. The motor has since moved the dish 6 degrees toward 4473 on its own.' },
    entry: 'Twelve spires rise past the dome glass, and 11 of their beacon lamps are dark.',
    mid: 'Crystal antennae stand in 4 rows down the gallery, each tagged with a star number and a strike-through.',
  },
  archive: {
    relic: { title: 'Reshelving cart', source: 'a cart abandoned mid-aisle in the stacks', text: 'Cart 3, 40 volumes to reshelve, 39 done. The fortieth is titled {word} and has been reshelved 12 times according to the card; each time it is found back on the cart.' },
    entry: 'Long tables seat 24 under amber lanterns, and 24 books lie open on them at the same page number.',
    mid: 'Shelf-monoliths 6 metres tall line the stacks; a rail ladder rests against shelf 9 with the ninth rung worn through.',
  },
  swamp: {
    relic: { title: 'Sluice log', source: 'nailed to the sluice gate post', text: 'Gate opened 2 turns on the 1st. Wheel speed 12 revolutions a minute with no water on the 4th. Gate closed 2 turns on the 5th; wheel speed unchanged. Nobody has logged the 6th.' },
    entry: 'A walkway of 30 planks crosses the glowing mire; 6 of them are missing and the gaps glow brighter.',
    mid: 'Violet spore-lanterns light a mill wheel that turns 12 times a minute over a channel with no water in it.',
  },
  clockwork: {
    relic: { title: 'Maintenance tag', source: 'wired to a gear the size of a cart wheel', text: 'Gear 44, inspected the 3rd, 0 faults. Inspected the 10th, 0 faults. Inspected the 17th, 1 fault: the gear turns the wrong way for 2 seconds at every 40th rotation. Inspector did not sign.' },
    entry: 'Conveyor pits run under 3 idle grapples; the escapement above the gate ticks once a second and skips every fortieth.',
    mid: 'Gear-trains climb both walls to a height of 8 metres, and the assembly cradle at the centre holds 2 brass hands.',
  },
  crystal: {
    relic: { title: 'Lens cleaning roster', source: 'chalked on the observatory rail', text: 'Lens 1 cleaned the 2nd by Orrin. Lens 2 cleaned the 2nd by Sele. Lens 3 cleaned the 4th by Orrin, who wrote that the lens was clean already and warm on the inside.' },
    entry: 'Crystal shelves break the violet shallows into 20 mirrored panes, each showing the doorway from a different side.',
    mid: 'Six arched buttresses carry the cracked observatory floor, and a 40-inch lens lies in the gallery with its brass ring intact.',
  },
  storm: {
    relic: { title: 'Mooring ledger', source: 'chained to the mooring post', text: 'Berth 2: the {word}, 6 crew, moored the 3rd, 14 lightning strikes on the tether by the 4th. Departure column blank. The tether is still warm 40 centimetres from the post.' },
    entry: 'Four tether cables hum with charge across the deck, and 1 of them arcs to the rail every 12 seconds.',
    mid: 'A spire of 9 crystal lightning-rods stands at the gallery\'s centre; 8 are blackened and the ninth is clear.',
  },
  cathedral: {
    relic: { title: 'Bell-ringers\' rota', source: 'pinned inside the tower door', text: 'Sunday 6:00, 4 ringers. Sunday 6:00, 3 ringers. Sunday 6:00, 1 ringer, and the tenor bell rang at 6:00 the week after that with no name on the rota.' },
    entry: 'Candle racks hold 300 candles at the narthex door and every one is lit at the same height.',
    mid: 'Twelve monolith saints line the nave, and the incense from 4 censers hangs at chest height without drifting.',
  },
  festival: {
    relic: { title: 'Prize-booth tally', source: 'chalked on the prize board', text: 'Prizes: 40. Won: 39. The fortieth prize, the {word}, has been won 12 times according to the strokes and is still on the top shelf.' },
    entry: 'Paper lanterns on 6 strings sway over the promenade, and the ticket booth still shows 1 ticket in the tray.',
    mid: 'Forty masks hang from the pavilion cables, and 3 of them turn to follow anyone crossing the dance floor.',
  },
};
