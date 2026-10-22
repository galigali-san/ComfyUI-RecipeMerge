import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src = readFileSync(new URL('./web/anima_native_presets.js', import.meta.url), 'utf8');
const {ANIMA_FACTORY} = await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
for (const [name, make] of Object.entries(ANIMA_FACTORY)) {
  const matrix = make();
  const file = JSON.parse(readFileSync(new URL('./presets/anima/'+name+'.json', import.meta.url)));
  assert.deepEqual(file.matrix, matrix, name + ' JSON matches UI');
  assert.equal(Object.keys(matrix).length, 29);
  for (const [block,cells] of Object.entries(matrix)) {
    assert.match(block, /^B(?:0\d|1\d|2[0-7])$|^BASE$/);
    for (const v of Object.values(cells)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  }
}
assert.equal(ANIMA_FACTORY.ANIMA_EARLY().B00.attn1, .75);
assert.equal(ANIMA_FACTORY.ANIMA_EARLY().B27.attn1, .15);
assert.equal(ANIMA_FACTORY.ANIMA_LATE().B27.ff, .75);
console.log('8 native presets validated; UI/JSON match; curve endpoints verified.');
