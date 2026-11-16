// Dependency-free guards for this repo's four-space workflow layout.
// These complement YAML/action validation; they are not a general YAML parser.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('.github/workflows/games-ci.yml', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const groups = ['arena', 'worlds', 'desktop'];
const job = (text, name) => text.match(new RegExp('^    ' + name + ':\\s*\\n([\\s\\S]*?)(?=^    [\\w-]+:|(?![\\s\\S]))', 'm'))?.[1];
const commands = text => [...text.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
    .matchAll(/\bnode ([.\w/-]+\.mjs)(?:[ \t]+(--check))?/g)]
    .map(match => match[1] + (match[2] ? ' ' + match[2] : ''));
const browserCommands = text => commands(text).filter(command => command.startsWith('.github/scripts/browser-'));

const checkTimeouts = text => {
    let checks = 0;
    for (const name of ['games', 'browser']) {
        const block = job(text, name);
        assert.ok(block, name + ': job exists');
        const limit = block.match(/^        timeout-minutes:\s*(\d+)\s*$/m);
        assert.ok(limit, name + ': job needs an explicit timeout');
        assert.ok(+limit[1] >= 15 && +limit[1] <= 30, name + ': grouped job timeout must be between 15 and 30 minutes');
        checks++;
    }
    const wizardz = text.match(/^            - name: Play wizardz[ \t]*\n([\s\S]*?)(?=^            - name:|(?![\s\S]))/m)?.[1];
    assert.ok(wizardz, 'the Wizardz browser integration step exists');
    assert.match(wizardz, /^              timeout-minutes:[ \t]*15[ \t]*$/m, 'Wizardz must stop within 15 minutes instead of pinning the deployment queue');
    return checks + 1;
};

const checkLayout = (text, pages) => {
    assert.doesNotMatch(text, /^    push:/m, 'main verification must run only through the Pages workflow, never twice');
    for (const event of ['pull_request', 'workflow_call', 'workflow_dispatch']) {
        assert.match(text, new RegExp('^    ' + event + ':\\s*$', 'm'), event + ': verification entry point exists');
    }
    const jobs = text.split(/^jobs:[ \t]*$/m)[1];
    assert.ok(jobs, 'verification jobs exist');
    assert.deepEqual([...jobs.matchAll(/^    ([\w-]+):[ \t]*$/gm)].map(match => match[1]), ['games', 'browser'], 'one Node job and one browser matrix, without extra job fan-out');
    const browser = job(text, 'browser');
    assert.deepEqual([...browser.matchAll(/^                ([\w-]+):/gm)].map(match => match[1]), ['group'], 'a single matrix dimension keeps the job count bounded');
    assert.match(browser, /^                group: \[arena, worlds, desktop\]$/m, 'browser coverage must be divided into three bounded groups');
    assert.match(browser, /^            max-parallel: 3$/m, 'at most three browser runners');
    assert.match(browser, /^            fail-fast: false$/m, 'a failing lane must not cancel the other coverage');
    assert.match(browser, /^                  name: screenshots-\$\{\{ matrix.group \}\}$/m, 'matrix artifacts need unique names');
    assert.doesNotMatch(text, /^\s*continue-on-error:/m, 'verification failures must remain blocking');

    const expectedNode = commands(pkg.scripts.test).sort();
    assert.deepEqual(commands(job(text, 'games')).sort(), expectedNode, 'every npm test command must run exactly once');
    // These five CI-only suites are outside the existing local test:browser command.
    const expectedBrowser = [...browserCommands(pkg.scripts['test:browser']),
        ...['playground', 'waveshaper', 'mobile', 'giscus', 'echoes'].map(name => '.github/scripts/browser-' + name + '.mjs')].sort();
    assert.deepEqual(browserCommands(browser).sort(), expectedBrowser, 'every browser script must run exactly once');
    const counts = Object.fromEntries(groups.map(group => [group, 0]));
    for (const step of browser.matchAll(/^            - name: ([^\n]+)\n([\s\S]*?)(?=^            - name:|(?![\s\S]))/gm)) {
        const scripts = browserCommands(step[2]);
        if (!scripts.length) continue;
        const group = step[2].match(/^              if: matrix\.group == '(arena|worlds|desktop)'$/m)?.[1];
        assert.ok(group, step[1] + ': browser test step must select exactly one known group');
        counts[group] += scripts.length;
    }
    assert.ok(groups.every(group => counts[group] > 0), 'every browser group has test coverage');
    assert.match(pages, /^    push:\n        branches: \[main\]$/m, 'Pages owns verification on every main push');
    assert.match(job(pages, 'verify'), /^        uses: \.\/\.github\/workflows\/games-ci\.yml$/m, 'Pages must call the complete reusable verification workflow');
    for (const [name, needs] of [['build', 'verify'], ['deploy', 'build']]) {
        const block = job(pages, name);
        assert.match(block, new RegExp('^        needs: ' + needs + '$', 'm'), name + ': successful verification gates publication');
        assert.doesNotMatch(block, /^        if:/m, name + ': no job condition may bypass its prerequisite');
    }
    assert.match(text, /^    group: games-\$\{\{ github.workflow \}\}-\$\{\{ github.event.pull_request.number \|\| github.ref \}\}$/m, 'verification concurrency must not share the parent Pages group');
    assert.match(text, /^    cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}$/m, 'only superseded PR runs may be cancelled');
    return counts;
};

