import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./web/triangle_math.js',import.meta.url),'utf8');
const {normalizeWeights,pointWeights,weightPoint}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
for(const mix of [[1,0,0],[0,1,0],[0,0,1],[1,1,1],[2,3,5]]) {
  const w=normalizeWeights(mix), p=weightPoint(w), back=pointWeights(...p);
  w.forEach((v,i)=>assert.ok(Math.abs(v-back[i])<1e-10));
}
for(const p of [[-200,25],[500,300],[160,-40],[160,800]]) {
  const w=pointWeights(...p);assert.ok(w.every(v=>v>=0&&v<=1));assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10);
}
assert.throws(()=>normalizeWeights([0,0,0]));assert.throws(()=>normalizeWeights([-1,1,1]));
console.log('Triangle coordinates: vertices, edges, center, outside points and normalization passed.');
