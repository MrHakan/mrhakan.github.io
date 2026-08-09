// ===================================================================
// JOKERZ 98 — content data
//
// A Balatro-like poker roguelike. This file is pure content: poker
// hands, planets, tarots, spectrals, vouchers, boss blinds, decks,
// stakes, packs, tags and jokers. The engine lives in balatro.js.
//
// Effect API — every joker may implement any of:
//   scored(ctx, card)   -> {chips,mult,xmult,money,msg} | null   per scoring card
//   held(ctx, card)     -> same                                  per card held in hand
//   indep(ctx)          -> same                                  once, in joker order
//   retrigger(ctx,card) -> int      extra triggers for a scoring card
//   heldRetrigger(c,cd) -> int      extra triggers for a held card
//   onPlay(ctx)         -> void     before scoring, may mutate ctx
//   onDiscard(g, cards) -> void
//   onRoundEnd(g, j)    -> {money,msg}
//   onBlindStart(g, j)  -> void
//   onSold(g, j)        -> void
//   onShopExit(g, j)    -> void
//   desc(g, j)          -> string   dynamic rules text
// ===================================================================

const BAL = {};

// ---------- cards ----------
BAL.SUITS = [
    { id: 0, name: 'Spades', short: 'S', glyph: '♠', red: false },
    { id: 1, name: 'Hearts', short: 'H', glyph: '♥', red: true },
    { id: 2, name: 'Diamonds', short: 'D', glyph: '♦', red: true },
    { id: 3, name: 'Clubs', short: 'C', glyph: '♣', red: false }
];
// rank 2..14, where 11=J 12=Q 13=K 14=A
BAL.RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
BAL.RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

BAL.ENHANCEMENTS = {
    bonus: { name: 'Bonus Card', text: '+30 Chips' },
    mult: { name: 'Mult Card', text: '+4 Mult' },
    wild: { name: 'Wild Card', text: 'counts as every suit' },
    glass: { name: 'Glass Card', text: 'X2 Mult, 1 in 4 chance to shatter' },
    steel: { name: 'Steel Card', text: 'X1.5 Mult while held in hand' },
    stone: { name: 'Stone Card', text: '+50 Chips, no rank or suit' },
    gold: { name: 'Gold Card', text: '$3 if held at end of round' },
    lucky: { name: 'Lucky Card', text: '1 in 5 for +20 Mult, 1 in 15 for $20' }
};
BAL.EDITIONS = {
    foil: { name: 'Foil', text: '+50 Chips' },
    holo: { name: 'Holographic', text: '+10 Mult' },
    poly: { name: 'Polychrome', text: 'X1.5 Mult' },
    negative: { name: 'Negative', text: '+1 Joker slot' }
};
BAL.SEALS = {
    red: { name: 'Red Seal', text: 'retrigger this card once' },
    blue: { name: 'Blue Seal', text: 'creates a Planet card if held at end of round' },
    gold: { name: 'Gold Seal', text: 'earn $3 when scored' },
    purple: { name: 'Purple Seal', text: 'creates a Tarot card when discarded' }
};

// ---------- poker hands ----------
// chips/mult are the level 1 values, per-level gains follow
BAL.HANDS = {
    flush_five: { name: 'Flush Five', chips: 160, mult: 16, lc: 50, lm: 3 },
    flush_house: { name: 'Flush House', chips: 140, mult: 14, lc: 40, lm: 4 },
    five: { name: 'Five of a Kind', chips: 120, mult: 12, lc: 35, lm: 3 },
    straight_flush: { name: 'Straight Flush', chips: 100, mult: 8, lc: 40, lm: 4 },
    four: { name: 'Four of a Kind', chips: 60, mult: 7, lc: 30, lm: 3 },
    full_house: { name: 'Full House', chips: 40, mult: 4, lc: 25, lm: 2 },
    flush: { name: 'Flush', chips: 35, mult: 4, lc: 15, lm: 2 },
    straight: { name: 'Straight', chips: 30, mult: 4, lc: 30, lm: 3 },
    three: { name: 'Three of a Kind', chips: 30, mult: 3, lc: 20, lm: 2 },
    two_pair: { name: 'Two Pair', chips: 20, mult: 2, lc: 20, lm: 1 },
    pair: { name: 'Pair', chips: 10, mult: 2, lc: 15, lm: 1 },
    high_card: { name: 'High Card', chips: 5, mult: 1, lc: 10, lm: 1 }
};
// best-first, the evaluator walks this order
BAL.HAND_ORDER = ['flush_five', 'flush_house', 'five', 'straight_flush', 'four', 'full_house',
    'flush', 'straight', 'three', 'two_pair', 'pair', 'high_card'];

// ---------- planets ----------
BAL.PLANETS = [
    { id: 'pluto', name: 'Pluto', hand: 'high_card', cost: 3 },
    { id: 'mercury', name: 'Mercury', hand: 'pair', cost: 3 },
    { id: 'uranus', name: 'Uranus', hand: 'two_pair', cost: 3 },
    { id: 'venus', name: 'Venus', hand: 'three', cost: 3 },
    { id: 'saturn', name: 'Saturn', hand: 'straight', cost: 3 },
    { id: 'jupiter', name: 'Jupiter', hand: 'flush', cost: 3 },
    { id: 'earth', name: 'Earth', hand: 'full_house', cost: 3 },
    { id: 'mars', name: 'Mars', hand: 'four', cost: 3 },
    { id: 'neptune', name: 'Neptune', hand: 'straight_flush', cost: 3 },
    { id: 'planet_x', name: 'Planet X', hand: 'five', cost: 3, secret: true },
    { id: 'ceres', name: 'Ceres', hand: 'flush_house', cost: 3, secret: true },
    { id: 'eris', name: 'Eris', hand: 'flush_five', cost: 3, secret: true }
];

// ---------- tarots ----------
// need: how many cards must be selected in hand (0 = none)
BAL.TAROTS = [
    { id: 'fool', name: 'The Fool', need: 0, text: 'Creates the last Tarot or Planet card used this run' },
    { id: 'magician', name: 'The Magician', need: [1, 2], text: 'Enhances up to 2 selected cards into Lucky Cards' },
    { id: 'priestess', name: 'The High Priestess', need: 0, text: 'Creates up to 2 random Planet cards' },
    { id: 'empress', name: 'The Empress', need: [1, 2], text: 'Enhances up to 2 selected cards into Mult Cards' },
    { id: 'emperor', name: 'The Emperor', need: 0, text: 'Creates up to 2 random Tarot cards' },
    { id: 'hierophant', name: 'The Hierophant', need: [1, 2], text: 'Enhances up to 2 selected cards into Bonus Cards' },
    { id: 'lovers', name: 'The Lovers', need: [1, 1], text: 'Enhances 1 selected card into a Wild Card' },
    { id: 'chariot', name: 'The Chariot', need: [1, 1], text: 'Enhances 1 selected card into a Steel Card' },
    { id: 'justice', name: 'Justice', need: [1, 1], text: 'Enhances 1 selected card into a Glass Card' },
    { id: 'hermit', name: 'The Hermit', need: 0, text: 'Doubles money (max of $20)' },
    { id: 'wheel', name: 'Wheel of Fortune', need: 0, text: '1 in 4 chance to add a random Edition to a random Joker' },
    { id: 'strength', name: 'Strength', need: [1, 2], text: 'Increases rank of up to 2 selected cards by 1' },
    { id: 'hanged', name: 'The Hanged Man', need: [1, 2], text: 'Destroys up to 2 selected cards' },
    { id: 'death', name: 'Death', need: [2, 2], text: 'Select 2 cards, the left becomes a copy of the right' },
    { id: 'temperance', name: 'Temperance', need: 0, text: 'Gives the total sell value of all current Jokers (max $50)' },
    { id: 'devil', name: 'The Devil', need: [1, 1], text: 'Enhances 1 selected card into a Gold Card' },
    { id: 'tower', name: 'The Tower', need: [1, 1], text: 'Enhances 1 selected card into a Stone Card' },
    { id: 'star', name: 'The Star', need: [1, 3], text: 'Converts up to 3 selected cards to Diamonds' },
    { id: 'moon', name: 'The Moon', need: [1, 3], text: 'Converts up to 3 selected cards to Clubs' },
    { id: 'sun', name: 'The Sun', need: [1, 3], text: 'Converts up to 3 selected cards to Hearts' },
    { id: 'judgement', name: 'Judgement', need: 0, text: 'Creates a random Joker card' },
    { id: 'world', name: 'The World', need: [1, 3], text: 'Converts up to 3 selected cards to Spades' }
];

