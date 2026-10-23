import {app} from '../../scripts/app.js';
import {normalizeWeights, pointWeights, weightPoint} from './triangle_math.js';
import {ANIMA_FACTORY, ANIMA_PRESET_LABELS} from './anima_native_presets.js';

app.registerExtension({
  name:'galigali.recipemerge.triangle',
  beforeRegisterNodeDef(nodeType,nodeData) {
    if(nodeData.name!=='TriangleLoraMerge') return;
    const created=nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated=function() {
      created?.apply(this,arguments);
      const node=this, widget=this.widgets.find(w=>w.name==='triangle');
      widget.computeSize=()=>[0,-4]; widget.hidden=true; widget.type='hidden';
      let state, architecture;
      const root=document.createElement('div');
      root.style.cssText='padding:10px;background:#252b38;color:#edf1fa;font:12px sans-serif;box-sizing:border-box;max-height:680px;overflow:auto;';
      root.addEventListener('pointerdown',e=>e.stopPropagation());
      const el=(tag,text,parent=root)=>{const e=document.createElement(tag); if(text)e.textContent=text; parent.appendChild(e);return e;};
      el('strong','TRIANGLE LoRA MERGE');
      el('p','A＝lora_a　B＝lora_b　C＝lora_c。点を動かすか、割合を入力します。');
      const row=el('div'); row.style.cssText='display:flex;gap:5px;flex-wrap:wrap';
      const block=el('select',null,row), element=el('select',null,row);
      for(const name of ['ALL','attn1','attn2','ff','norm','proj','attn1.to_q','attn1.to_k','attn1.to_v','attn1.to_out','attn2.to_q','attn2.to_k','attn2.to_v','attn2.to_out','ff.net.0','ff.net.2']) {
        const o=el('option',name==='ALL'?'全要素':name,element);o.value=name;
      }
      const options=()=>{
        architecture=node.widgets.find(w=>w.name==='architecture')?.value||'Anima';
        const old=block.value; block.replaceChildren();
        const blocks=architecture==='Anima'?Array.from({length:28},(_,i)=>'B'+String(i).padStart(2,'0')):
          [...Array.from({length:12},(_,i)=>'IN'+String(i).padStart(2,'0')),'M00',...Array.from({length:12},(_,i)=>'OUT'+String(i).padStart(2,'0'))];
        for(const name of ['GLOBAL','TE','ALL','BASE',...blocks]) {
          const o=el('option',({GLOBAL:'全体の基本配合',TE:'テキストエンコーダ',ALL:'全階層の要素別'})[name]||name,block);o.value=name;
        }
        if([...block.options].some(o=>o.value===old))block.value=old;
      };
      options();
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 320 275');svg.style.cssText='width:100%;height:260px;touch-action:none;cursor:crosshair';root.appendChild(svg);
      svg.innerHTML='<polygon points="25,25 295,25 160,245" fill="#33465e" stroke="#8798b0" stroke-width="2"/><path d="M160 25 L160 245 M25 25 L227.5 135 M295 25 L92.5 135" stroke="#63748a" opacity=".5"/><text x="10" y="18" fill="#ffbfa6">A</text><text x="295" y="18" fill="#a6dbff">B</text><text x="155" y="266" fill="#b3ffc1">C</text><circle r="7" fill="#ffe08b" stroke="#202633" stroke-width="2"/>';
      const marker=svg.querySelector('circle');
      const numbers=el('div');numbers.style.cssText='display:flex;gap:8px';
      const inputs=['A','B','C'].map(name=>{const label=el('label',name+' % ',numbers);const n=el('input',null,label);n.type='number';n.min='0';n.max='100';n.step='.1';n.style.width='60px';return n;});
      const status=el('p'), list=el('pre');list.style.cssText='max-height:80px;overflow:auto;font-size:11px;white-space:pre-wrap';
      const effective=()=>{
        if(block.value==='GLOBAL')return state.global;
        if(block.value==='TE')return state.te||state.global;
        const pick=group=>{
          const keys=Object.keys(group||{}).filter(k=>k!=='ALL'&&(element.value===k||element.value.startsWith(k+'.'))).sort((a,b)=>b.length-a.length);
          return keys.length?group[keys[0]]:group?.ALL;
        };
        return pick(state.overrides[block.value])||pick(state.overrides.ALL)||state.global;
      };
      const paint=()=>{
        const values=normalizeWeights(effective()); const [x,y]=weightPoint(values);
        marker.setAttribute('cx',x);marker.setAttribute('cy',y);
        inputs.forEach((n,i)=>n.value=(values[i]*100).toFixed(1));
        element.disabled=['GLOBAL','TE'].includes(block.value);
        const own=state.overrides[block.value]?.[element.value];
        status.textContent=['GLOBAL','TE'].includes(block.value)?(block.value==='TE'&&!state.te?'全体の配合を継承':'基本配合'):(own?'この対象の上書き':'上書きなし（基本／親の配合を表示）');
        list.textContent=Object.entries(state.overrides).flatMap(([b,items])=>Object.entries(items).map(([e,v])=>b+':'+e+' = '+v.map(x=>(x*100).toFixed(1)+'%').join(' / '))).join('\n')||'階層・要素の上書きなし';
      };
      const save=()=>{widget.value=JSON.stringify(state);node.setDirtyCanvas(true,true);paint();};
      const load=()=>{
        try {
          state=JSON.parse(widget.value||'{}');
          state.global=normalizeWeights(state.global||[1,0,0]);
          if(state.te)state.te=normalizeWeights(state.te);
          state.overrides=state.overrides||{};
          for(const group of Object.values(state.overrides))for(const key of Object.keys(group))group[key]=normalizeWeights(group[key]);
          paint();
        }catch(e){status.textContent='配合JSONを確認してください: '+e.message;}
      };
      const set=values=>{
        try {
          const v=normalizeWeights(values);
          if(block.value==='GLOBAL')state.global=v;
          else if(block.value==='TE')state.te=v;
          else {state.overrides[block.value]??={};state.overrides[block.value][element.value]=v;}
          save();
        }catch(e){status.textContent=e.message;}
      };
      inputs.forEach(n=>n.addEventListener('change',()=>set(inputs.map(n=>n.value))));
      block.onchange=element.onchange=paint;
      const pointer=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());set(pointWeights(q.x,q.y));};
      svg.addEventListener('pointerdown',e=>{e.preventDefault();svg.setPointerCapture(e.pointerId);pointer(e);});
      svg.addEventListener('pointermove',e=>{if(svg.hasPointerCapture(e.pointerId))pointer(e);});
      svg.addEventListener('pointerup',e=>{if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);});
      const buttons=el('div');buttons.style.cssText='display:flex;gap:4px;flex-wrap:wrap';
      const button=(label,fn)=>{const b=el('button',label,buttons);b.onclick=e=>{e.preventDefault();fn();};};
      button('A 100%',()=>set([1,0,0]));button('B 100%',()=>set([0,1,0]));button('C 100%',()=>set([0,0,1]));button('均等',()=>set([1,1,1]));
      button('上書きを解除',()=>{if(block.value==='TE')delete state.te;else if(state.overrides[block.value]){delete state.overrides[block.value][element.value];if(!Object.keys(state.overrides[block.value]).length)delete state.overrides[block.value];}save();});
      button('全上書きを解除',()=>{state.overrides={};delete state.te;save();});
      const presets=el('select');presets.style.maxWidth='100%';
      el('option','Anima用途プリセット（Aを残しBを取り込む／C=0）',presets).value='';
      for(const name of Object.keys(ANIMA_FACTORY)){const o=el('option',ANIMA_PRESET_LABELS[name]||name,presets);o.value=name;}
      presets.onchange=()=>{
        if(!presets.value)return;
        if(architecture!=='Anima'){status.textContent='用途プリセットはarchitecture=Animaで使用してください';return;}
        const m=ANIMA_FACTORY[presets.value]();
        state={global:[1,0,0],overrides:{}};
        for(const [b,cells] of Object.entries(m)) {
          state.overrides[b]={ALL:[1-cells.other,cells.other,0]};
          for(const e of ['attn1','attn2','ff','norm','proj'])state.overrides[b][e]=[1-cells[e],cells[e],0];
        }
        save();status.textContent='用途プリセット適用。A=残したいLoRA、B=取り込みたいLoRA。Cは対象を選んで追加してください。';
      };
      button('配合JSONを書き出す',()=>{
        const blob=new Blob([JSON.stringify({type:'recipe_merge_triangle_preset',version:1,architecture,triangle:state},null,2)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='triangle_preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      });
      const file=el('input');file.type='file';file.accept='.json';file.style.display='none';
      button('配合JSONを読み込む',()=>file.click());
      file.onchange=async()=>{
        try {
          const data=JSON.parse(await file.files[0].text());
          if(data.type!=='recipe_merge_triangle_preset'||data.architecture!==architecture)throw new Error('プリセット形式またはarchitectureが一致しません');
          const incoming=data.triangle; normalizeWeights(incoming.global);
          if(incoming.te)normalizeWeights(incoming.te);
          if(!incoming.overrides||typeof incoming.overrides!=='object'||Array.isArray(incoming.overrides))throw new Error('overridesが不正です');
          for(const group of Object.values(incoming.overrides))for(const v of Object.values(group))normalizeWeights(v);
          widget.value=JSON.stringify(incoming);load();save();
        }catch(e){status.textContent='読み込み失敗: '+e.message;}finally{file.value='';}
      };
      el('p','用途名は調整の出発点です。実画像での効果は未検証。全体より階層別、親よりサブ要素の上書きが優先されます。');
      const archWidget=this.widgets.find(w=>w.name==='architecture'), oldArch=archWidget.callback;
      archWidget.callback=function(){oldArch?.apply(this,arguments);options();paint();};
      const configure=node.onConfigure;
      node.onConfigure=function(){configure?.apply(this,arguments);options();load();};
      this.addDOMWidget('triangle_controls','div',root,{serialize:false,hideOnZoom:false,getMinHeight:()=>620});
      load();this.setSize([Math.max(this.size[0],430),800]);
    };
  }
});
