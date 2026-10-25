// Development-only dependency: npm install linkedom.
const {parseHTML}=require('linkedom');
const {readFileSync}=require('node:fs');
const vm=require('node:vm'),assert=require('node:assert/strict');
const {window,document}=parseHTML('<html><body><main></main></body></html>');
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);},configurable:true});
const ctx=vm.createContext({document,console,setTimeout,Blob,URL,globalThis:null});ctx.globalThis=ctx;
const mock=`const app={registerExtension(e){globalThis.extension=e;}};
class FakeNode{
 constructor(){this.widgets=[{name:'polygon',value:'{"loras":[],"global":[],"overrides":{}}'},{name:'lora_catalog',value:'a',options:{values:['a','b','c','d','e','f']}},{name:'architecture',value:'Anima'}];this.size=[480,1000];}
 addDOMWidget(n,t,root){document.querySelector('main').appendChild(root);}setDirtyCanvas(){}setSize(s){this.size=s;}
}`;
const src=['web/polygon_math.js','web/anima_native_presets.js','web/polygon_merge.js'].map(p=>readFileSync(p,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n');
vm.runInContext(mock+src+`\nextension.beforeRegisterNodeDef(FakeNode,{name:'PolygonLoraMerge'});globalThis.node=new FakeNode();node.onNodeCreated();`,ctx);
const json=()=>JSON.parse(ctx.node.widgets[0].value);
const click=(name,index=0)=>[...document.querySelectorAll('button')].filter(b=>b.textContent===name)[index].onclick({preventDefault(){}});
const target=()=>[...document.querySelectorAll('select')].find(s=>[...s.querySelectorAll('option')].some(o=>o.value==='GLOBAL'));
const element=()=>[...document.querySelectorAll('select')].find(s=>[...s.querySelectorAll('option')].some(o=>o.value==='ff.net.0'));
assert.equal(json().loras.length,3);
click('均等配合');
click('＋ LoRAを追加');assert.deepEqual(json().loras,['a','b','c','d']);assert.equal(json().global[3],0);
assert.equal(document.querySelectorAll('svg polygon')[0].getAttribute('points').split(' ').length,4);
click('＋ LoRAを追加');assert.equal(json().loras.length,5);
click('均等配合');assert.ok(json().global.every(w=>Math.abs(w-.2)<1e-10));
let t=target(),e=element();t.value='B03';e.value='ff';t.onchange();
click('100%',4);assert.deepEqual(json().overrides.B03.ff,[0,0,0,0,1]);
click('＋ LoRAを追加');assert.deepEqual(json().overrides.B03.ff,[0,0,0,0,1,0]);
click('削除',4);assert.equal(json().loras.length,5);assert.deepEqual(json().overrides.B03.ff,[1,0,0,0,0]);
click('上書きを解除');assert.equal(json().overrides.B03,undefined);
const preset=[...document.querySelectorAll('select')].find(s=>[...s.querySelectorAll('option')].some(o=>o.value==='ANIMA_PAINT_TRANSFER'));
preset.value='ANIMA_PAINT_TRANSFER';preset.onchange();assert.equal(json().overrides.B03.ff.length,5);assert.equal(json().overrides.B03.ff[1],.55);
e.value='ff.net.0';e.onchange();assert.equal(document.querySelectorAll('input[type=number]')[1].value,'55.00');
const before=ctx.node.widgets[0].value;ctx.node.onConfigure();assert.equal(ctx.node.widgets[0].value,before);assert.equal(json().loras.length,5);
click('全上書きを解除');assert.deepEqual(json().overrides,{});
while(json().loras.length>1)click('削除',json().loras.length-1);
assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='削除').disabled,true);
console.log('Polygon DOM passed: 3→4→5→6 inputs, source identity/removal, all override resizing, preset inheritance and workflow restore.');
(async()=>{
 const file=document.querySelector('input[type=file]');
 const importData=async data=>{Object.defineProperty(file,'files',{value:[{text:async()=>JSON.stringify(data)}],configurable:true});await file.onchange();};
 await importData({type:'recipe_merge_polygon_preset',version:1,architecture:'Anima',polygon:{loras:['a','b','c','d'],global:[1,2,3,4],overrides:{}}});
 assert.deepEqual(json().loras,['a','b','c','d']);assert.deepEqual(json().global,[.1,.2,.3,.4]);
 await importData({type:'recipe_merge_triangle_preset',version:1,architecture:'Anima',triangle:{global:[1,1,1],overrides:{B03:{ff:[0,0,1]}}}});
 assert.equal(json().loras.length,3);assert.deepEqual(json().overrides.B03.ff,[0,0,1]);
 const valid=ctx.node.widgets[0].value;
 await importData({type:'recipe_merge_polygon_preset',architecture:'Anima',polygon:{loras:['missing'],global:[1],overrides:{}}});
 assert.equal(ctx.node.widgets[0].value,valid);
 const originalCreate=document.createElement.bind(document);
 document.createElement=function(tag){const e=originalCreate(tag);if(tag==='a')e.click=()=>{};return e;};
 ctx.URL={createObjectURL(blob){ctx.exportBlob=blob;return 'blob:test';},revokeObjectURL(){}};
 click('配合JSONを書き出す');
 const exported=JSON.parse(await ctx.exportBlob.text());assert.equal(exported.type,'recipe_merge_polygon_preset');assert.deepEqual(exported.polygon,json());
 console.log('Polygon JSON import/export passed: source names, vector normalization, legacy Triangle import, missing source rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
