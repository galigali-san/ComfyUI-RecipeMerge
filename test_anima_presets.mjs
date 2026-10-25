import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const helper = readFileSync(new URL('./web/anima_presets.js', import.meta.url), 'utf8');
const {adaptPreset} = await import('data:text/javascript;base64,' + Buffer.from(helper).toString('base64'));
const source = readFileSync(new URL('./web/elemental_matrix.js', import.meta.url), 'utf8');
const factoryCode = source.slice(source.indexOf('const IN_BLOCKS'), source.indexOf('// 配布用プリセット'));
const context = vm.createContext({});
vm.runInContext(factoryCode + '\nglobalThis.factory = SD_FACTORY;', context);
for (const [name, make] of Object.entries(context.factory)) {
  const sd = make();
  assert.deepEqual(adaptPreset(sd, false), JSON.parse(JSON.stringify(sd)));
  const anima = adaptPreset(sd, true);
  assert.equal(Object.keys(anima).filter(k => /^B\d\d$/.test(k)).length, 28, name);
  assert.deepEqual(adaptPreset(anima, true), anima, name + ' round-trip');
  assert.ok(!Object.keys(anima).some(k => /^(IN|OUT|M)/.test(k)), name);
}
const flat = adaptPreset(context.factory.FLAT_50(), true);
for (const cell of Object.values(flat)) for (const v of Object.values(cell)) assert.equal(v, .5);
const input = {IN00: {other: 1, 'attn2.to_q': .7}, OUT11: {other: .2}, BASE: {other: .3}};
const mapped = adaptPreset(input, true);
assert.equal(mapped.B00['attn2.to_q'], .7);
assert.equal(mapped.B27.other, .2);
assert.equal(mapped.BASE.other, .3);
assert.deepEqual(adaptPreset(mapped, true), mapped);
assert.throws(() => adaptPreset(mapped, false));
assert.throws(() => adaptPreset({B00:{}, IN00:{}}, true));
assert.deepEqual(adaptPreset({BASE:{other:.4}}, true), {BASE:{other:.4}});
console.log('All Anima preset tests passed (' + Object.keys(context.factory).length + ' factory presets, round-trips, import guards).');
