/* echoes of the tide — the overworld.
 *
 * Tile maps, grid-locked walking and a camera that follows. Everything
 * the menu screens used to do is now something you walk up to and press
 * a key at: the anvil forges, the water's edge takes a line, the boat
 * puts out to sea, and the people on the deck have the conversations
 * that used to be buttons.
 *
 * Maps are arrays of strings, one character per tile. The legend is in
 * TILES below and the engine only ever asks three questions of a tile —
 * can I stand on it, does it hide encounters, and what happens if I
 * press a key at it.
 */

window.ECHOES_WORLD = (function () {
    'use strict';

    const TILE = 16;

    // ---------- the tile legend ----------
    // solid: cannot be walked onto. encounter: rolls for a fight when you
    // finish a step on it. face: what pressing a key at it, from outside,
    // is understood to mean.
    const TILES = {
        '.': { sprite: 'tile_deck', name: 'decking' },
        ',': { sprite: 'tile_plate', name: 'rig plate' },
        's': { sprite: 'tile_stone', name: 'wet stone' },
        'k': { sprite: 'tile_kelp', name: 'kelp', encounter: true },
        '"': { sprite: 'tile_slick', name: 'a marrow slick', encounter: true },
        '~': { sprite: 'tile_water', name: 'open water', solid: true, face: 'angle' },
        '#': { sprite: 'tile_wall', name: 'plating', solid: true },
        'r': { sprite: 'tile_rail', name: 'the rail', solid: true },
        'c': { sprite: 'tile_crate', name: 'crates', solid: true, face: 'read' },
        'D': { sprite: 'tile_door', name: 'a door', solid: true, face: 'warp' },
        'S': { sprite: 'tile_stair', name: 'stairs', solid: true, face: 'warp' },
        'A': { sprite: 'tile_anvil', name: 'an anvil', solid: true, face: 'forge' },
        'F': { sprite: 'tile_forge', name: 'the furnace', solid: true, face: 'forge' },
        'L': { sprite: 'tile_lamp', name: 'a lamp post', solid: true },
        'B': { sprite: 'tile_deck', name: 'the boat', solid: true, face: 'voyage', overlay: 'boat' },
        'R': { sprite: 'tile_deck', name: 'a rest bunk', solid: true, face: 'rest', overlay: 'bunk' }
    };

    // ---------- the maps ----------
    const MAPS = {
        rust_harbour: {
            id: 'rust_harbour', realm: 'rust_shallows',
            name: 'Vell\'s Landing',
            rows: [
                '~~~~~~~~~~~~~~~~~~~~~~~~',
                '~~~~~~~~~~~~~~~~~~~~~~~~',
                '~~rrrrrrrrrrrrrrrrrrrr~~',
                '~~r..................r~~',
                '~~r.cc...kkk....L....r~~',
                '~~r.cc...kkk.........r~~',
                '~~r......kkk....ccc..D~~',
                '~~r..................r~~',
                '~~r.L....."".....L...r~~',
                '~~r......."".........r~~',
                '~~r..................r~~',
                '~~r...D..............r~~',
                '~~r..................r~~',
                '~~r....kk......R.....r~~',
                '~~r....kk............r~~',
                '~~rrrrrrrr..rrrrrrrrrr~~',
                '~~~~~~~~~~B.~~~~~~~~~~~~',
                '~~~~~~~~~~~~~~~~~~~~~~~~'
            ],
            spawn: { x: 11, y: 12, dir: 'down' },
            warps: {
                '21,6': { map: 'grand_anvil', x: 8, y: 11, dir: 'up' },
                '6,11': { map: 'listening_post', x: 7, y: 10, dir: 'up' }
            },
            npcs: [
                { x: 8, y: 3, sprite: 'npc_smith', dir: 'down', name: 'Harbourmaster Vell',
                  lines: ['Warm brass, they said. Nineteen years on this landing and warm brass is the one thing I have never had reported.',
                          'Keep your hands inside the rail.'] },
                { x: 16, y: 9, sprite: 'npc_dredger', dir: 'left', name: 'A Dredger',
                  lines: ['The reef repeats things. Some of them have not happened yet.',
                          'If you hear your own voice out there, do not answer it.'] },
                { x: 12, y: 14, sprite: 'npc_inquisitor', dir: 'up', name: 'An Ash Acolyte',
                  lines: ['We are not cruel, diver. We are early.',
                          'The Sun is not lost. It is buried. Dig with fire.'] }
            ],
            signs: { '4,4': 'SALVAGE, WEIGHED AND PAID. NO MARROW.', '18,6': 'RIG NINE MAIL — SUSPENDED' }
        },

        grand_anvil: {
            id: 'grand_anvil', realm: 'rust_shallows',
            name: 'The Grand Anvil',
            interior: true,
            rows: [
                '################',
                '#,,,,,,,,,,,,,,#',
                '#,FF,,,,,,,,FF,#',
                '#,,,,,,,,,,,,,,#',
                '#,,A,,,,,,,,A,,#',
                '#,,,,,,,,,,,,,,#',
                '#,,,,,,,,,,,,,,#',
                '#,cc,,,,,,,,cc,#',
                '#,,,,,,,,,,,,,,#',
                '#,,,,,,,,,,,,,,#',
                '#,,,,,,R,,,,,,,#',
                '#,,,,,,,,,,,,,,#',
                '#######DD#######'
            ],
            spawn: { x: 8, y: 11, dir: 'up' },
            warps: { '7,12': { map: 'rust_harbour', x: 20, y: 6, dir: 'left' }, '8,12': { map: 'rust_harbour', x: 20, y: 6, dir: 'left' } },
            npcs: [
                { x: 8, y: 3, sprite: 'npc_smith', dir: 'down', name: 'Chief Engineer Vaelen Voss',
                  dialogue: 'dlg_vaelen_act2_01',
                  lines: ['Get inside before the brine eats through your seals.',
                          'Flesh is weak, diver. Steel does not sink.'] },
                { x: 3, y: 8, sprite: 'npc_smith', dir: 'right', name: 'A Foundry Hand',
                  lines: ['Hold the metal in the band and it comes off the anvil singing. Pull it cold and it comes off apologising.'] }
            ],
            signs: { '2,7': 'STOCK — SCRAP IRON, ABYSSAL BRONZE. SIGN FOR IT.' }
        },

        listening_post: {
            id: 'listening_post', realm: 'rust_shallows',
            name: 'The Hiring Floor',
            interior: true,
            rows: [
                '################',
                '#sssssssssssss##',
                '#s,,,s,,,s,,,s##',
                '#s,,,s,,,s,,,s##',
                '#sssssssssssss##',
                '#sssssssssssss##',
                '#s,,,s,,,s,,,s##',
                '#s,,,s,,,s,,,s##',
                '#sssssssssssss##',
                '#sssssssssssss##',
                '#sssssRssssssss#',
                '#######DD#######'
            ],
            spawn: { x: 7, y: 10, dir: 'up' },
            warps: { '7,11': { map: 'rust_harbour', x: 6, y: 12, dir: 'down' }, '8,11': { map: 'rust_harbour', x: 6, y: 12, dir: 'down' } },
            npcs: [
                { x: 3, y: 3, sprite: 'npc_smith', dir: 'down', name: 'Foreman Adeyemi',
                  guild: 'syndicate',
                  lines: ['The Syndicate keeps it floating and asks later. Sign, and you get the forge and the benefit of a doubt.'] },
                { x: 7, y: 3, sprite: 'npc_dredger', dir: 'down', name: 'Matron Sooley',
                  guild: 'dredgers', dialogue: 'dlg_nahesia_act2_01',
                  lines: ['It talks. It has talked for three hundred years and the whole world has agreed to call it current.'] },
                { x: 11, y: 3, sprite: 'npc_inquisitor', dir: 'down', name: 'Confessor Brant',
                  guild: 'inquisitors', dialogue: 'dlg_malakor_act2_01',
                  lines: ['The dark must be cleansed. Take the oil, or take the door.'] }
            ],
            signs: {}
        },

        reef_hollow: {
            id: 'reef_hollow', realm: 'whispering_reefs',
            name: 'The Drowned Hollow',
            rows: [
                '~~~~~~~~~~~~~~~~~~~~',
                '~~rrrrrrrrrrrrrrrr~~',
                '~~r..........FF..r~~',
                '~~r..kkkk...L....r~~',
                '~~r..kkkk.....A..r~~',
                '~~r..kkkk...""...r~~',
                '~~r.........""...r~~',
                '~~r...L..........r~~',
                '~~r.......R......r~~',
                '~~r..............r~~',
                '~~r..kk......cc..r~~',
                '~~r..kk......cc..r~~',
                '~~rrrrr..rrrrrrrrr~~',
                '~~~~~~~B.~~~~~~~~~~~',
                '~~~~~~~~~~~~~~~~~~~~'
            ],
            spawn: { x: 8, y: 11, dir: 'up' },
            warps: {},
            npcs: [
                { x: 9, y: 3, sprite: 'npc_dredger', dir: 'down', name: 'Matriark Nahesia',
                  dialogue: 'dlg_nahesia_act2_01',
                  lines: ['You are dripping on a floor that has been listening to this room for two hundred years.',
                          'The deep is not our enemy. It is our womb.'] }
            ],
            signs: { '14,10': 'DO NOT ANSWER ANYTHING THAT USES YOUR OWN VOICE' }
        },

        jawbone_station: {
            id: 'jawbone_station', realm: 'leviathan_trench',
            name: 'Jawbone Station',
            rows: [
                '####################',
                '#,,,,,,,FF,,,,,,,,,#',
                '#,,cc,,,,,,,,,,cc,,#',
                '#,,cc,,,""",,,,cc,,#',
                '#,,,,,,,""",,,,,,,,#',
                '#,,L,,,,""",,,,L,,,#',
                '#,,A,,,,,,,,,,,,,,,#',
                '#,,,,,,,,R,,,,,,,,,#',
                '#,,,,,,,,,,,,,,,,,,#',
                '#,,kk,,,,,,,,,,kk,,#',
                '#,,kk,,,,,,,,,,kk,,#',
                '#,,,,,,,,,,,,,,,,,,#',
                '########~B~#########'
            ],
            spawn: { x: 9, y: 10, dir: 'up' },
            warps: {},
            npcs: [
                { x: 5, y: 6, sprite: 'npc_smith', dir: 'right', name: 'Chief Renderer Ostrow',
                  lines: ['Four hundred people work inside that jaw. It has been dead two hundred years and warm the whole time.',
                          'The pump you can hear is not a pump. I have known for six years.'] }
            ],
            signs: { '3,2': 'RENDERING FLOOR — MARROW ONLY — NO NAKED FLAME' }
        },

        last_cleat: {
            id: 'last_cleat', realm: 'drowned_spire',
            name: 'The Last Cleat',
            rows: [
                '################',
                '#ssssssFFssssss#',
                '#s,,,,,,,,,,,,s#',
                '#s,,"",,,,"",,s#',
                '#s,,"",,,,"",,s#',
                '#s,A,,,,,,,,,,s#',
                '#s,,,,,R,,,,,,s#',
                '#s,,,,,,,,,,,,s#',
                '#s,,LL,,,,LL,,s#',
                '#s,,,,,,,,,,,,s#',
                '#ssssss,,ssssss#',
                '######~BB~######'
            ],
            spawn: { x: 7, y: 9, dir: 'up' },
            warps: {},
            npcs: [
                { x: 7, y: 2, sprite: 'npc_inquisitor', dir: 'down', name: 'High Priest Ignis Malakor',
                  dialogue: 'dlg_malakor_act2_01',
                  lines: ['You have carried a lit piece of the Sun through two hundred miles of dark water and arrived with all your fingers.',
                          'That is either providence or it is a symptom.'] }
            ],
            signs: {}
        }
    };

    const REALM_MAP = {
        rust_shallows: 'rust_harbour',
        whispering_reefs: 'reef_hollow',
        leviathan_trench: 'jawbone_station',
        drowned_spire: 'last_cleat'
    };

    // ---------- queries ----------
    function mapById(id) { return MAPS[id] || null; }
    function tileChar(map, x, y) {
        if (!map || y < 0 || y >= map.rows.length) return '#';
        const row = map.rows[y];
        if (x < 0 || x >= row.length) return '#';
        return row[x];
    }
    function tileAt(map, x, y) { return TILES[tileChar(map, x, y)] || TILES['#']; }
    function npcAt(map, x, y) { return (map.npcs || []).find(n => n.x === x && n.y === y) || null; }
    function walkable(map, x, y) {
        const t = tileAt(map, x, y);
        if (t.solid) return false;
        return !npcAt(map, x, y);
    }
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    function ahead(pos) {
        const d = DIRS[pos.dir] || DIRS.down;
        return { x: pos.x + d[0], y: pos.y + d[1] };
    }

    // what pressing a key while facing the next tile means
    function facing(map, pos) {
        const t = ahead(pos);
        const npc = npcAt(map, t.x, t.y);
        if (npc) return { kind: 'npc', npc: npc, x: t.x, y: t.y };
        const key = t.x + ',' + t.y;
        if (map.warps && map.warps[key]) return { kind: 'warp', warp: map.warps[key], x: t.x, y: t.y };
        if (map.signs && map.signs[key]) return { kind: 'sign', text: map.signs[key], x: t.x, y: t.y };
        const tile = tileAt(map, t.x, t.y);
        if (tile.face) return { kind: tile.face, tile: tile, x: t.x, y: t.y };
        return { kind: 'nothing', tile: tile, x: t.x, y: t.y };
    }

    // ---------- drawing ----------
    function drawMap(ctx, map, cam, view, sprites) {
        const x0 = Math.floor(cam.x / TILE), y0 = Math.floor(cam.y / TILE);
        const cols = Math.ceil(view.w / TILE) + 1, rows = Math.ceil(view.h / TILE) + 1;
        for (let ty = y0; ty < y0 + rows; ty++) {
            for (let tx = x0; tx < x0 + cols; tx++) {
                const t = tileAt(map, tx, ty);
                const sx = tx * TILE - cam.x, sy = ty * TILE - cam.y;
                sprites.draw(ctx, t.sprite, sx, sy);
                if (t.overlay === 'boat') drawBoat(ctx, sx, sy);
                if (t.overlay === 'bunk') drawBunk(ctx, sx, sy);
            }
        }
    }
    function drawBoat(ctx, x, y) {
        ctx.fillStyle = '#3a3026'; ctx.fillRect(x + 1, y + 6, 14, 7);
        ctx.fillStyle = '#5a4a38'; ctx.fillRect(x + 2, y + 7, 12, 4);
        ctx.fillStyle = '#0d0f12'; ctx.fillRect(x + 7, y + 1, 2, 6);
        ctx.fillStyle = '#d8d2c2'; ctx.fillRect(x + 9, y + 2, 4, 4);
    }
    function drawBunk(ctx, x, y) {
        ctx.fillStyle = '#3a3026'; ctx.fillRect(x + 1, y + 4, 14, 10);
        ctx.fillStyle = '#57606b'; ctx.fillRect(x + 2, y + 5, 12, 5);
        ctx.fillStyle = '#c8a882'; ctx.fillRect(x + 3, y + 6, 4, 3);
    }

    return {
        TILE: TILE, TILES: TILES, MAPS: MAPS, REALM_MAP: REALM_MAP, DIRS: DIRS,
        mapById: mapById, tileChar: tileChar, tileAt: tileAt, npcAt: npcAt,
        walkable: walkable, ahead: ahead, facing: facing, drawMap: drawMap
    };
})();
