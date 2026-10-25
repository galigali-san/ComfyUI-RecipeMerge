import {app} from '../../scripts/app.js';
import {polygonWeights, polygonVertices, polygonMarker, polygonPointWeights, editPolygonSources, validatePolygonState} from './polygon_math.js';
import {ANIMA_FACTORY, ANIMA_PRESET_LABELS} from './anima_native_presets.js';

app.registerExtension({
  name:'galigali.recipemerge.polygon',
  beforeRegisterNodeDef(nodeType,nodeData) {
    if(nodeData.name!=='PolygonLoraMerge')return;
    const created=nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated=function() {
      created?.apply(this,arguments);
      const node=this, widget=node.widgets.find(w=>w.name==='polygon'), catalog=node.widgets.find(w=>w.name==='lora_catalog');
      for(const w of [widget,catalog]){w.computeSize=()=>[0,-4];w.hidden=true;w.type='hidden';}
      let state, architecture, dragging=false;
      const root=document.createElement('div');root.style.cssText='padding:10px;background:#252b38;color:#edf1fa;font:12px sans-serif;box-sizing:border-box;max-height:850px;overflow:auto;';
      root.addEventListener('pointerdown',e=>e.stopPropagation());
      const el=(tag,text,parent=root)=>{const e=document.createElement(tag);if(text)e.textContent=text;parent.appendChild(e);return e;};
      const button=(label,fn,parent=root)=>{const b=el('button',label,parent);b.onclick=e=>{e.preventDefault();try{fn();}catch(err){status.textContent=err.message;}};return b;};
      const sourceLabel=i=>i<26?String.fromCharCode(65+i):'L'+(i+1);
      const available=()=>{
        let values=catalog.options?.values;
        if(typeof values==='function')values=values();
        return Array.isArray(values)?values:(nodeData.input?.required?.lora_catalog?.[0]||[]);
      };
      el('strong','POLYGON LoRA MERGE');
      el('p','LoRAを追加・削除して多角形を変更。各頂点が1つのLoRAです。');
      const sources=el('div');sources.style.cssText='max-height:200px;overflow:auto';
      button('＋ LoRAを追加',()=>{
        const names=available();if(!names.length)throw new Error('LoRAがありません。models/lorasを確認して一覧を更新してください');
        const name=names.find(n=>!state.loras.includes(n))||names[0];
        state=editPolygonSources(state,null,name);save();renderSources();
      });
      const targets=el('div');targets.style.cssText='display:flex;gap:5px;flex-wrap:wrap;margin-top:8px';
      const block=el('select',null,targets),element=el('select',null,targets);
      for(const name of ['ALL','attn1','attn2','ff','norm','proj','attn1.to_q','attn1.to_k','attn1.to_v','attn1.to_out','attn2.to_q','attn2.to_k','attn2.to_v','attn2.to_out','ff.net.0','ff.net.2']) {
        el('option',name==='ALL'?'全要素':name,element).value=name;
      }
      const options=()=>{
        architecture=node.widgets.find(w=>w.name==='architecture')?.value||'Anima';
        const old=block.value;block.replaceChildren();
        const blocks=architecture==='Anima'?Array.from({length:28},(_,i)=>'B'+String(i).padStart(2,'0')):
          [...Array.from({length:12},(_,i)=>'IN'+String(i).padStart(2,'0')),'M00',...Array.from({length:12},(_,i)=>'OUT'+String(i).padStart(2,'0'))];
        for(const name of ['GLOBAL','TE','ALL','BASE',...blocks])el('option',({GLOBAL:'全体の基本配合',TE:'テキストエンコーダ',ALL:'全階層の要素別'})[name]||name,block).value=name;
        if([...block.options].some(o=>o.value===old))block.value=old;
      };
      options();
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 320');svg.style.cssText='width:100%;height:300px;touch-action:none;cursor:crosshair';root.appendChild(svg);
      const numbers=el('div');numbers.style.cssText='display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto';
      let inputs=[];
      const status=el('p'),list=el('pre');list.style.cssText='max-height:80px;overflow:auto;font-size:11px;white-space:pre-wrap';
      const effective=()=>{
        if(block.value==='GLOBAL')return state.global;
        if(block.value==='TE')return state.te||state.global;
        const pick=group=>{
          const keys=Object.keys(group||{}).filter(k=>k!=='ALL'&&(element.value===k||element.value.startsWith(k+'.'))).sort((a,b)=>b.length-a.length);
          return keys.length?group[keys[0]]:group?.ALL;
        };
        return pick(state.overrides[block.value])||pick(state.overrides.ALL)||state.global;
      };
      const svgEl=(name,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);svg.appendChild(e);return e;};
      const paint=()=>{
        if(!state?.loras?.length)return;
        const w=polygonWeights(effective(),state.loras.length),v=polygonVertices(w.length),[x,y]=polygonMarker(w);
        svg.replaceChildren();
        if(v.length>2)svgEl('polygon',{points:v.map(p=>p.join(',')).join(' '),fill:'#33465e',stroke:'#8798b0','stroke-width':2});
        if(v.length===2)svgEl('line',{x1:v[0][0],y1:v[0][1],x2:v[1][0],y2:v[1][1],stroke:'#8798b0','stroke-width':3});
        v.forEach((p,i)=>{
          svgEl('circle',{cx:p[0],cy:p[1],r:4,fill:'#d8e5ff'});
          const label=svgEl('text',{x:p[0],y:p[1]-10,fill:'#e4eeff','text-anchor':'middle','font-size':12});label.textContent=sourceLabel(i);
        });
        svgEl('circle',{cx:x,cy:y,r:7,fill:'#ffe08b',stroke:'#202633','stroke-width':2});
        numbers.replaceChildren();inputs=w.map((val,i)=>{
          const label=el('label',sourceLabel(i)+' % ',numbers),input=el('input',null,label);
          input.type='number';input.min='0';input.max='100';input.step='.1';input.style.width='65px';input.value=(val*100).toFixed(2);
          input.addEventListener('change',()=>set(inputs.map(n=>n.value)));return input;
        });
        element.disabled=['GLOBAL','TE'].includes(block.value);
        const own=state.overrides[block.value]?.[element.value];
        status.textContent=state.loras.length+'入力 / '+(own?'この対象の上書き':block.value==='GLOBAL'?'基本配合':block.value==='TE'&&state.te?'TEの別配合':'基本／親の配合を継承');
        list.textContent=Object.entries(state.overrides).flatMap(([b,cells])=>Object.entries(cells).map(([e,ws])=>b+':'+e+' = '+ws.map((p,i)=>sourceLabel(i)+':'+(p*100).toFixed(1)+'%').join(' '))).join('\n')||'階層・要素の上書きなし';
      };
      const save=()=>{widget.value=JSON.stringify(state);node.setDirtyCanvas(true,true);paint();};
      const set=values=>{
        try{
          const w=polygonWeights(values,state.loras.length);
          if(block.value==='GLOBAL')state.global=w;
          else if(block.value==='TE')state.te=w;
          else{state.overrides[block.value]??={};state.overrides[block.value][element.value]=w;}
          save();
        }catch(e){status.textContent=e.message;}
      };
      const renderSources=()=>{
        sources.replaceChildren();
        const names=available();
        state.loras.forEach((name,i)=>{
          const row=el('div',null,sources);row.style.cssText='display:flex;gap:5px;margin-bottom:4px;align-items:center';
          el('span',sourceLabel(i),row);
          const select=el('select',null,row);select.style.cssText='flex:1;min-width:0';
          for(const file of names.includes(name)?names:[name,...names])el('option',file,select).value=file;
          select.value=name;select.onchange=()=>{state.loras[i]=select.value;save();};
          button('100%',()=>set(state.loras.map((_,j)=>i===j?1:0)),row);
          const remove=button('削除',()=>{state=editPolygonSources(state,i);save();renderSources();},row);remove.disabled=state.loras.length===1;
        });
      };
      const load=()=>{
        try{
          const files=available();if(files.length&&!files.includes(catalog.value))catalog.value=files[0];
          const data=JSON.parse(widget.value||'{}');
          if(Array.isArray(data.loras)&&!data.loras.length){
            const names=available().slice(0,3);if(!names.length)throw new Error('LoRAをmodels/lorasに配置し一覧を更新してください');
            state={loras:names,global:names.map((_,i)=>i===0?1:0),overrides:{}};
            widget.value=JSON.stringify(state);
          }else state=validatePolygonState(data);
          renderSources();paint();
        }catch(e){status.textContent='配合データを確認してください: '+e.message;}
      };
      block.onchange=element.onchange=paint;
      const pointer=e=>{
        if(!state?.loras?.length)return;
        const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());
        set(polygonPointWeights([q.x,q.y],state.loras.length));
      };
      svg.addEventListener('pointerdown',e=>{e.preventDefault();dragging=true;svg.setPointerCapture(e.pointerId);pointer(e);});
      svg.addEventListener('pointermove',e=>{if(dragging)pointer(e);});
      svg.addEventListener('pointerup',e=>{dragging=false;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);});
      svg.addEventListener('pointercancel',()=>{dragging=false;});
      const buttons=el('div');buttons.style.cssText='display:flex;gap:5px;flex-wrap:wrap';
      button('均等配合',()=>set(state.loras.map(()=>1)),buttons);
      button('上書きを解除',()=>{if(block.value==='TE')delete state.te;else if(state.overrides[block.value]){delete state.overrides[block.value][element.value];if(!Object.keys(state.overrides[block.value]).length)delete state.overrides[block.value];}save();},buttons);
      button('全上書きを解除',()=>{state.overrides={};delete state.te;save();},buttons);
      const presets=el('select');presets.style.maxWidth='100%';el('option','Anima用途プリセット（Aを残しBを取り込む）',presets).value='';
      for(const name of Object.keys(ANIMA_FACTORY))el('option',ANIMA_PRESET_LABELS[name]||name,presets).value=name;
      presets.onchange=()=>{
        if(!presets.value)return;
        if(architecture!=='Anima'||state.loras.length<2){status.textContent='Anima用。A/Bの2入力以上が必要です';return;}
        const n=state.loras.length,vec=t=>[1-t,t,...Array(n-2).fill(0)];
        state.global=vec(0);state.overrides={};delete state.te;
        for(const [b,cells] of Object.entries(ANIMA_FACTORY[presets.value]())) {
          state.overrides[b]={ALL:vec(cells.other)};
          for(const e of ['attn1','attn2','ff','norm','proj'])state.overrides[b][e]=vec(cells[e]);
        }
        save();status.textContent='A=残したいLoRA、B=取り込みたいLoRA。C以降は0%。追加したい対象を選び配合してください';
      };
      button('配合JSONを書き出す',()=>{
        const blob=new Blob([JSON.stringify({type:'recipe_merge_polygon_preset',version:1,architecture,polygon:state},null,2)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='polygon_preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      },buttons);
      const file=el('input');file.type='file';file.accept='.json';file.style.display='none';
      button('配合JSONを読み込む',()=>file.click(),buttons);
      file.onchange=async()=>{
        try{
          const data=JSON.parse(await file.files[0].text());
          if(data.architecture!==architecture)throw new Error('architectureが一致しません');
          let incoming;
          if(data.type==='recipe_merge_polygon_preset')incoming=data.polygon;
          else if(data.type==='recipe_merge_triangle_preset'){
            if(state.loras.length<3)throw new Error('Triangle配合の読込にはA/B/Cの3入力を用意してください');
            incoming={...data.triangle,loras:state.loras.slice(0,3)};
          }else throw new Error('Polygon/Triangle用の配合JSONを選択してください');
          const checked=validatePolygonState(incoming);
          const missing=checked.loras.filter(n=>!available().includes(n));if(missing.length)throw new Error('見つからないLoRA: '+missing.join(', '));
          state=checked;save();renderSources();
        }catch(e){status.textContent='読み込み失敗: '+e.message;}finally{file.value='';}
      };
      el('p','4入力以上では点の位置だけで全配合を表せません。数値欄なら任意の配合を指定できます。点をドラッグすると位置に応じた配合に変わります。');
      el('p','追加は0%で既存配合を保持。削除後は残りを100%へ再配分し、残りが全0%なら先頭を100%にします。LoRA数に応じrankとメモリ使用量が増えます。');
      const archWidget=node.widgets.find(w=>w.name==='architecture'),oldArch=archWidget.callback;
      archWidget.callback=function(){oldArch?.apply(this,arguments);options();paint();if(Object.keys(state.overrides).length)status.textContent='階層形式を切り替えました。旧形式の上書きは解除してから設定してください';};
      const configure=node.onConfigure;node.onConfigure=function(){configure?.apply(this,arguments);options();load();};
      node.addDOMWidget('polygon_controls','div',root,{serialize:false,hideOnZoom:false,getMinHeight:()=>780});
      load();node.setSize([Math.max(node.size[0],480),1000]);
    };
  }
});
