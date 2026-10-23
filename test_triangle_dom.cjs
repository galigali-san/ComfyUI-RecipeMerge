// Optional UI event test: npm install linkedom (development dependency only).
const {parseHTML}=require('linkedom');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {window,document}=parseHTML('<html><body><main></main></body></html>');
// linkedom omits the select value setter; emulate the browser API used here.
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{
 get(){return this._value ?? this.querySelector('option')?.value ?? '';},
 set(v){this._value=String(v);},configurable:true,
});
const ctx=vm.createContext({document,console,setTimeout,Blob,URL,globalThis:null});ctx.globalThis=ctx;
const mock=`const app={registerExtension(e){globalThis.extension=e;}};
class FakeNode {
 constructor(){this.widgets=[{name:'triangle',value:'{"global":[1,0,0],"overrides":{}}'},{name:'architecture',value:'Anima'}];this.size=[430,800];}
 addDOMWidget(n,t,root){document.querySelector('main').appendChild(root);} setDirtyCanvas(){} setSize(s){this.size=s;}
}`;
const src=['web/triangle_math.js','web/anima_native_presets.js','web/triangle_merge.js'].map(p=>readFileSync(p,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n');
vm.runInContext(mock+src+`\nextension.beforeRegisterNodeDef(FakeNode,{name:'TriangleLoraMerge'});globalThis.node=new FakeNode();node.onNodeCreated();`,ctx);
const buttons=[...document.querySelectorAll('button')];
const click=name=>buttons.find(b=>b.textContent===name).onclick({preventDefault(){}});
const json=()=>JSON.parse(ctx.node.widgets[0].value);
click('均等');assert.ok(json().global.every(v=>Math.abs(v-1/3)<1e-10));
const [block,element,preset]=document.querySelectorAll('select');
block.value='B03';element.value='ff';block.onchange();
click('C 100%');assert.deepEqual(json().overrides.B03.ff,[0,0,1]);
click('上書きを解除');assert.equal(json().overrides.B03,undefined);
preset.value='ANIMA_PAINT_TRANSFER';preset.onchange();assert.ok(Math.abs(json().overrides.B03.ff[1]-.55)<1e-10);
element.value='ff.net.0';element.onchange();assert.equal(document.querySelectorAll('input[type=number]')[1].value,'55.0');
ctx.node.widgets[0].value='{"global":[0,0,1],"overrides":{}}';ctx.node.onConfigure();
assert.equal(document.querySelectorAll('input[type=number]')[2].value,'100.0');
click('全上書きを解除');assert.deepEqual(json().overrides,{});
console.log('Triangle DOM events passed: equal mix, block override/reset, native preset, sub-element inheritance, workflow restore.');
