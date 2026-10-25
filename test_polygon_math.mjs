import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./web/polygon_math.js',import.meta.url),'utf8');
const {polygonWeights,polygonVertices,polygonPointWeights,polygonMarker,editPolygonSources,validatePolygonState}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
for(const n of [1,2,3,4,5,8,20,40]){
 const vertices=polygonVertices(n);
 const center=polygonPointWeights([180,160],n);
 center.forEach(v=>close(v,1/n));
 vertices.forEach((p,i)=>{
  const w=polygonPointWeights(p,n);
  w.forEach((v,j)=>close(v,i===j?1:0));
 });
 if(n>1) {
  const p=vertices[0].map((v,k)=>(v+vertices[1][k])/2),w=polygonPointWeights(p,n);
  close(w[0],.5);close(w[1],.5);
 }
 for(const point of [[180,160],[185,165],[1000,-1000],[0,0]]) {
  const w=polygonPointWeights(point,n);assert.ok(w.every(v=>Number.isFinite(v)&&v>=0));close(w.reduce((a,b)=>a+b,0),1);
  if(n>2&&point[0]>170&&point[0]<190)polygonMarker(w).forEach((v,i)=>close(v,point[i]));
 }
}
let state={loras:['a','b','c'],global:[.2,.3,.5],te:[1,0,0],overrides:{B03:{ff:[0,0,1]}}};
const four=editPolygonSources(state,null,'d');assert.deepEqual(four.global,[.2,.3,.5,0]);assert.deepEqual(four.overrides.B03.ff,[0,0,1,0]);assert.equal(state.loras.length,3);
const removed=editPolygonSources(four,2);assert.deepEqual(removed.loras,['a','b','d']);assert.deepEqual(removed.global,[.4,.6,0]);assert.deepEqual(removed.overrides.B03.ff,[1,0,0]);
assert.deepEqual(validatePolygonState(four),four);
assert.throws(()=>validatePolygonState({...four,global:[1,0,0]}));assert.throws(()=>polygonWeights([0,0,0]));assert.throws(()=>polygonWeights([1,NaN]));
assert.throws(()=>editPolygonSources({loras:['a'],global:[1],overrides:{}},0));
assert.throws(()=>polygonVertices(0));
console.log('Polygon math passed: 1/2/3/4/5/8/20/40 inputs, vertices/edges/center, source add/remove, inheritance vector resizing and validation.');
