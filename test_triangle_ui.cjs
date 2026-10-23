// Optional browser smoke test: npm-installed playwright + Chromium required.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:700,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><body style="background:#141820"><main style="width:460px"></main></body></html>');
  const mock=`
   const app={registerExtension(ext){globalThis.extension=ext;}};
   class FakeNode{
    constructor(){this.widgets=[{name:'triangle',value:'{"global":[1,0,0],"overrides":{}}'},{name:'architecture',value:'Anima'}];this.size=[430,800];}
    addDOMWidget(n,t,root){document.querySelector('main').append(root);}
    setDirtyCanvas(){} setSize(s){this.size=s;}
   }
  `;
  const source=['web/triangle_math.js','web/anima_native_presets.js','web/triangle_merge.js'].map(p=>readFileSync(p,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n');
  await page.addScriptTag({content:mock+source+`\nextension.beforeRegisterNodeDef(FakeNode,{name:'TriangleLoraMerge'});globalThis.node=new FakeNode();node.onNodeCreated();`});
  const json=()=>page.evaluate(()=>JSON.parse(node.widgets[0].value));
  await page.getByRole('button',{name:'均等',exact:true}).click();
  assert.ok((await json()).global.every(x=>Math.abs(x-1/3)<1e-8));
  await page.locator('select').nth(0).selectOption('B03');
  await page.locator('select').nth(1).selectOption('ff');
  await page.getByRole('button',{name:'C 100%',exact:true}).click();
  assert.deepEqual((await json()).overrides.B03.ff,[0,0,1]);
  await page.getByRole('button',{name:'上書きを解除',exact:true}).click();
  assert.equal((await json()).overrides.B03,undefined);
  await page.locator('select').nth(2).selectOption('ANIMA_PAINT_TRANSFER');
  assert.ok(Math.abs((await json()).overrides.B03.ff[0]-.45)<1e-10);
  await page.locator('select').nth(1).selectOption('ff.net.0');
  assert.equal(await page.locator('input[type=number]').nth(1).inputValue(),'55.0');
  await page.evaluate(()=>{node.widgets[0].value='{"global":[0,0,1],"overrides":{}}';node.onConfigure();});
  assert.equal(await page.locator('input[type=number]').nth(2).inputValue(),'100.0');
  await page.locator('select').nth(0).selectOption('GLOBAL');
  const box=await page.locator('svg').boundingBox();
  await page.mouse.click(box.x+box.width/2,box.y+box.height*.36);
  assert.ok((await json()).global.every(x=>x>0&&x<1));
  const fixture={type:'recipe_merge_triangle_preset',version:1,architecture:'Anima',triangle:{global:[.2,.3,.5],overrides:{}}};
  await page.locator('input[type=file]').setInputFiles({name:'triangle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>JSON.parse(node.widgets[0].value).global[0]===.2);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'配合JSONを書き出す',exact:true}).click();
  assert.equal((await download).suggestedFilename(),'triangle_preset.json');
  assert.deepEqual(errors,[]);
  console.log('Triangle UI smoke passed: controls, overrides, presets, inheritance, workflow restore, pointer, JSON import/export.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