// ---------- spectrals ----------
BAL.SPECTRALS = [
    { id: 'familiar', name: 'Familiar', need: 0, text: 'Destroy 1 random card in hand, add 3 random Enhanced face cards' },
    { id: 'grim', name: 'Grim', need: 0, text: 'Destroy 1 random card in hand, add 2 random Enhanced Aces' },
    { id: 'incantation', name: 'Incantation', need: 0, text: 'Destroy 1 random card in hand, add 4 random Enhanced numbered cards' },
    { id: 'talisman', name: 'Talisman', need: [1, 1], text: 'Add a Gold Seal to 1 selected card' },
    { id: 'aura', name: 'Aura', need: [1, 1], text: 'Add Foil, Holographic or Polychrome to 1 selected card in hand' },
    { id: 'wraith', name: 'Wraith', need: 0, text: 'Creates a random Rare Joker, sets money to $0' },
    { id: 'sigil', name: 'Sigil', need: 0, text: 'Converts all cards in hand to a single random suit' },
    { id: 'ouija', name: 'Ouija', need: 0, text: 'Converts all cards in hand to a single random rank, -1 hand size' },
    { id: 'ectoplasm', name: 'Ectoplasm', need: 0, text: 'Add Negative to a random Joker, -1 hand size' },
    { id: 'immolate', name: 'Immolate', need: 0, text: 'Destroys 5 random cards in hand, gain $20' },
    { id: 'ankh', name: 'Ankh', need: 0, text: 'Create a copy of a random Joker, destroy all other Jokers' },
    { id: 'dejavu', name: 'Deja Vu', need: [1, 1], text: 'Add a Red Seal to 1 selected card' },
    { id: 'hex', name: 'Hex', need: 0, text: 'Add Polychrome to a random Joker, destroy all other Jokers' },
    { id: 'trance', name: 'Trance', need: [1, 1], text: 'Add a Blue Seal to 1 selected card' },
    { id: 'medium', name: 'Medium', need: [1, 1], text: 'Add a Purple Seal to 1 selected card' },
    { id: 'cryptid', name: 'Cryptid', need: [1, 1], text: 'Create 2 copies of 1 selected card' },
    { id: 'soul', name: 'The Soul', need: 0, text: 'Creates a Legendary Joker', secret: true },
    { id: 'black_hole', name: 'Black Hole', need: 0, text: 'Upgrade every poker hand by 1 level', secret: true },
    // --- extras, not in the original ---
    { id: 'defrag', name: 'Defragment', need: 0, text: 'Sorts your deck and permanently gives every card +2 Chips', extra: true },
    { id: 'overclock', name: 'Overclock', need: 0, text: 'X1.5 Mult on a random Joker forever, but -1 hand', extra: true },
    { id: 'recycle_bin', name: 'Recycle Bin', need: 0, text: 'Destroy all cards in hand, gain $4 for each', extra: true }
];

// ---------- vouchers ----------
// each base voucher unlocks its upgrade once bought
BAL.VOUCHERS = [
    { id: 'overstock', name: 'Overstock', cost: 10, text: '+1 card slot available in shop' },
    { id: 'overstock_plus', name: 'Overstock Plus', cost: 10, req: 'overstock', text: '+1 card slot available in shop' },
    { id: 'clearance', name: 'Clearance Sale', cost: 10, text: 'All cards and packs in shop are 25% off' },
    { id: 'liquidation', name: 'Liquidation', cost: 10, req: 'clearance', text: 'All cards and packs in shop are 50% off' },
    { id: 'hone', name: 'Hone', cost: 10, text: 'Foil, Holographic and Polychrome cards appear 2X more often' },
    { id: 'glow_up', name: 'Glow Up', cost: 10, req: 'hone', text: 'Foil, Holographic and Polychrome cards appear 4X more often' },
    { id: 'reroll_surplus', name: 'Reroll Surplus', cost: 10, text: 'Rerolls cost $2 less' },
    { id: 'reroll_glut', name: 'Reroll Glut', cost: 10, req: 'reroll_surplus', text: 'Rerolls cost an additional $2 less' },
    { id: 'crystal_ball', name: 'Crystal Ball', cost: 10, text: '+1 consumable slot' },
    { id: 'omen_globe', name: 'Omen Globe', cost: 10, req: 'crystal_ball', text: 'Spectral cards may appear in any of the Arcana Packs' },
    { id: 'telescope', name: 'Telescope', cost: 10, text: 'Celestial Packs always contain the Planet card for your most played hand' },
    { id: 'observatory', name: 'Observatory', cost: 10, req: 'telescope', text: 'Planet cards in your consumable area give X1.5 Mult for their hand' },
    { id: 'grabber', name: 'Grabber', cost: 10, text: 'Permanently gain +1 hand per round' },
    { id: 'nacho_tong', name: 'Nacho Tong', cost: 10, req: 'grabber', text: 'Permanently gain +1 hand per round' },
    { id: 'wasteful', name: 'Wasteful', cost: 10, text: 'Permanently gain +1 discard per round' },
    { id: 'recyclomancy', name: 'Recyclomancy', cost: 10, req: 'wasteful', text: 'Permanently gain +1 discard per round' },
    { id: 'tarot_merchant', name: 'Tarot Merchant', cost: 10, text: 'Tarot cards appear 2X more frequently in the shop' },
    { id: 'tarot_tycoon', name: 'Tarot Tycoon', cost: 10, req: 'tarot_merchant', text: 'Tarot cards appear 4X more frequently in the shop' },
    { id: 'planet_merchant', name: 'Planet Merchant', cost: 10, text: 'Planet cards appear 2X more frequently in the shop' },
    { id: 'planet_tycoon', name: 'Planet Tycoon', cost: 10, req: 'planet_merchant', text: 'Planet cards appear 4X more frequently in the shop' },
    { id: 'seed_money', name: 'Seed Money', cost: 10, text: 'Raise the cap on interest earned per round to $10' },
    { id: 'money_tree', name: 'Money Tree', cost: 10, req: 'seed_money', text: 'Raise the cap on interest earned per round to $20' },
    { id: 'blank', name: 'Blank', cost: 10, text: 'Does nothing?' },
    { id: 'antimatter', name: 'Antimatter', cost: 10, req: 'blank', text: '+1 Joker slot' },
    { id: 'magic_trick', name: 'Magic Trick', cost: 10, text: 'Playing cards can be purchased from the shop' },
    { id: 'illusion', name: 'Illusion', cost: 10, req: 'magic_trick', text: 'Playing cards in shop may have an Enhancement, Edition or Seal' },
    { id: 'hieroglyph', name: 'Hieroglyph', cost: 10, text: '-1 Ante, -1 hand per round' },
    { id: 'petroglyph', name: 'Petroglyph', cost: 10, req: 'hieroglyph', text: '-1 Ante, -1 discard per round' },
    { id: 'directors_cut', name: "Director's Cut", cost: 10, text: 'Reroll Boss Blind once per Ante, $10 per roll' },
    { id: 'retcon', name: 'Retcon', cost: 10, req: 'directors_cut', text: 'Reroll Boss Blind unlimited times, $10 per roll' },
    { id: 'paint_brush', name: 'Paint Brush', cost: 10, text: '+1 hand size' },
    { id: 'palette', name: 'Palette', cost: 10, req: 'paint_brush', text: '+1 hand size' },
    // --- extras ---
    { id: 'dialup', name: 'Dial-Up Modem', cost: 10, text: 'Shop always stocks 1 extra Booster Pack', extra: true },
    { id: 'broadband', name: 'Broadband', cost: 10, req: 'dialup', text: 'Booster Packs contain 1 extra card', extra: true },
    { id: 'shareware', name: 'Shareware', cost: 10, text: 'The first Joker you buy each shop is free', extra: true }
];

// ---------- boss blinds ----------
// mult = blind size multiplier relative to the ante base (normal boss = 2)
BAL.BOSSES = [
    { id: 'hook', name: 'The Hook', mult: 2, text: 'Discards 2 random cards per hand played' },
    { id: 'ox', name: 'The Ox', mult: 2, text: 'Playing your most played hand sets money to $0' },
    { id: 'house', name: 'The House', mult: 2, text: 'First hand is drawn face down' },
    { id: 'wall', name: 'The Wall', mult: 4, text: 'Extra large blind' },
    { id: 'wheel', name: 'The Wheel', mult: 2, text: '1 in 7 cards get drawn face down' },
    { id: 'arm', name: 'The Arm', mult: 2, text: 'Decrease level of played poker hand' },
    { id: 'club', name: 'The Club', mult: 2, text: 'All Club cards are debuffed', debuffSuit: 3 },
    { id: 'fish', name: 'The Fish', mult: 2, text: 'Cards drawn face down after each hand played' },
    { id: 'psychic', name: 'The Psychic', mult: 2, text: 'Must play 5 cards' },
    { id: 'goad', name: 'The Goad', mult: 2, text: 'All Spade cards are debuffed', debuffSuit: 0 },
    { id: 'water', name: 'The Water', mult: 2, text: 'Start with 0 discards' },
    { id: 'window', name: 'The Window', mult: 2, text: 'All Diamond cards are debuffed', debuffSuit: 2 },
    { id: 'manacle', name: 'The Manacle', mult: 2, text: '-1 hand size' },
    { id: 'eye', name: 'The Eye', mult: 2, text: 'No repeat hand types this round' },
    { id: 'mouth', name: 'The Mouth', mult: 2, text: 'Play only 1 hand type this round' },
    { id: 'plant', name: 'The Plant', mult: 2, text: 'All face cards are debuffed', debuffFace: true },
    { id: 'serpent', name: 'The Serpent', mult: 2, text: 'After Play or Discard, always draw 3 cards' },
    { id: 'pillar', name: 'The Pillar', mult: 2, text: 'Cards played previously this Ante are debuffed' },
    { id: 'needle', name: 'The Needle', mult: 1, text: 'Play only 1 hand' },
    { id: 'head', name: 'The Head', mult: 2, text: 'All Heart cards are debuffed', debuffSuit: 1 },
    { id: 'tooth', name: 'The Tooth', mult: 2, text: 'Lose $1 per card played' },
    { id: 'flint', name: 'The Flint', mult: 2, text: 'Base Chips and Mult are halved' },
    { id: 'mark', name: 'The Mark', mult: 2, text: 'All face cards are drawn face down' },
    // finishers, only on ante 8, 16, 24...
    { id: 'acorn', name: 'Amber Acorn', mult: 2, finisher: true, text: 'Flips and shuffles all Joker cards' },
    { id: 'leaf', name: 'Verdant Leaf', mult: 2, finisher: true, text: 'All cards debuffed until 1 Joker is sold' },
    { id: 'vessel', name: 'Violet Vessel', mult: 6, finisher: true, text: 'Very large blind' },
    { id: 'heart', name: 'Crimson Heart', mult: 2, finisher: true, text: 'One random Joker disabled each hand' },
    { id: 'bell', name: 'Cerulean Bell', mult: 2, finisher: true, text: 'Forces 1 card to always be selected' },
    // --- extras ---
    { id: 'bsod', name: 'Blue Screen', mult: 2, extra: true, text: 'A fatal exception: your leftmost Joker is disabled' },
    { id: 'lowmem', name: 'Out Of Memory', mult: 2, extra: true, text: '-2 hand size, +1 hand' },
    { id: 'lag', name: 'The Lag Spike', mult: 3, extra: true, text: 'Extra large blind, but you start with +1 discard' }
];

