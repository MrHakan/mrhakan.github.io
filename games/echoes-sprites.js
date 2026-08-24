/* echoes of the tide — pixel art, drawn in code.
 *
 * The site has no artist and no image pipeline, so every sprite in the
 * game is a list of strings: one character per pixel, looked up in a
 * palette. They are decoded once into offscreen canvases at load and
 * blitted from there, which is fast enough that the overworld never
 * touches the string data again.
 *
 * A palette entry can be overridden per-draw, so one Drowned Reaver
 * silhouette serves a dozen Lords in a dozen coats — which is what the
 * nemesis system is doing conceptually anyway.
 */

window.ECHOES_SPRITES = (function () {
    'use strict';

    // shared palette. '.' is always transparent.
    const PALETTE = {
        '.': null,
        o: '#0d0f12',   // outline
        d: '#26313a',   // dark cloth
        c: '#3d5162',   // cloth
        l: '#5b7488',   // light cloth
        s: '#c8a882',   // skin
        S: '#8d6b4a',   // skin shadow
        g: '#2b4b52',   // glass
        G: '#6fd0c8',   // glass glint
        b: '#1b1f24',   // boots, straps
        r: '#8f3b32',   // rust, blood
        R: '#c4604f',   // rust light
        y: '#c9a227',   // brass, lamp
        Y: '#f0d98a',   // lamp glow
        w: '#d8d2c2',   // bone, white
        W: '#f4f0e4',   // highlight
        m: '#4a3a5e',   // marrow violet
        M: '#8f7ac0',   // marrow bright
        e: '#2f5d3a',   // weed green
        E: '#4f8a56',   // weed light
        t: '#1a2b33',   // deep water
        T: '#26414d',   // water light
        k: '#3a3026',   // timber
        K: '#5a4a38',   // timber light
        n: '#57606b',   // steel
        N: '#8a949f',   // steel light
        p: '#7a2f45',   // flesh
        P: '#b04f60'    // flesh light
    };

    // ---------- decoding ----------
    const cache = {};

    function decode(rows, opts) {
        const o = opts || {};
        const w = Math.max.apply(null, rows.map(r => r.length));
        const h = rows.length;
        const scale = o.scale || 1;
        const cv = document.createElement('canvas');
        cv.width = w * scale;
        cv.height = h * scale;
        const ctx = cv.getContext('2d');
        const palette = o.palette ? Object.assign({}, PALETTE, o.palette) : PALETTE;
        for (let y = 0; y < h; y++) {
            const row = rows[y];
            for (let x = 0; x < row.length; x++) {
                const colour = palette[row[x]];
                if (!colour) continue;
                ctx.fillStyle = colour;
                ctx.fillRect(x * scale, y * scale, scale, scale);
            }
        }
        cv._w = w; cv._h = h;
        return cv;
    }

    // sprites are decoded on first use and kept; a recolour is a separate
    // cache entry keyed by the override
    function sprite(name, opts) {
        const o = opts || {};
        const key = name + '|' + (o.scale || 1) + '|' + (o.palette ? JSON.stringify(o.palette) : '');
        if (cache[key]) return cache[key];
        const rows = ART[name];
        if (!rows) return null;
        const cv = decode(rows, o);
        cache[key] = cv;
        return cv;
    }

    function draw(ctx, name, x, y, opts) {
        const cv = sprite(name, opts);
        if (!cv) return;
        const o = opts || {};
        if (o.flip) {
            ctx.save();
            ctx.translate(Math.round(x) + cv.width, Math.round(y));
            ctx.scale(-1, 1);
            ctx.drawImage(cv, 0, 0);
            ctx.restore();
        } else {
            ctx.drawImage(cv, Math.round(x), Math.round(y));
        }
    }

    // ---------- the art ----------
    const ART = {};

    // --- the diver, 16x18, four ways, two frames each ---
    ART.diver_down_0 = [
        '.....oooooo.....',
        '....odddddo.....',
        '...oddddddddo...',
        '...odgggggggo...',
        '...odgGgggGgo...',
        '...oddddddddo...',
        '....oosssoo.....',
        '...occccccco....',
        '..ocdcccccdco...',
        '..oclcccccclo...',
        '..occccccccco...',
        '..occcccccco....',
        '...occccccco....',
        '....obbbbbo.....',
        '....ob...bo.....',
        '....ob...bo.....',
        '....oo...oo.....',
        '................'
    ];
    ART.diver_down_1 = [
        '.....oooooo.....',
        '....odddddo.....',
        '...oddddddddo...',
        '...odgggggggo...',
        '...odgGgggGgo...',
        '...oddddddddo...',
        '....oosssoo.....',
        '...occccccco....',
        '..ocdcccccdco...',
        '..oclcccccclo...',
        '..occccccccco...',
        '..occcccccco....',
        '...occccccco....',
        '....obbbbbo.....',
        '...obb...bbo....',
        '...ob.....bo....',
        '...oo.....oo....',
        '................'
    ];
    ART.diver_up_0 = [
        '.....oooooo.....',
        '....odddddo.....',
        '...oddddddddo...',
        '...odddddddddo..',
        '...oddyyyyddo...',
        '...oddddddddo...',
        '....ooddddoo....',
        '...occccccco....',
        '..ocdcccccdco...',
        '..occcccccclo...',
        '..occccccccco...',
        '..occcccccco....',
        '...occccccco....',
        '....obbbbbo.....',
        '....ob...bo.....',
        '....ob...bo.....',
        '....oo...oo.....',
        '................'
    ];
    ART.diver_up_1 = [
        '.....oooooo.....',
        '....odddddo.....',
        '...oddddddddo...',
        '...oddddddddo...',
        '...oddyyyyddo...',
        '...oddddddddo...',
        '....ooddddoo....',
        '...occccccco....',
        '..ocdcccccdco...',
        '..occcccccclo...',
        '..occccccccco...',
        '..occcccccco....',
        '...occccccco....',
        '....obbbbbo.....',
        '...obb...bbo....',
        '...ob.....bo....',
        '...oo.....oo....',
        '................'
    ];
    ART.diver_side_0 = [
        '....oooooooo....',
        '...oddddddddo...',
        '..oddddddddddo..',
        '..odggggggggdo..',
        '..odgGgggggGdo..',
        '..oddddddddddo..',
        '...oossssssoo...',
        '..occccccccco...',
        '.ocdcccccccccy..',
        '.oclccccccccco..',
        '.occccccccccco..',
        '..occccccccco...',
        '..occcccccco....',
        '...obbbbbbo.....',
        '...obbbbbo......',
        '...ob..bbo......',
        '...oo..ooo......',
        '................'
    ];
    ART.diver_side_1 = [
        '....oooooooo....',
        '...oddddddddo...',
        '..oddddddddddo..',
        '..odggggggggdo..',
        '..odgGgggggGdo..',
        '..oddddddddddo..',
        '...oossssssoo...',
        '..occccccccco...',
        '.ocdcccccccccy..',
        '.oclccccccccco..',
        '.occccccccccco..',
        '..occccccccco...',
        '..occcccccco....',
        '...obbbbbbo.....',
        '..obb...bbbo....',
        '..ob......bo....',
        '..oo......oo....',
        '................'
    ];

    // --- the diver from behind, for the battle screen, 24x28 ---
    ART.diver_back = [
        '........oooooooo........',
        '.......oddddddddo.......',
        '......odddddddddddo.....',
        '.....oddddddddddddddo...',
        '.....oddddyyyyyydddo....',
        '.....oddddyYYYYydddo....',
        '.....odddddddddddddo....',
        '......ooddddddddoo......',
        '.....occcccccccccco.....',
        '....ocdccccccccccdco....',
        '...occdcccccccccdcco....',
        '...oclccccccccccclco....',
        '...occccccccccccccco....',
        '...occccccccccccccco....',
        '...occdcccccccccdcco....',
        '...occcccccccccccco.....',
        '....occcccccccccco......',
        '....occccccccccco.......',
        '.....obbbbbbbbbo........',
        '.....obbbbbbbbo.........',
        '.....ob......bo.........',
        '.....ob......bo.........',
        '.....obb....bbo.........',
        '.....obb....bbo.........',
        '....obbo....obbo........',
        '....oooo....oooo........',
        '........................',
        '........................'
    ];

    // --- creature archetypes, 28x28, tintable through 'c' and 'p' ---
    ART.arch_humanoid = [
        '..........oooooo............',
        '.........odddddo............',
        '........oddddddddo..........',
        '........odgggggggo..........',
        '........odgGgggGgo..........',
        '........oddddddddo..........',
        '.........oosssoo............',
        '.......occccccccco..........',
        '......ocdcccccccdco.........',
        '.....occdccccccccdco........',
        '.....occccccccccccco........',
        '.....occcccccccccco.........',
        '.....occcccccccccco.........',
        '......occcccccccco..........',
        '......occcccccccco..........',
        '......occcccccccco..........',
        '.......obbbbbbbbo...........',
        '.......obbbbbbbo............',
        '.......ob....bo.............',
        '.......ob....bo.............',
        '.......obb..bbo.............',
        '.......obb..bbo.............',
        '......obbo..obbo............',
        '......oooo..oooo............',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_crab = [
        '............................',
        '..oo....................oo..',
        '.oNNo..................oNNo.',
        'oNNNNo................oNNNNo',
        'oNNNNNo..............oNNNNNo',
        'oNNooNNo............oNNooNNo',
        '.oo..oNNo..........oNNo..oo.',
        '......oNNo........oNNo......',
        '.......oNNoooooooooNNo......',
        '........oNccccccccccNo......',
        '.......occcccccccccccco.....',
        '......occcccccccccccccco....',
        '.....occcccWWccccWWccccco...',
        '.....occccWWWWccWWWWccccco..',
        '....occcccWWccccccWWcccccco.',
        '....occccppppppppppppcccco..',
        '....occcppPPPPPPPPPPppcccco.',
        '....occcpPPPPPPPPPPPPpcccco.',
        '.....occcppPPPPPPPPppccccco.',
        '.....occcccppppppppcccccco..',
        '......occccccccccccccccco...',
        '.......ooccccccccccccccoo...',
        '.........oooooooooooooo.....',
        '.......o...o...o...o...o....',
        '......oNo.oNo.oNo.oNo.oNo...',
        '......ooo.ooo.ooo.ooo.ooo...',
        '............................',
        '............................'
    ];
    ART.arch_swarm = [
        '............................',
        '.......ooo..........ooo.....',
        '......orrro........orrro....',
        '.....orRRRro......orRRRro...',
        '....oo.oRo.oo....oo.oRo.oo..',
        '...o....o....o..o....o....o.',
        '............................',
        '............................',
        '...........ooo..............',
        '..........orrro.............',
        '.........orRRRro............',
        '........oo.oRo.oo...........',
        '.......o....o....o..........',
        '............................',
        '.....ooo..............ooo...',
        '....orrro............orrro..',
        '...orRRRro..........orRRRro.',
        '..oo.oRo.oo........oo.oRo.oo',
        '.o....o....o......o....o....',
        '............................',
        '..............ooo...........',
        '.............orrro..........',
        '............orRRRro.........',
        '...........oo.oRo.oo........',
        '..........o....o....o.......',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_wraith = [
        '..........oooo..............',
        '........oommmmoo............',
        '.......omMMMMMMmo...........',
        '......omMMwwwwMMmo..........',
        '......omMwWWWWwMmo..........',
        '......omMMwwwwMMmo..........',
        '.......ommMMMMmmo...........',
        '......ommmMMMMmmmo..........',
        '.....ommmmMMMMmmmmo.........',
        '....ommmmmMMMMmmmmmo........',
        '....ommmmmmMMmmmmmmo........',
        '....ommmmmmmmmmmmmmo........',
        '.....ommmmmmmmmmmmo.........',
        '.....ommmmmmmmmmmo..........',
        '......ommmmmmmmmo...........',
        '.......ommmmmmmo............',
        '........ommmmmo.............',
        '.........ommmo..............',
        '..........omo...............',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_hulk = [
        '.........oooooooo...........',
        '........oddddddddo..........',
        '.......oddddddddddo.........',
        '.......odgggggggggo.........',
        '.......odgGggggGggo.........',
        '.......oddddddddddo.........',
        '......ooowwwwwwwooo.........',
        '....occcccccccccccco........',
        '...occcccccccccccccco.......',
        '..occdcccccccccccccdco......',
        '..occdcccccccccccccdco......',
        '..occcccccccccccccccco......',
        '..occcwwwwwwwwwwccccco......',
        '..occcwwwwwwwwwwccccco......',
        '..occcccccccccccccccco......',
        '...occcccccccccccccco.......',
        '...occcccccccccccccco.......',
        '....obbbbbbbbbbbbbbo........',
        '....obbbbbbbbbbbbbo.........',
        '....obb.......bbbo..........',
        '....obb........bbo..........',
        '...obbbo......obbbo.........',
        '...ooooo......ooooo.........',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_machine = [
        '.....oooooooooooooooo.......',
        '.....oNNNNNNNNNNNNNNo.......',
        '.....oNnnnnnnnnnnnnNo.......',
        '.....oNnrrRRrrRRrrnNo.......',
        '.....oNnrRYYRrRYYRrnNo......',
        '.....oNnrrRRrrRRrrnNo.......',
        '.....oNnnnnnnnnnnnnNo.......',
        '.....ooNNNNNNNNNNNNoo.......',
        '..ooooonnnnnnnnnnnnooooo....',
        '..oNNNonnnnnnnnnnnnoNNNo....',
        '..oNNNonnyyyyyyyynnoNNNo....',
        '..oNNNonnyYYYYYYynnoNNNo....',
        '..ooooonnyyyyyyyynnooooo....',
        '....o..onnnnnnnnnnno..o.....',
        '....o..oonnnnnnnnnoo..o.....',
        '.......ooonnnnnnnooo........',
        '.......oNNoonnnooNNo........',
        '.......oNNo.ooo.oNNo........',
        '.......oNNo.....oNNo........',
        '.......ooo.......ooo........',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_fish = [
        '............................',
        '............................',
        '..........oooo..............',
        '........oocccco.............',
        '.......occccccco............',
        '......occcccccco............',
        '.....occcppppccco...........',
        '....occcpPPPPpcccooooooooooo',
        '...occcpPwwwwPpccccccccccccc',
        '...occpPwWWWWwPpcccccccccccc',
        '...occpPwWWWWwPpcccccccccccc',
        '...occcpPwwwwPpccccccccccccc',
        '....occcpPPPPpcccooooooooooo',
        '.....occcppppccco...........',
        '......occcccccco............',
        '.......occccccco............',
        '........oocccco.............',
        '..........oooo..............',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_choir = [
        '............................',
        '..oooo......oooo......oooo..',
        '.ommmmo....ommmmo....ommmmo.',
        'ommMMMMo..ommMMMMo..ommMMMMo',
        'ommMwwMo..ommMwwMo..ommMwwMo',
        'ommMWWMo..ommMWWMo..ommMWWMo',
        'ommMwwMo..ommMwwMo..ommMwwMo',
        'ommmmmmo..ommmmmmo..ommmmmmo',
        '.ommmmo....ommmmo....ommmmo.',
        '..oooo......oooo......oooo..',
        '....oooo......oooo......oo..',
        '...ommmmo....ommmmo....omm..',
        '..ommMMMMo..ommMMMMo..ommM..',
        '..ommMwwMo..ommMwwMo..ommM..',
        '..ommMWWMo..ommMWWMo..ommM..',
        '..ommMwwMo..ommMwwMo..ommM..',
        '..ommmmmmo..ommmmmmo..ommm..',
        '...ommmmo....ommmmo....omm..',
        '....oooo......oooo......oo..',
        '..oooooooooooooooooooooooooo',
        '.ommmmmmmmmmmmmmmmmmmmmmmmmo',
        '.ommmmmmmmmmmmmmmmmmmmmmmmmo',
        '..ooooooooooooooooooooooooo.',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];
    ART.arch_leech = [
        '............................',
        '............................',
        '..........oooooo............',
        '........oopPPPPpoo..........',
        '.......opPwwwwwwPpo.........',
        '......opPwWWWWWWwPpo........',
        '......opPwWooooWwPpo........',
        '......opPwWooooWwPpo........',
        '......opPwWWWWWWwPpo........',
        '.......opPwwwwwwPpo.........',
        '........oopPPPPpoo..........',
        '.........opPPPPpo...........',
        '.........opPPPPpo...........',
        '..........opPPpo............',
        '..........opPPpo............',
        '...........oppo.............',
        '..........opPPpo............',
        '..........opPPpo............',
        '...........oppo.............',
        '..........opPPpo............',
        '...........oppo.............',
        '...........oppo.............',
        '............oo..............',
        '............................',
        '............................',
        '............................',
        '............................',
        '............................'
    ];

    // --- overworld tiles, 16x16 ---
    ART.tile_deck = [
        'oooooooooooooooo',
        'KKKKKKKKKKKKKKKK',
        'KkkkkkkkkkkkkkkK',
        'KkkkKkkkkkkKkkkK',
        'KkkkkkkkkkkkkkkK',
        'oooooooooooooooo',
        'KKKKKKKKKKKKKKKK',
        'KkkkkkkkkkkkkkkK',
        'KkkKkkkkkkkkKkkK',
        'KkkkkkkkkkkkkkkK',
        'oooooooooooooooo',
        'KKKKKKKKKKKKKKKK',
        'KkkkkkkkkkkkkkkK',
        'KkkkkKkkkkKkkkkK',
        'KkkkkkkkkkkkkkkK',
        'oooooooooooooooo'
    ];
    ART.tile_plate = [
        'nnnnnnnnnnnnnnnn',
        'nNNNNNNNNNNNNNNn',
        'nNnnnnnnnnnnnnNn',
        'nNnrrnnnnnnrrnNn',
        'nNnrRnnnnnnRrnNn',
        'nNnnnnnnnnnnnnNn',
        'nNnnnnnnnnnnnnNn',
        'nNnnnnrrrrnnnnNn',
        'nNnnnnrRRrnnnnNn',
        'nNnnnnnnnnnnnnNn',
        'nNnnnnnnnnnnnnNn',
        'nNnrrnnnnnnrrnNn',
        'nNnrRnnnnnnRrnNn',
        'nNnnnnnnnnnnnnNn',
        'nNNNNNNNNNNNNNNn',
        'nnnnnnnnnnnnnnnn'
    ];
    ART.tile_water = [
        'tttttttttttttttt',
        'tttttTTttttttttt',
        'ttttTTTTtttttttt',
        'tttttTTtttttTTtt',
        'ttttttttttttTTTt',
        'ttttttttttttTTtt',
        'ttTTtttttttttttt',
        'tTTTTttttttttttt',
        'ttTTtttttttTTttt',
        'tttttttttttTTTtt',
        'ttttttttttttTTtt',
        'ttttttTTtttttttt',
        'tttttTTTTttttttt',
        'ttttttTTtttttttt',
        'tttttttttttttttt',
        'tttttttttttttttt'
    ];
    ART.tile_kelp = [
        'KKKKKKKKKKKKKKKK',
        'KkkeekkkkkkeekkK',
        'KkeEEekkkkeEEekK',
        'KkeEEekkkkeEEekK',
        'KkeEEeekkeeEEekK',
        'KkkeEEeeeeEEekkK',
        'KkkkeEEEEEEekkkK',
        'KkkkkeEEEEekkkkK',
        'KkeekkeEEekkeekK',
        'KeEEekkeEekkeEEk',
        'KeEEeekkeekkeEEk',
        'KkeEEEekkkeEEEkK',
        'KkkeEEEeeeEEEkkK',
        'KkkkeEEEEEEekkkK',
        'KkkkkkeEEekkkkkK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_rail = [
        'KKKKKKKKKKKKKKKK',
        'KkkkkkkkkkkkkkkK',
        'nnnnnnnnnnnnnnnn',
        'NNNNNNNNNNNNNNNN',
        'nnnnnnnnnnnnnnnn',
        'Kkkn.......nkkkK',
        'Kkkn.......nkkkK',
        'nnnnnnnnnnnnnnnn',
        'NNNNNNNNNNNNNNNN',
        'nnnnnnnnnnnnnnnn',
        'Kkkn.......nkkkK',
        'Kkkn.......nkkkK',
        'KkknkkkkkkknkkkK',
        'KkknkkkkkkknkkkK',
        'KkkkkkkkkkkkkkkK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_crate = [
        'oooooooooooooooo',
        'oKKKKKKKKKKKKKKo',
        'oKkkkkkkkkkkkkKo',
        'oKkKKKKKKKKKKkKo',
        'oKkKkkkkkkkkKkKo',
        'oKkKkKKKKKKkKkKo',
        'oKkKkKkkkkKkKkKo',
        'oKkKkKkKKkKkKkKo',
        'oKkKkKkKKkKkKkKo',
        'oKkKkKkkkkKkKkKo',
        'oKkKkKKKKKKkKkKo',
        'oKkKkkkkkkkkKkKo',
        'oKkKKKKKKKKKKkKo',
        'oKkkkkkkkkkkkkKo',
        'oKKKKKKKKKKKKKKo',
        'oooooooooooooooo'
    ];
    ART.tile_wall = [
        'oooooooooooooooo',
        'onnnnnnnnnnnnnno',
        'onNNNNnnNNNNNNno',
        'onNnnnnnnnnnnNno',
        'onNnrrnnnnrrnNno',
        'onNnnnnnnnnnnNno',
        'onnnnnnnnnnnnnno',
        'oNNNNNNNNNNNNNNo',
        'onnnnnnnnnnnnnno',
        'onNnnnnnnnnnnNno',
        'onNnnrrnnrrnnNno',
        'onNnnnnnnnnnnNno',
        'onNNNNNNNNNNNNno',
        'onnnnnnnnnnnnnno',
        'onnnnnnnnnnnnnno',
        'oooooooooooooooo'
    ];
    ART.tile_door = [
        'oooooooooooooooo',
        'oKKKKKKKKKKKKKKo',
        'oKoooooooooooKKo',
        'oKokkkkkkkkkkoKo',
        'oKokKKKKKKKKkoKo',
        'oKokKkkkkkkKkoKo',
        'oKokKkkkkkkKkoKo',
        'oKokKkkkkkkKkoKo',
        'oKokKkkkkyyKkoKo',
        'oKokKkkkkyYKkoKo',
        'oKokKkkkkkkKkoKo',
        'oKokKkkkkkkKkoKo',
        'oKokKKKKKKKKkoKo',
        'oKokkkkkkkkkkoKo',
        'oKoooooooooooKKo',
        'oooooooooooooooo'
    ];
    ART.tile_anvil = [
        'KKKKKKKKKKKKKKKK',
        'KkkkkkkkkkkkkkkK',
        'Kkkkoooooooookkk',
        'KkkonnnnnnnnokkK',
        'KkkoNNNNNNNNokkK',
        'KkkonnnnnnnnokkK',
        'Kkkkoonnnnookkkk',
        'Kkkkkkonnokkkkkk',
        'Kkkkkkonnokkkkkk',
        'Kkkkkonnnnokkkkk',
        'KkkkonnnnnnokkkK',
        'KkkonnnnnnnnokkK',
        'KkkoNNNNNNNNokkK',
        'Kkkoooooooooookk',
        'KkkkkkkkkkkkkkkK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_forge = [
        'oooooooooooooooo',
        'onnnnnnnnnnnnnno',
        'onNNNNNNNNNNNNno',
        'onnnnnnnnnnnnnno',
        'onnorrrrrrrronno',
        'onnorRRRRRRronno',
        'onnorRYYYYRronno',
        'onnorRYWWYRronno',
        'onnorRYYYYRronno',
        'onnorRRRRRRronno',
        'onnorrrrrrrronno',
        'onnnnnnnnnnnnnno',
        'onNNNNNNNNNNNNno',
        'onnnnnnnnnnnnnno',
        'onnnnnnnnnnnnnno',
        'oooooooooooooooo'
    ];
    ART.tile_stair = [
        'KKKKKKKKKKKKKKKK',
        'Kooooooooooooook',
        'KonnnnnnnnnnnnoK',
        'KoNNNNNNNNNNNNoK',
        'Kooooooooooooook',
        'KKKonnnnnnnnnnoK',
        'KKKoNNNNNNNNNNoK',
        'KKKooooooooooook',
        'KKKKKKonnnnnnnoK',
        'KKKKKKoNNNNNNNoK',
        'KKKKKKoooooooook',
        'KKKKKKKKKonnnnoK',
        'KKKKKKKKKoNNNNoK',
        'KKKKKKKKKooooook',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_slick = [
        'KKKKKKKKKKKKKKKK',
        'KkkkmmmkkkkkkkkK',
        'KkkmMMMmkkkmmkkK',
        'KkmMMMMMmkkmMmkK',
        'KkmMMMMMmkmMMmkK',
        'KkkmMMMmkkmMMmkK',
        'KkkkmmmkkkkmmkkK',
        'KkkkkkkkkkkkkkkK',
        'KkkmmkkkkmmmkkkK',
        'KkmMMmkkmMMMmkkK',
        'KkmMMmkmMMMMMmkK',
        'KkkmmkkmMMMMMmkK',
        'KkkkkkkkmMMMmkkK',
        'KkkkkkkkkmmmkkkK',
        'KkkkkkkkkkkkkkkK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_lamp = [
        'KKKKKKKKKKKKKKKK',
        'KkkkkkooookkkkkK',
        'KkkkkoyyyyokkkkK',
        'KkkkoyYYYYYokkkK',
        'KkkoyYWWWWYyokkK',
        'KkkoyYWWWWYyokkK',
        'KkkkoyYYYYYokkkK',
        'KkkkkoyyyyokkkkK',
        'KkkkkkonnokkkkkK',
        'KkkkkkonnokkkkkK',
        'KkkkkkonnokkkkkK',
        'KkkkkkonnokkkkkK',
        'KkkkkonnnnokkkkK',
        'KkkkonnnnnnokkkK',
        'KkkkoooooooookkK',
        'KKKKKKKKKKKKKKKK'
    ];
    ART.tile_stone = [
        'oooooooooooooooo',
        'oNNnnNNNnnNNnnNo',
        'oNnnnnNnnnnNnnno',
        'onnnNNnnnNNnnNNo',
        'onNNnnnNNnnnNNno',
        'onnnnNNnnnNNnnno',
        'oNNnnnnnNnnnnNNo',
        'onnnNNNnnnNNNnno',
        'onNnnnnNNnnnnnNo',
        'onnnNNnnnnNNnnno',
        'oNNnnnnNNNnnnNNo',
        'onnnNNNnnnnNNnno',
        'onNnnnnnNNnnnnNo',
        'onnnNNNnnnnNnnno',
        'oNNnnnnnNNNnnNNo',
        'oooooooooooooooo'
    ];

    // --- dungeon tiles and the things standing in the rooms, 16x16 ---
    ART.tile_dungeon = [
        'Nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnNnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnrnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnNnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnNnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn'
    ];
    ART.tile_hauler = [
        'tttttttttttttttt',
        'tttttttoottttttt',
        'ttttttoWWotttttt',
        'ttttttoWWotttttt',
        'tttttoooooottttt',
        'ttttokkkkkkotttt',
        'tttokKKKKKKkottt',
        'ttokKKKKKKKKkott',
        'tokKKKKKKKKKKkot',
        'okkkkkkkkkkkkkko',
        'okKKKKKKKKKKKKko',
        'oooooooooooooooo',
        'tttttttttttttttt',
        'tTttttttttttttTt',
        'tttttttttttttttt',
        'tttttttttttttttt'
    ];
    ART.tile_bulkhead = [
        'oooooooooooooooo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'oooooooooooooooo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'obbbbbbbobbbbbbo',
        'oooooooooooooooo'
    ];
    ART.tile_hatch = [
        'oooooooooooooooo',
        'onnnnnnnnnnnnnno',
        'onNNNNNNNNNNNNno',
        'onNrRnnnnnnRrNno',
        'onNnrRnnnnRrnNno',
        'onNnnrRnnRrnnNno',
        'onNnnnrRRrnnnNno',
        'onNnnnnRRnnnnNno',
        'onNnnnnRRnnnnNno',
        'onNnnnrRRrnnnNno',
        'onNnnrRnnRrnnNno',
        'onNnrRnnnnRrnNno',
        'onNrRnnnnnnRrNno',
        'onNNNNNNNNNNNNno',
        'onnnnnnnnnnnnnno',
        'oooooooooooooooo'
    ];
    ART.tile_descend = [
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn',
        'nnoooooooooooonn',
        'nnoooooooooooonn',
        'nnoNNNNNNNNNNonn',
        'nnoooooooooooonn',
        'nnoooooooooooonn',
        'nnoNNNNNNNNNNonn',
        'nnoooooooooooonn',
        'nnoooooooooooonn',
        'nnoNNNNNNNNNNonn',
        'nnoooooooooooonn',
        'nnoooooooooooonn',
        'nnoooooooooooonn',
        'nnnnnnnnnnnnnnnn',
        'nnnnnnnnnnnnnnnn'
    ];
    ART.tile_lift = [
        'nnnnnnnnnnnnnnnn',
        'nyyyyyyyyyyyyyyn',
        'nyooooooooooooyn',
        'nyoNooNooNooNoyn',
        'nyoNooNooNooNoyn',
        'nyoNooNooNooNoyn',
        'nyooooooooooooyn',
        'nyoYYYYYYYYYYoyn',
        'nyoYYYYYYYYYYoyn',
        'nyooooooooooooyn',
        'nyoNooNooNooNoyn',
        'nyoNooNooNooNoyn',
        'nyoNooNooNooNoyn',
        'nyooooooooooooyn',
        'nyyyyyyyyyyyyyyn',
        'nnnnnnnnnnnnnnnn'
    ];
    ART.prop_wreck = [
        '................',
        '....o......o....',
        '...oWo....oWo...',
        '..ooKoo..ooKoo..',
        '.oKKKKKooKKKKKo.',
        'oKKyyKKooKKyyKKo',
        'oKKyyKKooKKyyKKo',
        'oKKKKKKooKKKKKKo',
        'oKKKKKKooKKKKKKo',
        'oooooooooooooooo',
        'oWWWWWWWWWWWWWWo',
        'oyKKKKKKKKKKKKyo',
        'oyKKyyKKKKyyKKyo',
        'oyKKKKKKKKKKKKyo',
        'oooooooooooooooo',
        '................'
    ];
    ART.prop_shrine = [
        '................',
        '.......oo.......',
        '......oMMo......',
        '.....oMMMMo.....',
        '.....oMmmMo.....',
        '....oMmWWmMo....',
        '....oMmWWmMo....',
        '.....oMmmMo.....',
        '.....oMMMMo.....',
        '......oMMo......',
        '.......oo.......',
        '......oooo......',
        '.....okkkko.....',
        '....okKKKKko....',
        '....oooooooo....',
        '................'
    ];
    ART.prop_bunk = [
        '................',
        '................',
        '..oooooooooooo..',
        '..okkkkkkkkkko..',
        '..okwwwwwwwwko..',
        '..okwWWWWWWwko..',
        '..okwwwwwwwwko..',
        '..okKKKKKKKKko..',
        '..okkkkkkkkkko..',
        '..oooooooooooo..',
        '..o.o......o.o..',
        '..o.o......o.o..',
        '................',
        '................',
        '................',
        '................'
    ];

    // --- overworld people, 16x18 ---
    ART.npc_smith = [
        '.....oooooo.....',
        '....orrrrrro....',
        '...orrrrrrrro...',
        '...osssssssso...',
        '...osSssssSso...',
        '...osssssssso...',
        '....oossssoo....',
        '...orrrrrrrro...',
        '..orRrrrrrrRro..',
        '..orrrrrrrrrro..',
        '..orrrrrrrrrro..',
        '..orrrrrrrrro...',
        '...orrrrrrrro...',
        '....obbbbbbo....',
        '....ob....bo....',
        '....ob....bo....',
        '....oo....oo....',
        '................'
    ];
    ART.npc_dredger = [
        '.....oooooo.....',
        '....ommmmmmo....',
        '...ommmmmmmmo...',
        '...omMmmmmMmo...',
        '...ommmmmmmmo...',
        '...ommwwwwmmo...',
        '....oommmmoo....',
        '...ommmmmmmmo...',
        '..ommMmmmmMmmo..',
        '..ommmmmmmmmmo..',
        '..ommmmmmmmmmo..',
        '..ommmmmmmmmo...',
        '...ommmmmmmmo...',
        '....obbbbbbo....',
        '....ob....bo....',
        '....ob....bo....',
        '....oo....oo....',
        '................'
    ];
    ART.npc_inquisitor = [
        '.....oooooo.....',
        '....oyyyyyyo....',
        '...oyYYYYYYyo...',
        '...oyyoooooyo...',
        '...oyorrrroyo...',
        '...oyyoooooyo...',
        '....ooyyyyoo....',
        '...owwwwwwwwo...',
        '..owWwwwwwwWwo..',
        '..owwwwwwwwwwo..',
        '..owwrrrrrrwwo..',
        '..owwwwwwwwwo...',
        '...owwwwwwwwo...',
        '....obbbbbbo....',
        '....ob....bo....',
        '....ob....bo....',
        '....oo....oo....',
        '................'
    ];

    // every archetype the bestiary can point at
    const ARCHETYPES = ['arch_humanoid', 'arch_crab', 'arch_swarm', 'arch_wraith',
        'arch_hulk', 'arch_machine', 'arch_fish', 'arch_choir', 'arch_leech'];

    return {
        PALETTE: PALETTE,
        ART: ART,
        ARCHETYPES: ARCHETYPES,
        sprite: sprite,
        draw: draw,
        decode: decode,
        names: () => Object.keys(ART)
    };
})();
