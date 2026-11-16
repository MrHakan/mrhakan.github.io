// A stale browser run must not hold the Pages concurrency group for hours.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const checkTimeouts = source => {
    const jobs = source.split(/^jobs:\s*$/m)[1];
    assert.ok(jobs, 'the reusable verification workflow has jobs');
    let checks = 0;
    for (const name of ['games', 'browser']) {
        const block = jobs.match(new RegExp('^    ' + name + ':\\s*\\n([\\s\\S]*?)(?=^    [\\w-]+:|(?![\\s\\S]))', 'm'))?.[1];
        assert.ok(block, name + ': job exists');
        const limit = block.match(/^        timeout-minutes:\s*(\d+)\s*$/m);
        assert.ok(limit, name + ': job needs an explicit timeout');
        assert.ok(+limit[1] >= 15 && +limit[1] <= 60, name + ': timeout must fit a real suite, but never exceed an hour');
        checks++;
    }
    // A single hanging game should stop sooner than the entire browser job's limit.
    const wizardz = source.match(/^            - name: Play wizardz[ \t]*\n([\s\S]*?)(?=^            - name:|(?![\s\S]))/m)?.[1];
    assert.ok(wizardz, 'the Wizardz browser integration step exists');
    assert.match(wizardz, /^              timeout-minutes:[ \t]*15[ \t]*$/m, 'Wizardz must stop within 15 minutes instead of pinning the deployment queue');
    return checks + 1;
};
const source = fs.readFileSync('.github/workflows/games-ci.yml', 'utf8');
let checks = checkTimeouts(source);
// A commented key or a shell-block line does not set a step timeout.
for (const replacement of ['              # timeout-minutes: 15', '                  timeout-minutes: 15']) {
    const fixture = source.replace(/^              timeout-minutes: 15$/m, replacement);
    assert.notEqual(fixture, source, 'negative fixture changes the real Wizardz setting');
    assert.throws(() => checkTimeouts(fixture), /Wizardz must stop within 15 minutes/);
    checks++;
}
console.log(`${checks} workflow timeout contracts passed.`);