// ---------- decks ----------
BAL.DECKS = [
    { id: 'red', name: 'Red Deck', text: '+1 discard every round' },
    { id: 'blue', name: 'Blue Deck', text: '+1 hand every round' },
    { id: 'yellow', name: 'Yellow Deck', text: 'Start with extra $10' },
    { id: 'green', name: 'Green Deck', text: 'At end of round: $2 per remaining Hand, $1 per remaining Discard. Earn no interest' },
    { id: 'black', name: 'Black Deck', text: '+1 Joker slot, -1 hand every round' },
    { id: 'magic', name: 'Magic Deck', text: 'Start with the Crystal Ball voucher and 2 copies of The Fool' },
    { id: 'nebula', name: 'Nebula Deck', text: 'Start with the Telescope voucher, -1 consumable slot' },
    { id: 'ghost', name: 'Ghost Deck', text: 'Spectral cards may appear in the shop, start with a Hex card' },
    { id: 'abandoned', name: 'Abandoned Deck', text: 'Start with a deck with no face cards' },
    { id: 'checkered', name: 'Checkered Deck', text: 'Start with 26 Spades and 26 Hearts in deck' },
    { id: 'zodiac', name: 'Zodiac Deck', text: 'Start with Tarot Merchant, Planet Merchant and Overstock' },
    { id: 'painted', name: 'Painted Deck', text: '+2 hand size, -1 Joker slot' },
    { id: 'anaglyph', name: 'Anaglyph Deck', text: 'After defeating each Boss Blind, gain a Double Tag' },
    { id: 'plasma', name: 'Plasma Deck', text: 'Balance Chips and Mult when calculating score, X2 base Blind size' },
    { id: 'erratic', name: 'Erratic Deck', text: 'All Ranks and Suits in deck are randomized' },
    // --- extras ---
    { id: 'floppy', name: 'Floppy Deck', extra: true, text: 'Only 44 cards, but every hand starts one level higher' },
    { id: 'dither', name: 'Dither Deck', extra: true, text: 'Start with 8 random Enhanced cards and $4 less' }
];

// ---------- stakes ----------
BAL.STAKES = [
    { id: 1, name: 'White Stake', color: '#e8e8e8', text: 'The base difficulty' },
    { id: 2, name: 'Red Stake', color: '#c33', text: 'Small Blind gives no reward money' },
    { id: 3, name: 'Green Stake', color: '#3a3', text: 'Required score scales faster for each Ante' },
    { id: 4, name: 'Black Stake', color: '#444', text: 'Shop can have Eternal Jokers, which cannot be sold or destroyed' },
    { id: 5, name: 'Blue Stake', color: '#39c', text: '-1 Discard every round' },
    { id: 6, name: 'Purple Stake', color: '#93c', text: 'Required score scales faster for each Ante' },
    { id: 7, name: 'Orange Stake', color: '#e83', text: 'Shop can have Perishable Jokers, which are debuffed after 5 rounds' },
    { id: 8, name: 'Gold Stake', color: '#dc3', text: 'Shop can have Rental Jokers, which cost $3 per round' }
];

// ---------- booster packs ----------
BAL.PACKS = [
    { id: 'arcana', name: 'Arcana Pack', kind: 'tarot', size: 3, pick: 1, cost: 4, weight: 4 },
    { id: 'arcana_j', name: 'Jumbo Arcana Pack', kind: 'tarot', size: 5, pick: 1, cost: 6, weight: 2 },
    { id: 'arcana_m', name: 'Mega Arcana Pack', kind: 'tarot', size: 5, pick: 2, cost: 8, weight: 0.5 },
    { id: 'celestial', name: 'Celestial Pack', kind: 'planet', size: 3, pick: 1, cost: 4, weight: 4 },
    { id: 'celestial_j', name: 'Jumbo Celestial Pack', kind: 'planet', size: 5, pick: 1, cost: 6, weight: 2 },
    { id: 'celestial_m', name: 'Mega Celestial Pack', kind: 'planet', size: 5, pick: 2, cost: 8, weight: 0.5 },
    { id: 'standard', name: 'Standard Pack', kind: 'card', size: 3, pick: 1, cost: 4, weight: 4 },
    { id: 'standard_j', name: 'Jumbo Standard Pack', kind: 'card', size: 5, pick: 1, cost: 6, weight: 2 },
    { id: 'standard_m', name: 'Mega Standard Pack', kind: 'card', size: 5, pick: 2, cost: 8, weight: 0.5 },
    { id: 'buffoon', name: 'Buffoon Pack', kind: 'joker', size: 2, pick: 1, cost: 4, weight: 1.2 },
    { id: 'buffoon_j', name: 'Jumbo Buffoon Pack', kind: 'joker', size: 4, pick: 1, cost: 6, weight: 0.6 },
    { id: 'buffoon_m', name: 'Mega Buffoon Pack', kind: 'joker', size: 4, pick: 2, cost: 8, weight: 0.3 },
    { id: 'spectral', name: 'Spectral Pack', kind: 'spectral', size: 2, pick: 1, cost: 4, weight: 0.6 },
    { id: 'spectral_j', name: 'Jumbo Spectral Pack', kind: 'spectral', size: 4, pick: 1, cost: 6, weight: 0.3 },
    { id: 'spectral_m', name: 'Mega Spectral Pack', kind: 'spectral', size: 4, pick: 2, cost: 8, weight: 0.15 }
];

// ---------- skip tags ----------
BAL.TAGS = [
    { id: 'uncommon', name: 'Uncommon Tag', text: 'Shop has a free Uncommon Joker' },
    { id: 'rare', name: 'Rare Tag', text: 'Shop has a free Rare Joker' },
    { id: 'foil', name: 'Foil Tag', text: 'Next base edition shop Joker is Foil' },
    { id: 'holo', name: 'Holographic Tag', text: 'Next base edition shop Joker is Holographic' },
    { id: 'poly', name: 'Polychrome Tag', text: 'Next base edition shop Joker is Polychrome' },
    { id: 'investment', name: 'Investment Tag', text: 'After defeating the Boss Blind, gain $25' },
    { id: 'voucher', name: 'Voucher Tag', text: 'Adds one Voucher to the next shop' },
    { id: 'boss', name: 'Boss Tag', text: 'Rerolls the Boss Blind' },
    { id: 'standard', name: 'Standard Tag', text: 'Gives a free Mega Standard Pack' },
    { id: 'charm', name: 'Charm Tag', text: 'Gives a free Mega Arcana Pack' },
    { id: 'meteor', name: 'Meteor Tag', text: 'Gives a free Mega Celestial Pack' },
    { id: 'buffoon', name: 'Buffoon Tag', text: 'Gives a free Mega Buffoon Pack' },
    { id: 'ethereal', name: 'Ethereal Tag', text: 'Gives a free Spectral Pack' },
    { id: 'handy', name: 'Handy Tag', text: 'Gives $1 per played hand this run' },
    { id: 'garbage', name: 'Garbage Tag', text: 'Gives $1 per unused discard this run' },
    { id: 'coupon', name: 'Coupon Tag', text: 'Initial cards and booster packs in next shop are free' },
    { id: 'double', name: 'Double Tag', text: 'Gives a copy of the next selected Tag' },
    { id: 'juggle', name: 'Juggle Tag', text: '+3 hand size next round' },
    { id: 'd6', name: 'D6 Tag', text: 'Rerolls in next shop start at $0' },
    { id: 'economy', name: 'Economy Tag', text: 'Doubles your money (max of $40)' }
];

// ---------- blind score table ----------
// the ante-1..8 requirements, then a growth curve past that
BAL.ANTE_BASE = [100, 300, 800, 2000, 5000, 11000, 20000, 35000, 50000];
BAL.anteBase = function (ante, stake) {
    let base;
    if (ante <= 8) base = BAL.ANTE_BASE[ante];
    else {
        // beyond ante 8 the requirement grows super-exponentially, as in the original
        base = 50000;
        for (let a = 9; a <= ante; a++) base = Math.round(base * (1.6 + a * 0.08));
    }
    // green/purple stakes scale the curve up
    if (stake >= 6) base = Math.round(base * (1 + 0.08 * ante));
    else if (stake >= 3) base = Math.round(base * (1 + 0.04 * ante));
    return base;
};