let checks = checkTimeouts(source);
const counts = checkLayout(source, deploy);
checks++;
for (const replacement of ['              # timeout-minutes: 15', '                  timeout-minutes: 15']) {
    const fixture = source.replace(/^              timeout-minutes: 15$/m, replacement);
    assert.notEqual(fixture, source, 'negative fixture changes the real Wizardz setting');
    assert.throws(() => checkTimeouts(fixture), /Wizardz must stop within 15 minutes/);
    checks++;
}
const brokenLayouts = [
    ['duplicate main trigger', source.replace('on:\n', 'on:\n    push:\n'), deploy, /never twice/],
    ['lost reusable entry', source.replace('    workflow_call:\n', ''), deploy, /workflow_call/],
    ['extra unnamed job', source + '\n    surprise:\n        runs-on: ubuntu-latest\n        steps: []\n', deploy, /without extra job fan-out/],
    ['extra matrix dimension', source.replace('            matrix:\n', '            matrix:\n                os: [one, two]\n'), deploy, /single matrix dimension/],
    ['too many runners', source.replace('max-parallel: 3', 'max-parallel: 20'), deploy, /three browser runners/],
    ['cancel other coverage', source.replace('fail-fast: false', 'fail-fast: true'), deploy, /must not cancel/],
    ['artifact collision', source.replace('name: screenshots-${{ matrix.group }}', 'name: screenshots'), deploy, /unique names/],
    ['missing test', source.replace('node .github/scripts/browser-trailz.mjs', 'true'), deploy, /every browser script/],
    ['duplicate test', source.replace('node .github/scripts/browser-trailz.mjs', 'node .github/scripts/browser-trailz.mjs && node .github/scripts/browser-trailz.mjs'), deploy, /every browser script/],
    ['unknown group', source.replace("if: matrix.group == 'arena'", "if: matrix.group == 'typo'"), deploy, /known group/],
    ['ungrouped test', source.replace("              if: matrix.group == 'arena'\n", ''), deploy, /known group/],
    ['bypass deploy gate', source, deploy.replace('needs: verify', 'needs: []'), /gates publication/],
    ['cancel main verification', source.replace("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: true'), deploy, /only superseded PR/],
];
for (const [name, text, pages, error] of brokenLayouts) {
    assert.ok(text !== source || pages !== deploy, name + ': negative fixture changed the workflow');
    assert.throws(() => checkLayout(text, pages), error, name);
    checks++;
}
console.log(`${checks} workflow contracts passed; browser scripts per group: ${JSON.stringify(counts)}.`);