// ===================================================================
// jokers
// rarity: 1 common, 2 uncommon, 3 rare, 4 legendary
// ===================================================================
BAL.JOKERS = [
    // ---------- common ----------
    { id: 'joker', name: 'Joker', rarity: 1, cost: 2, text: '+4 Mult', indep: () => ({ mult: 4 }) },
    { id: 'greedy', name: 'Greedy Joker', rarity: 1, cost: 5, text: 'Played cards with Diamond suit give +3 Mult when scored', scored: (c, cd) => balSuit(cd, 2, c.g) ? { mult: 3 } : null },
    { id: 'lusty', name: 'Lusty Joker', rarity: 1, cost: 5, text: 'Played cards with Heart suit give +3 Mult when scored', scored: (c, cd) => balSuit(cd, 1, c.g) ? { mult: 3 } : null },
    { id: 'wrathful', name: 'Wrathful Joker', rarity: 1, cost: 5, text: 'Played cards with Spade suit give +3 Mult when scored', scored: (c, cd) => balSuit(cd, 0, c.g) ? { mult: 3 } : null },
    { id: 'gluttonous', name: 'Gluttonous Joker', rarity: 1, cost: 5, text: 'Played cards with Club suit give +3 Mult when scored', scored: (c, cd) => balSuit(cd, 3, c.g) ? { mult: 3 } : null },
    { id: 'jolly', name: 'Jolly Joker', rarity: 1, cost: 3, text: '+8 Mult if played hand contains a Pair', indep: c => c.parts.pair ? { mult: 8 } : null },
    { id: 'zany', name: 'Zany Joker', rarity: 1, cost: 4, text: '+12 Mult if played hand contains a Three of a Kind', indep: c => c.parts.three ? { mult: 12 } : null },
    { id: 'mad', name: 'Mad Joker', rarity: 1, cost: 4, text: '+10 Mult if played hand contains a Two Pair', indep: c => c.parts.two_pair ? { mult: 10 } : null },
    { id: 'crazy', name: 'Crazy Joker', rarity: 1, cost: 4, text: '+12 Mult if played hand contains a Straight', indep: c => c.parts.straight ? { mult: 12 } : null },
    { id: 'droll', name: 'Droll Joker', rarity: 1, cost: 4, text: '+10 Mult if played hand contains a Flush', indep: c => c.parts.flush ? { mult: 10 } : null },
    { id: 'sly', name: 'Sly Joker', rarity: 1, cost: 3, text: '+50 Chips if played hand contains a Pair', indep: c => c.parts.pair ? { chips: 50 } : null },
    { id: 'wily', name: 'Wily Joker', rarity: 1, cost: 4, text: '+100 Chips if played hand contains a Three of a Kind', indep: c => c.parts.three ? { chips: 100 } : null },
    { id: 'clever', name: 'Clever Joker', rarity: 1, cost: 4, text: '+80 Chips if played hand contains a Two Pair', indep: c => c.parts.two_pair ? { chips: 80 } : null },
    { id: 'devious', name: 'Devious Joker', rarity: 1, cost: 4, text: '+100 Chips if played hand contains a Straight', indep: c => c.parts.straight ? { chips: 100 } : null },
    { id: 'crafty', name: 'Crafty Joker', rarity: 1, cost: 4, text: '+80 Chips if played hand contains a Flush', indep: c => c.parts.flush ? { chips: 80 } : null },
    { id: 'half', name: 'Half Joker', rarity: 1, cost: 5, text: '+20 Mult if played hand contains 3 or fewer cards', indep: c => c.played.length <= 3 ? { mult: 20 } : null },
    { id: 'credit_card', name: 'Credit Card', rarity: 1, cost: 1, text: 'Go up to -$20 in debt', passive: true },
    { id: 'banner', name: 'Banner', rarity: 1, cost: 5, text: '+30 Chips for each remaining discard', indep: c => ({ chips: 30 * c.g.discards }) },
    { id: 'mystic_summit', name: 'Mystic Summit', rarity: 1, cost: 5, text: '+15 Mult when 0 discards remaining', indep: c => c.g.discards === 0 ? { mult: 15 } : null },
    { id: 'eight_ball', name: '8 Ball', rarity: 1, cost: 5, text: '1 in 4 chance for each played 8 to create a Tarot card', scored: (c, cd) => (cd.rank === 8 && balChance(c.g, 1, 4)) ? { create: 'tarot', msg: 'Tarot!' } : null },
    { id: 'misprint', name: 'Misprint', rarity: 1, cost: 4, text: '+0 to +23 Mult', indep: () => ({ mult: balRandInt(24) }) },
    { id: 'raised_fist', name: 'Raised Fist', rarity: 1, cost: 5, text: 'Adds double the rank of the lowest card held in hand to Mult', indep: c => { const h = c.held.filter(x => x.enhancement !== 'stone'); if (!h.length) return null; const lo = h.reduce((a, b) => balChipsOf(b) < balChipsOf(a) ? b : a); return { mult: balChipsOf(lo) * 2 }; } },
    { id: 'chaos', name: 'Chaos the Clown', rarity: 1, cost: 4, text: '1 free Reroll per shop', passive: true },
    { id: 'scary_face', name: 'Scary Face', rarity: 1, cost: 4, text: 'Played face cards give +30 Chips when scored', scored: (c, cd) => balIsFace(cd, c.g) ? { chips: 30 } : null },
    { id: 'abstract', name: 'Abstract Joker', rarity: 1, cost: 4, text: '+3 Mult for each Joker card', indep: c => ({ mult: 3 * c.g.jokers.length }), desc: g => `+${3 * g.jokers.length} Mult` },
    { id: 'delayed_grat', name: 'Delayed Gratification', rarity: 1, cost: 4, text: 'Earn $2 per discard if no discards are used by end of round', onRoundEnd: g => g.discards === g.discardsMax ? { money: 2 * g.discardsMax } : null },
    { id: 'gros_michel', name: 'Gros Michel', rarity: 1, cost: 5, text: '+15 Mult, 1 in 6 chance this is destroyed at end of round', indep: () => ({ mult: 15 }), onRoundEnd: (g, j) => balChance(g, 1, 6) ? { destroy: true, msg: 'Extinct!' } : null },
    { id: 'even_steven', name: 'Even Steven', rarity: 1, cost: 4, text: 'Played cards with even rank give +4 Mult when scored', scored: (c, cd) => (cd.rank <= 10 && cd.rank % 2 === 0) ? { mult: 4 } : null },
    { id: 'odd_todd', name: 'Odd Todd', rarity: 1, cost: 4, text: 'Played cards with odd rank give +31 Chips when scored', scored: (c, cd) => ((cd.rank <= 10 && cd.rank % 2 === 1) || cd.rank === 14) ? { chips: 31 } : null },
    { id: 'scholar', name: 'Scholar', rarity: 1, cost: 4, text: 'Played Aces give +20 Chips and +4 Mult when scored', scored: (c, cd) => cd.rank === 14 ? { chips: 20, mult: 4 } : null },
    { id: 'business', name: 'Business Card', rarity: 1, cost: 4, text: 'Played face cards have a 1 in 2 chance to give $2 when scored', scored: (c, cd) => (balIsFace(cd, c.g) && balChance(c.g, 1, 2)) ? { money: 2 } : null },
    { id: 'supernova', name: 'Supernova', rarity: 1, cost: 5, text: 'Adds the number of times poker hand has been played to Mult', indep: c => ({ mult: c.g.handPlays[c.handKey] || 0 }) },
    { id: 'ride_bus', name: 'Ride the Bus', rarity: 1, cost: 6, text: 'This Joker gains +1 Mult per consecutive hand played without a scoring face card', counter: 0,
      onPlay: c => { const face = c.scoring.some(cd => balIsFace(cd, c.g)); if (face) c.self.counter = 0; else c.self.counter++; },
      indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'egg', name: 'Egg', rarity: 1, cost: 4, text: 'Gains $3 of sell value at end of round', onRoundEnd: (g, j) => { j.extraValue = (j.extraValue || 0) + 3; return null; }, desc: (g, j) => `Sell value +$${j.extraValue || 0}` },
    { id: 'runner', name: 'Runner', rarity: 1, cost: 5, text: 'Gains +15 Chips if played hand contains a Straight', counter: 0,
      onPlay: c => { if (c.parts.straight) c.self.counter += 15; }, indep: c => ({ chips: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Chips` },
    { id: 'ice_cream', name: 'Ice Cream', rarity: 1, cost: 5, text: '+100 Chips, -5 Chips for every hand played', counter: 100,
      indep: c => ({ chips: c.self.counter }), onPlay: c => { c.after = () => { c.self.counter -= 5; if (c.self.counter <= 0) c.self.destroy = true; }; }, desc: (g, j) => `Currently +${j.counter} Chips` },
    { id: 'splash', name: 'Splash', rarity: 1, cost: 3, text: 'Every played card counts in scoring', passive: true },
    { id: 'blue_joker', name: 'Blue Joker', rarity: 1, cost: 5, text: '+2 Chips for each remaining card in deck', indep: c => ({ chips: 2 * c.g.drawPile.length }), desc: g => `+${2 * g.drawPile.length} Chips` },
    { id: 'faceless', name: 'Faceless Joker', rarity: 1, cost: 4, text: 'Earn $5 if 3 or more face cards are discarded at the same time', onDiscard: (g, cards) => cards.filter(c => balIsFace(c, g)).length >= 3 ? { money: 5 } : null },
    { id: 'green_joker', name: 'Green Joker', rarity: 1, cost: 4, text: '+1 Mult per hand played, -1 Mult per discard', counter: 0,
      onPlay: c => { c.after = () => c.self.counter++; }, onDiscard: (g, cards, j) => { j.counter = Math.max(0, j.counter - 1); return null; },
      indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'superposition', name: 'Superposition', rarity: 1, cost: 4, text: 'Create a Tarot card if poker hand contains an Ace and a Straight',
      indep: c => (c.parts.straight && c.scoring.some(x => x.rank === 14)) ? { create: 'tarot', msg: 'Tarot!' } : null },
    { id: 'todo', name: 'To Do List', rarity: 1, cost: 4, text: 'Earn $4 if poker hand is the listed hand, changes at end of round',
      init: j => { j.target = balRandomHandKey(); }, onPlay: c => { if (c.handKey === c.self.target) c.money = (c.money || 0) + 4; },
      onRoundEnd: (g, j) => { j.target = balRandomHandKey(); return null; }, desc: (g, j) => `Hand: ${BAL.HANDS[j.target] ? BAL.HANDS[j.target].name : '?'}` },
    { id: 'cavendish', name: 'Cavendish', rarity: 1, cost: 4, text: 'X3 Mult, 1 in 1000 chance this card is destroyed at end of round',
      indep: () => ({ xmult: 3 }), onRoundEnd: g => balChance(g, 1, 1000) ? { destroy: true, msg: 'Extinct!' } : null },
    { id: 'red_card', name: 'Red Card', rarity: 1, cost: 5, text: 'This Joker gains +3 Mult when any Booster Pack is skipped', counter: 0,
      indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'square', name: 'Square Joker', rarity: 1, cost: 4, text: 'This Joker gains +4 Chips if played hand has exactly 4 cards', counter: 0,
      onPlay: c => { if (c.played.length === 4) c.self.counter += 4; }, indep: c => ({ chips: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Chips` },
    { id: 'riffraff', name: 'Riff-Raff', rarity: 1, cost: 6, text: 'When Blind is selected, create 2 Common Jokers', onBlindStart: g => { balCreateJoker(g, 1); balCreateJoker(g, 1); } },
    { id: 'photograph', name: 'Photograph', rarity: 1, cost: 5, text: 'First played face card gives X2 Mult when scored',
      scored: (c, cd) => { if (!balIsFace(cd, c.g)) return null; if (c._photo) return null; c._photo = true; return { xmult: 2 }; } },
    { id: 'reserved_parking', name: 'Reserved Parking', rarity: 1, cost: 6, text: 'Each face card held in hand has a 1 in 2 chance to give $1',
      held: (c, cd) => (balIsFace(cd, c.g) && balChance(c.g, 1, 2)) ? { money: 1 } : null },
    { id: 'mail_rebate', name: 'Mail-In Rebate', rarity: 1, cost: 4, text: 'Earn $5 for each discarded card of the listed rank',
      init: j => { j.target = balRandomRank(); }, onDiscard: (g, cards, j) => { const n = cards.filter(c => c.rank === j.target).length; return n ? { money: 5 * n } : null; },
      onRoundEnd: (g, j) => { j.target = balRandomRank(); return null; }, desc: (g, j) => `Rank: ${BAL.RANK_NAME[j.target]}` },
    { id: 'hallucination', name: 'Hallucination', rarity: 1, cost: 4, text: '1 in 2 chance to create a Tarot card when any Booster Pack is opened', passive: true },
    { id: 'fortune_teller', name: 'Fortune Teller', rarity: 1, cost: 6, text: '+1 Mult per Tarot card used this run', indep: c => ({ mult: c.g.stats.tarotsUsed }), desc: g => `+${g.stats.tarotsUsed} Mult` },
    { id: 'juggler', name: 'Juggler', rarity: 1, cost: 4, text: '+1 hand size', passive: true, handSize: 1 },
    { id: 'drunkard', name: 'Drunkard', rarity: 1, cost: 4, text: '+1 discard each round', passive: true, discards: 1 },
    { id: 'golden', name: 'Golden Joker', rarity: 1, cost: 6, text: 'Earn $4 at end of round', onRoundEnd: () => ({ money: 4 }) },
    { id: 'popcorn', name: 'Popcorn', rarity: 1, cost: 5, text: '+20 Mult, -4 Mult per round played', counter: 20,
      indep: c => ({ mult: Math.max(0, c.self.counter) }), onRoundEnd: (g, j) => { j.counter -= 4; return j.counter <= 0 ? { destroy: true, msg: 'Eaten!' } : null; }, desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'walkie', name: 'Walkie Talkie', rarity: 1, cost: 4, text: 'Each played 10 or 4 gives +10 Chips and +4 Mult when scored', scored: (c, cd) => (cd.rank === 10 || cd.rank === 4) ? { chips: 10, mult: 4 } : null },
    { id: 'smiley', name: 'Smiley Face', rarity: 1, cost: 4, text: 'Played face cards give +5 Mult when scored', scored: (c, cd) => balIsFace(cd, c.g) ? { mult: 5 } : null },
    { id: 'golden_ticket', name: 'Golden Ticket', rarity: 1, cost: 5, text: 'Played Gold cards earn $4 when scored', scored: (c, cd) => cd.enhancement === 'gold' ? { money: 4 } : null },
    { id: 'swashbuckler', name: 'Swashbuckler', rarity: 1, cost: 4, text: 'Adds the sell value of all other owned Jokers to Mult',
      indep: c => ({ mult: c.g.jokers.filter(j => j !== c.self).reduce((s, j) => s + balSellValue(j), 0) }) },
    { id: 'hanging_chad', name: 'Hanging Chad', rarity: 1, cost: 4, text: 'Retrigger the first played card used in scoring 2 additional times',
      retrigger: (c, cd) => cd === c.scoring[0] ? 2 : 0 },
    { id: 'shoot_moon', name: 'Shoot the Moon', rarity: 1, cost: 5, text: 'Each Queen held in hand gives +13 Mult', held: (c, cd) => cd.rank === 12 ? { mult: 13 } : null },

    // ---------- uncommon ----------
    { id: 'stencil', name: 'Joker Stencil', rarity: 2, cost: 8, text: 'X1 Mult for each empty Joker slot',
      indep: c => ({ xmult: Math.max(1, balJokerSlots(c.g) - c.g.jokers.length + 1) }), desc: g => `X${Math.max(1, balJokerSlots(g) - g.jokers.length + 1)} Mult` },
    { id: 'four_fingers', name: 'Four Fingers', rarity: 2, cost: 7, text: 'All Flushes and Straights can be made with 4 cards', passive: true },
    { id: 'mime', name: 'Mime', rarity: 2, cost: 5, text: 'Retrigger all card held in hand abilities', heldRetrigger: () => 1 },
    { id: 'dagger', name: 'Ceremonial Dagger', rarity: 2, cost: 6, text: 'When Blind is selected, destroy the Joker to the right and permanently add double its sell value to Mult', counter: 0,
      onBlindStart: (g, j) => { const i = g.jokers.indexOf(j); const victim = g.jokers[i + 1]; if (victim && !victim.eternal) { j.counter += balSellValue(victim) * 2; g.jokers.splice(i + 1, 1); balToast(g, 'Ceremonial Dagger', 'consumed ' + victim.def.name); } },
      indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'marble', name: 'Marble Joker', rarity: 2, cost: 6, text: 'Adds one Stone card to the deck when Blind is selected',
      onBlindStart: g => { const c = balMakeCard(balRandomRank(), balRandInt(4)); c.enhancement = 'stone'; g.deck.push(c); } },
    { id: 'loyalty', name: 'Loyalty Card', rarity: 2, cost: 5, text: 'X4 Mult every 6 hands played', counter: 0,
      onPlay: c => { c.after = () => { c.self.counter = (c.self.counter + 1) % 6; }; },
      indep: c => c.self.counter === 5 ? { xmult: 4 } : null, desc: (g, j) => j.counter === 5 ? 'Active!' : `${5 - j.counter} hands remaining` },
    { id: 'dusk', name: 'Dusk', rarity: 2, cost: 5, text: 'Retrigger all played cards in the final hand of the round', retrigger: c => c.g.hands === 0 ? 1 : 0 },
    { id: 'fibonacci', name: 'Fibonacci', rarity: 2, cost: 8, text: 'Each played Ace, 2, 3, 5 or 8 gives +8 Mult when scored', scored: (c, cd) => [14, 2, 3, 5, 8].includes(cd.rank) ? { mult: 8 } : null },
    { id: 'steel_joker', name: 'Steel Joker', rarity: 2, cost: 7, text: 'X0.2 Mult for each Steel Card in your full deck',
      indep: c => ({ xmult: 1 + 0.2 * c.g.deck.filter(x => x.enhancement === 'steel').length }), desc: g => `X${(1 + 0.2 * g.deck.filter(x => x.enhancement === 'steel').length).toFixed(1)} Mult` },
    { id: 'hack', name: 'Hack', rarity: 2, cost: 6, text: 'Retrigger each played 2, 3, 4 or 5', retrigger: (c, cd) => [2, 3, 4, 5].includes(cd.rank) ? 1 : 0 },
    { id: 'pareidolia', name: 'Pareidolia', rarity: 2, cost: 5, text: 'All cards are considered face cards', passive: true },
    { id: 'space', name: 'Space Joker', rarity: 2, cost: 5, text: '1 in 4 chance to upgrade the level of the played poker hand',
      onPlay: c => { if (balChance(c.g, 1, 4)) { balLevelUp(c.g, c.handKey, 1); balToast(c.g, 'Space Joker', 'level up!'); } } },
    { id: 'burglar', name: 'Burglar', rarity: 2, cost: 6, text: 'When Blind is selected, gain +3 Hands and lose all discards',
      onBlindStart: g => { g.hands += 3; g.discards = 0; } },
    { id: 'blackboard', name: 'Blackboard', rarity: 2, cost: 6, text: 'X3 Mult if all cards held in hand are Spades or Clubs',
      indep: c => c.held.every(cd => balSuit(cd, 0, c.g) || balSuit(cd, 3, c.g)) ? { xmult: 3 } : null },
    { id: 'sixth_sense', name: 'Sixth Sense', rarity: 2, cost: 6, text: 'If the first hand of the round is a single 6, destroy it and create a Spectral card',
      onPlay: c => { if (c.g.handsPlayedThisRound === 0 && c.played.length === 1 && c.played[0].rank === 6) { c.destroyPlayed = [c.played[0]]; balCreateConsumable(c.g, 'spectral'); } } },
    { id: 'constellation', name: 'Constellation', rarity: 2, cost: 6, text: 'This Joker gains X0.1 Mult every time a Planet card is used', counter: 0,
      indep: c => ({ xmult: 1 + 0.1 * c.self.counter }), desc: (g, j) => `X${(1 + 0.1 * j.counter).toFixed(1)} Mult` },
    { id: 'hiker', name: 'Hiker', rarity: 2, cost: 5, text: 'Every played card permanently gains +5 Chips when scored',
      scored: (c, cd) => { cd.bonusChips = (cd.bonusChips || 0) + 5; return null; } },
    { id: 'card_sharp', name: 'Card Sharp', rarity: 2, cost: 6, text: 'X3 Mult if the played poker hand has already been played this round',
      indep: c => c.g.roundHands.includes(c.handKey) ? { xmult: 3 } : null },
    { id: 'madness', name: 'Madness', rarity: 2, cost: 7, text: 'When Small or Big Blind is selected, gain X0.5 Mult and destroy a random Joker', counter: 0,
      onBlindStart: (g, j) => { if (g.blindIndex === 2) return; j.counter += 0.5; const others = g.jokers.filter(x => x !== j && !x.eternal); if (others.length) { const v = others[balRandInt(others.length)]; g.jokers.splice(g.jokers.indexOf(v), 1); balToast(g, 'Madness', 'devoured ' + v.def.name); } },
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(1)} Mult` },
    { id: 'seance', name: 'Seance', rarity: 2, cost: 6, text: 'If the played poker hand is a Straight Flush, create a random Spectral card',
      indep: c => c.handKey === 'straight_flush' ? { create: 'spectral', msg: 'Spectral!' } : null },
    { id: 'vampire', name: 'Vampire', rarity: 2, cost: 7, text: 'This Joker gains X0.1 Mult per scoring Enhanced card played, removes the Enhancement', counter: 0,
      onPlay: c => { c.scoring.forEach(cd => { if (cd.enhancement && cd.enhancement !== 'stone') { c.self.counter += 0.1; cd.enhancement = null; } }); },
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(1)} Mult` },
    { id: 'shortcut', name: 'Shortcut', rarity: 2, cost: 7, text: 'Allows Straights to be made with gaps of 1 rank', passive: true },
    { id: 'hologram', name: 'Hologram', rarity: 2, cost: 7, text: 'This Joker gains X0.25 Mult every time a playing card is added to your deck', counter: 0,
      indep: c => ({ xmult: 1 + 0.25 * c.self.counter }), desc: (g, j) => `X${(1 + 0.25 * j.counter).toFixed(2)} Mult` },
    { id: 'cloud9', name: 'Cloud 9', rarity: 2, cost: 7, text: 'Earn $1 for each 9 in your full deck at end of round',
      onRoundEnd: g => ({ money: g.deck.filter(c => c.rank === 9).length }), desc: g => `$${g.deck.filter(c => c.rank === 9).length}` },
    { id: 'rocket', name: 'Rocket', rarity: 2, cost: 6, text: 'Earn $1 at end of round, payout increases by $2 when Boss Blind is defeated', counter: 1,
      onRoundEnd: (g, j) => ({ money: j.counter }), desc: (g, j) => `Currently $${j.counter}` },
    { id: 'midas', name: 'Midas Mask', rarity: 2, cost: 7, text: 'All played face cards become Gold cards when scored',
      scored: (c, cd) => { if (balIsFace(cd, c.g)) cd.enhancement = 'gold'; return null; } },
    { id: 'luchador', name: 'Luchador', rarity: 2, cost: 5, text: 'Sell this card to disable the current Boss Blind', onSold: g => { if (g.blindIndex === 2) { g.bossDisabled = true; balToast(g, 'Luchador', 'boss blind disabled'); } } },
    { id: 'gift_card', name: 'Gift Card', rarity: 2, cost: 6, text: 'Add $1 of sell value to every Joker and Consumable card at end of round',
      onRoundEnd: g => { g.jokers.forEach(j => j.extraValue = (j.extraValue || 0) + 1); g.consumables.forEach(c => c.extraValue = (c.extraValue || 0) + 1); return null; } },
    { id: 'turtle_bean', name: 'Turtle Bean', rarity: 2, cost: 6, text: '+5 hand size, reduces by 1 each round', counter: 5,
      passive: true, handSizeFn: j => j.counter, onRoundEnd: (g, j) => { j.counter--; return j.counter <= 0 ? { destroy: true, msg: 'Spoiled!' } : null; }, desc: (g, j) => `Currently +${j.counter} hand size` },
    { id: 'erosion', name: 'Erosion', rarity: 2, cost: 6, text: '+4 Mult for each card below the starting deck size in your full deck',
      indep: c => ({ mult: 4 * Math.max(0, c.g.startingDeckSize - c.g.deck.length) }), desc: g => `+${4 * Math.max(0, g.startingDeckSize - g.deck.length)} Mult` },
    { id: 'to_the_moon', name: 'To the Moon', rarity: 2, cost: 5, text: 'Earn an extra $1 of interest for every $5 you have at end of round', passive: true },
    { id: 'stone_joker', name: 'Stone Joker', rarity: 2, cost: 6, text: '+25 Chips for each Stone Card in your full deck',
      indep: c => ({ chips: 25 * c.g.deck.filter(x => x.enhancement === 'stone').length }), desc: g => `+${25 * g.deck.filter(x => x.enhancement === 'stone').length} Chips` },
    { id: 'lucky_cat', name: 'Lucky Cat', rarity: 2, cost: 6, text: 'This Joker gains X0.25 Mult every time a Lucky card successfully triggers', counter: 0,
      indep: c => ({ xmult: 1 + 0.25 * c.self.counter }), desc: (g, j) => `X${(1 + 0.25 * j.counter).toFixed(2)} Mult` },
    { id: 'bull', name: 'Bull', rarity: 2, cost: 6, text: '+2 Chips for each $1 you have', indep: c => ({ chips: 2 * Math.max(0, c.g.money) }), desc: g => `+${2 * Math.max(0, g.money)} Chips` },
    { id: 'diet_cola', name: 'Diet Cola', rarity: 2, cost: 6, text: 'Sell this card to gain a free Double Tag', onSold: g => { g.pendingTags.push('double'); balToast(g, 'Diet Cola', 'Double Tag gained'); } },
    { id: 'trading_card', name: 'Trading Card', rarity: 2, cost: 6, text: 'If the first discard of a round has only 1 card, destroy it and earn $3',
      onDiscard: (g, cards) => { if (g.discardsUsedThisRound === 0 && cards.length === 1) { balRemoveFromDeck(g, cards[0]); return { money: 3, consumed: true }; } return null; } },
    { id: 'flash_card', name: 'Flash Card', rarity: 2, cost: 5, text: 'This Joker gains +2 Mult per shop reroll', counter: 0,
      indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'spare_trousers', name: 'Spare Trousers', rarity: 2, cost: 6, text: 'This Joker gains +2 Mult if the played hand contains a Two Pair', counter: 0,
      onPlay: c => { if (c.parts.two_pair) c.self.counter += 2; }, indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'ramen', name: 'Ramen', rarity: 2, cost: 6, text: 'X2 Mult, loses X0.01 Mult per card discarded', counter: 2,
      indep: c => ({ xmult: c.self.counter }), onDiscard: (g, cards, j) => { j.counter = Math.max(0, +(j.counter - 0.01 * cards.length).toFixed(2)); return j.counter <= 1 ? { destroy: true, msg: 'Slurped!' } : null; },
      desc: (g, j) => `X${j.counter.toFixed(2)} Mult` },
    { id: 'seltzer', name: 'Seltzer', rarity: 2, cost: 6, text: 'Retrigger all cards played for the next 10 hands', counter: 10,
      retrigger: () => 1, onPlay: c => { c.after = () => { c.self.counter--; if (c.self.counter <= 0) c.self.destroy = true; }; }, desc: (g, j) => `${j.counter} hands remaining` },
    { id: 'castle', name: 'Castle', rarity: 2, cost: 6, text: 'This Joker gains +3 Chips per discarded card of the listed suit', counter: 0,
      init: j => { j.target = balRandInt(4); },
      onDiscard: (g, cards, j) => { j.counter += 3 * cards.filter(c => balSuit(c, j.target, g)).length; return null; },
      indep: c => ({ chips: c.self.counter }), desc: (g, j) => `+${j.counter} Chips (${BAL.SUITS[j.target].name})` },
    { id: 'mr_bones', name: 'Mr. Bones', rarity: 2, cost: 5, text: 'Prevents Death if chips scored are at least 25% of required chips, then self destructs', passive: true },
    { id: 'acrobat', name: 'Acrobat', rarity: 2, cost: 6, text: 'X3 Mult on the final hand of the round', indep: c => c.g.hands === 0 ? { xmult: 3 } : null },
    { id: 'sock_buskin', name: 'Sock and Buskin', rarity: 2, cost: 6, text: 'Retrigger all played face cards', retrigger: (c, cd) => balIsFace(cd, c.g) ? 1 : 0 },
    { id: 'troubadour', name: 'Troubadour', rarity: 2, cost: 6, text: '+2 hand size, -1 hand per round', passive: true, handSize: 2, hands: -1 },
    { id: 'certificate', name: 'Certificate', rarity: 2, cost: 6, text: 'When the round begins, add a random playing card with a random seal to your hand',
      onBlindStart: g => { const c = balMakeCard(balRandomRank(), balRandInt(4)); c.seal = ['red', 'blue', 'gold', 'purple'][balRandInt(4)]; g.deck.push(c); g.pendingHandCards.push(c); } },
    { id: 'smeared', name: 'Smeared Joker', rarity: 2, cost: 7, text: 'Hearts and Diamonds count as the same suit, as do Spades and Clubs', passive: true },
    { id: 'throwback', name: 'Throwback', rarity: 2, cost: 6, text: 'X0.25 Mult for each Blind skipped this run',
      indep: c => ({ xmult: 1 + 0.25 * c.g.stats.blindsSkipped }), desc: g => `X${(1 + 0.25 * g.stats.blindsSkipped).toFixed(2)} Mult` },
    { id: 'rough_gem', name: 'Rough Gem', rarity: 2, cost: 7, text: 'Played cards with Diamond suit earn $1 when scored', scored: (c, cd) => balSuit(cd, 2, c.g) ? { money: 1 } : null },
    { id: 'bloodstone', name: 'Bloodstone', rarity: 2, cost: 7, text: '1 in 2 chance for played cards with Heart suit to give X1.5 Mult when scored',
      scored: (c, cd) => (balSuit(cd, 1, c.g) && balChance(c.g, 1, 2)) ? { xmult: 1.5 } : null },
    { id: 'arrowhead', name: 'Arrowhead', rarity: 2, cost: 7, text: 'Played cards with Spade suit give +50 Chips when scored', scored: (c, cd) => balSuit(cd, 0, c.g) ? { chips: 50 } : null },
    { id: 'onyx_agate', name: 'Onyx Agate', rarity: 2, cost: 7, text: 'Played cards with Club suit give +7 Mult when scored', scored: (c, cd) => balSuit(cd, 3, c.g) ? { mult: 7 } : null },
    { id: 'glass_joker', name: 'Glass Joker', rarity: 2, cost: 6, text: 'This Joker gains X0.75 Mult for every Glass Card that is destroyed', counter: 0,
      indep: c => ({ xmult: 1 + 0.75 * c.self.counter }), desc: (g, j) => `X${(1 + 0.75 * j.counter).toFixed(2)} Mult` },
    { id: 'showman', name: 'Showman', rarity: 2, cost: 5, text: 'Joker, Tarot, Planet and Spectral cards may appear multiple times', passive: true },
    { id: 'flower_pot', name: 'Flower Pot', rarity: 2, cost: 6, text: 'X3 Mult if the poker hand contains a Diamond, Club, Heart and Spade card',
      indep: c => { const seen = [0, 1, 2, 3].filter(s => c.scoring.some(cd => balSuit(cd, s, c.g))); return seen.length === 4 ? { xmult: 3 } : null; } },
    { id: 'merry_andy', name: 'Merry Andy', rarity: 2, cost: 7, text: '+3 discards each round, -1 hand size', passive: true, discards: 3, handSize: -1 },
    { id: 'oops', name: 'Oops! All 6s', rarity: 2, cost: 4, text: 'Doubles all listed probabilities', passive: true },
    { id: 'idol', name: 'The Idol', rarity: 2, cost: 6, text: 'Each played card of the listed rank and suit gives X2 Mult when scored',
      init: j => { j.target = balRandomRank(); j.suit = balRandInt(4); },
      scored: (c, cd) => (cd.rank === c.self.target && balSuit(cd, c.self.suit, c.g)) ? { xmult: 2 } : null,
      desc: (g, j) => `${BAL.RANK_NAME[j.target]} of ${BAL.SUITS[j.suit].name}` },
    { id: 'seeing_double', name: 'Seeing Double', rarity: 2, cost: 6, text: 'X2 Mult if the played hand has a scoring Club card and a scoring card of any other suit',
      indep: c => { const club = c.scoring.some(cd => balSuit(cd, 3, c.g)); const other = c.scoring.some(cd => [0, 1, 2].some(s => balSuit(cd, s, c.g))); return (club && other) ? { xmult: 2 } : null; } },
    { id: 'matador', name: 'Matador', rarity: 2, cost: 7, text: 'Earn $8 if the played hand triggers the Boss Blind ability',
      onPlay: c => { if (c.g.bossTriggeredThisHand) c.money = (c.money || 0) + 8; } },
    { id: 'satellite', name: 'Satellite', rarity: 2, cost: 6, text: 'Earn $1 at end of round per unique Planet card used this run',
      onRoundEnd: g => ({ money: g.stats.uniquePlanets.size }), desc: g => `$${g.stats.uniquePlanets.size}` },
    { id: 'cartomancer', name: 'Cartomancer', rarity: 2, cost: 6, text: 'Create a Tarot card when Blind is selected', onBlindStart: g => balCreateConsumable(g, 'tarot') },
    { id: 'astronomer', name: 'Astronomer', rarity: 2, cost: 8, text: 'All Planet cards and Celestial Packs in the shop are free', passive: true },
    { id: 'burnt', name: 'Burnt Joker', rarity: 2, cost: 8, text: 'Upgrade the level of the first discarded poker hand each round',
      onDiscard: (g, cards, j) => { if (g.discardsUsedThisRound === 0) { const ev = balEvaluate(g, cards); balLevelUp(g, ev.key, 1); balToast(g, 'Burnt Joker', BAL.HANDS[ev.key].name + ' level up'); } return null; } },
    { id: 'bootstraps', name: 'Bootstraps', rarity: 2, cost: 7, text: '+2 Mult for every $5 you have', indep: c => ({ mult: 2 * Math.floor(Math.max(0, c.g.money) / 5) }), desc: g => `+${2 * Math.floor(Math.max(0, g.money) / 5)} Mult` },
    { id: 'stuntman', name: 'Stuntman', rarity: 2, cost: 7, text: '+250 Chips, -2 hand size', indep: () => ({ chips: 250 }), passive: true, handSize: -2 },

    // ---------- rare ----------
    { id: 'dna', name: 'DNA', rarity: 3, cost: 8, text: 'If the first hand of the round has only 1 card, add a permanent copy of it to your deck and draw it',
      onPlay: c => { if (c.g.handsPlayedThisRound === 0 && c.played.length === 1) { const copy = balCloneCard(c.played[0]); c.g.deck.push(copy); c.g.pendingHandCards.push(copy); balToast(c.g, 'DNA', 'card duplicated'); } } },
    { id: 'vagabond', name: 'Vagabond', rarity: 3, cost: 8, text: 'Create a Tarot card if a hand is played with $4 or less',
      indep: c => c.g.money <= 4 ? { create: 'tarot', msg: 'Tarot!' } : null },
    { id: 'baron', name: 'Baron', rarity: 3, cost: 8, text: 'Each King held in hand gives X1.5 Mult', held: (c, cd) => cd.rank === 13 ? { xmult: 1.5 } : null },
    { id: 'obelisk', name: 'Obelisk', rarity: 3, cost: 8, text: 'This Joker gains X0.2 Mult per consecutive hand played without playing your most played poker hand', counter: 0,
      onPlay: c => { const most = balMostPlayedHand(c.g); if (c.handKey === most) c.self.counter = 0; else c.self.counter += 0.2; },
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(1)} Mult` },
    { id: 'baseball', name: 'Baseball Card', rarity: 3, cost: 8, text: 'Uncommon Jokers each give X1.5 Mult',
      indep: c => { const n = c.g.jokers.filter(j => j.def.rarity === 2).length; return n ? { xmult: Math.pow(1.5, n) } : null; },
      desc: g => `X${Math.pow(1.5, g.jokers.filter(j => j.def.rarity === 2).length).toFixed(2)} Mult` },
    { id: 'ancient', name: 'Ancient Joker', rarity: 3, cost: 8, text: 'Each played card of the listed suit gives X1.5 Mult when scored',
      init: j => { j.target = balRandInt(4); },
      scored: (c, cd) => balSuit(cd, c.self.target, c.g) ? { xmult: 1.5 } : null,
      onRoundEnd: (g, j) => { j.target = balRandInt(4); return null; }, desc: (g, j) => `Suit: ${BAL.SUITS[j.target].name}` },
    { id: 'campfire', name: 'Campfire', rarity: 3, cost: 9, text: 'This Joker gains X0.25 Mult for each card sold, resets when Boss Blind is defeated', counter: 0,
      indep: c => ({ xmult: 1 + 0.25 * c.self.counter }), desc: (g, j) => `X${(1 + 0.25 * j.counter).toFixed(2)} Mult` },
    { id: 'blueprint', name: 'Blueprint', rarity: 3, cost: 10, text: 'Copies the ability of the Joker to the right', copy: 1 },
    { id: 'brainstorm', name: 'Brainstorm', rarity: 3, cost: 10, text: 'Copies the ability of the leftmost Joker', copyLeftmost: true },
    { id: 'wee', name: 'Wee Joker', rarity: 3, cost: 8, text: 'This Joker gains +8 Chips when each played 2 is scored', counter: 0,
      scored: (c, cd) => { if (cd.rank === 2) c.self.counter += 8; return null; }, indep: c => ({ chips: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Chips` },
    { id: 'hit_road', name: 'Hit the Road', rarity: 3, cost: 8, text: 'This Joker gains X0.5 Mult for every Jack discarded this round', counter: 0,
      onDiscard: (g, cards, j) => { j.counter += 0.5 * cards.filter(c => c.rank === 11).length; return null; },
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(1)} Mult` },
    { id: 'duo', name: 'The Duo', rarity: 3, cost: 8, text: 'X2 Mult if the played hand contains a Pair', indep: c => c.parts.pair ? { xmult: 2 } : null },
    { id: 'trio', name: 'The Trio', rarity: 3, cost: 8, text: 'X3 Mult if the played hand contains a Three of a Kind', indep: c => c.parts.three ? { xmult: 3 } : null },
    { id: 'family', name: 'The Family', rarity: 3, cost: 8, text: 'X4 Mult if the played hand contains a Four of a Kind', indep: c => c.parts.four ? { xmult: 4 } : null },
    { id: 'order', name: 'The Order', rarity: 3, cost: 8, text: 'X3 Mult if the played hand contains a Straight', indep: c => c.parts.straight ? { xmult: 3 } : null },
    { id: 'tribe', name: 'The Tribe', rarity: 3, cost: 8, text: 'X2 Mult if the played hand contains a Flush', indep: c => c.parts.flush ? { xmult: 2 } : null },
    { id: 'invisible', name: 'Invisible Joker', rarity: 3, cost: 8, text: 'After 2 rounds, sell this card to duplicate a random Joker', counter: 0,
      onRoundEnd: (g, j) => { j.counter++; return null; },
      onSold: (g, j) => { if (j.counter >= 2) { const others = g.jokers.filter(x => x !== j); if (others.length) { const src = others[balRandInt(others.length)]; balAddJoker(g, src.def, { edition: src.edition }); balToast(g, 'Invisible Joker', 'duplicated ' + src.def.name); } } },
      desc: (g, j) => `${j.counter}/2 rounds` },
    { id: 'drivers', name: "Driver's License", rarity: 3, cost: 7, text: 'X3 Mult if you have at least 16 Enhanced cards in your full deck',
      indep: c => c.g.deck.filter(x => x.enhancement).length >= 16 ? { xmult: 3 } : null, desc: g => `${g.deck.filter(x => x.enhancement).length}/16 enhanced` },

    // ---------- legendary ----------
    { id: 'canio', name: 'Canio', rarity: 4, cost: 20, text: 'This Joker gains X1 Mult when a face card is destroyed', counter: 0,
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(0)} Mult` },
    { id: 'triboulet', name: 'Triboulet', rarity: 4, cost: 20, text: 'Played Kings and Queens each give X2 Mult when scored',
      scored: (c, cd) => (cd.rank === 13 || cd.rank === 12) ? { xmult: 2 } : null },
    { id: 'yorick', name: 'Yorick', rarity: 4, cost: 20, text: 'This Joker gains X1 Mult every 23 cards discarded', counter: 0, state: 0,
      onDiscard: (g, cards, j) => { j.state = (j.state || 0) + cards.length; while (j.state >= 23) { j.state -= 23; j.counter++; } return null; },
      indep: c => ({ xmult: 1 + c.self.counter }), desc: (g, j) => `X${(1 + j.counter).toFixed(0)} Mult, ${23 - (j.state || 0)} to go` },
    { id: 'chicot', name: 'Chicot', rarity: 4, cost: 20, text: 'Disables the effect of every Boss Blind', passive: true },
    { id: 'perkeo', name: 'Perkeo', rarity: 4, cost: 20, text: 'Creates a Negative copy of 1 random consumable card in your hand at the end of the shop',
      onShopExit: g => { if (!g.consumables.length) return; const src = g.consumables[balRandInt(g.consumables.length)]; const copy = { ...src, negative: true, uid: balUid() }; g.consumables.push(copy); balToast(g, 'Perkeo', 'negative ' + src.name); } },

    // ---------- extras: not in the original game ----------
    { id: 'x_troll', name: 'Troll Face', rarity: 2, cost: 6, extra: true, text: 'X4 Mult, but a 1 in 4 chance to give X0 Mult instead. problem?',
      indep: c => balChance(c.g, 1, 4) ? { xmult: 0, msg: 'problem?' } : { xmult: 4 } },
    { id: 'x_dialup', name: 'Dial-Up Joker', rarity: 1, cost: 5, extra: true, text: '+150 Chips on the first hand of each round only',
      indep: c => c.g.handsPlayedThisRound === 0 ? { chips: 150 } : null },
    { id: 'x_winamp', name: 'Winamp', rarity: 1, cost: 5, extra: true, text: '+2 Mult for each card still held in hand. it really whips the llama',
      indep: c => ({ mult: 2 * c.held.length }) },
    { id: 'x_bsod', name: 'Blue Screen', rarity: 3, cost: 8, extra: true, text: 'X6 Mult, but this Joker is destroyed if you fail a Blind',
      indep: () => ({ xmult: 6 }) },
    { id: 'x_defrag', name: 'Defrag.exe', rarity: 2, cost: 6, extra: true, text: 'This Joker gains +12 Chips every time you discard', counter: 0,
      onDiscard: (g, cards, j) => { j.counter += 12; return null; }, indep: c => ({ chips: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Chips` },
    { id: 'x_clippy', name: 'Clippy', rarity: 1, cost: 4, extra: true, text: 'It looks like you are playing a Pair. +6 Mult for the hand you play least often',
      indep: c => c.handKey === balLeastPlayedHand(c.g) ? { mult: 6 } : null, desc: g => `Least played: ${BAL.HANDS[balLeastPlayedHand(g)].name}` },
    { id: 'x_hitcounter', name: 'Hit Counter', rarity: 2, cost: 6, extra: true, text: 'This Joker gains +1 Mult every hand played, and never resets', counter: 0,
      onPlay: c => { c.after = () => c.self.counter++; }, indep: c => ({ mult: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Mult` },
    { id: 'x_guestbook', name: 'Guestbook', rarity: 2, cost: 6, extra: true, text: 'Earn $1 for each Joker you own at end of round. sign it bradar',
      onRoundEnd: g => ({ money: g.jokers.length }), desc: g => `$${g.jokers.length}` },
    { id: 'x_crt', name: 'CRT Monitor', rarity: 2, cost: 7, extra: true, text: 'Retrigger every scoring card once, but -1 hand size',
      retrigger: () => 1, passive: true, handSize: -1 },
    { id: 'x_404', name: 'Error 404', rarity: 3, cost: 8, extra: true, text: 'X0.5 Mult per hand type you have NEVER played this run',
      indep: c => { const n = Object.keys(BAL.HANDS).filter(k => !(c.g.handPlays[k] > 0)).length; return { xmult: 1 + 0.5 * n }; },
      desc: g => `X${(1 + 0.5 * Object.keys(BAL.HANDS).filter(k => !(g.handPlays[k] > 0)).length).toFixed(1)} Mult` },
    { id: 'x_shareware', name: 'Shareware Joker', rarity: 1, cost: 3, extra: true, text: '+30 Mult, but expires and self-destructs after 3 rounds', counter: 3,
      indep: () => ({ mult: 30 }), onRoundEnd: (g, j) => { j.counter--; return j.counter <= 0 ? { destroy: true, msg: 'Trial expired!' } : null; },
      desc: (g, j) => `${j.counter} rounds remaining` },
    { id: 'x_minesweeper', name: 'Minesweeper', rarity: 2, cost: 6, extra: true, text: 'X0.3 Mult per scoring card, but 1 in 8 chance to destroy a random card in your deck',
      indep: c => { if (balChance(c.g, 1, 8) && c.g.deck.length > 10) { const v = c.g.deck[balRandInt(c.g.deck.length)]; balRemoveFromDeck(c.g, v); return { xmult: 1 + 0.3 * c.scoring.length, msg: 'BOOM' }; } return { xmult: 1 + 0.3 * c.scoring.length }; } },
    { id: 'x_solitaire', name: 'Solitaire', rarity: 2, cost: 6, extra: true, text: 'X2 Mult if every scoring card alternates red and black',
      indep: c => { const s = c.scoring.filter(x => x.enhancement !== 'stone'); if (s.length < 2) return null; for (let i = 1; i < s.length; i++) if (balIsRed(s[i]) === balIsRed(s[i - 1])) return null; return { xmult: 2 }; } },
    { id: 'x_y2k', name: 'Y2K Bug', rarity: 3, cost: 9, extra: true, text: 'X0.05 Mult for every card left in your draw pile. panic is justified',
      indep: c => ({ xmult: 1 + 0.05 * c.g.drawPile.length }), desc: g => `X${(1 + 0.05 * g.drawPile.length).toFixed(2)} Mult` },
    { id: 'x_geocities', name: 'Under Construction', rarity: 1, cost: 4, extra: true, text: 'This Joker gains +15 Chips at the end of every round, forever', counter: 0,
      onRoundEnd: (g, j) => { j.counter += 15; return null; }, indep: c => ({ chips: c.self.counter }), desc: (g, j) => `Currently +${j.counter} Chips` }
];

BAL.JOKERS_BY_ID = {};
BAL.JOKERS.forEach(j => { BAL.JOKERS_BY_ID[j.id] = j; });
BAL.RARITY_NAME = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Legendary' };
BAL.RARITY_COLOR = { 1: '#4a90d9', 2: '#3aa76d', 3: '#d1495b', 4: '#9b5de5' };
