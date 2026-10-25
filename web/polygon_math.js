export function polygonWeights(values, count=values?.length) {
  if(!Array.isArray(values)||!Number.isInteger(count)||count<1||values.length!==count)throw new Error('LoRA数と配合の個数が一致しません');
  const v=values.map(Number), total=v.reduce((a,b)=>a+b,0);
  if(v.some(x=>!Number.isFinite(x)||x<0)||!Number.isFinite(total)||total<=0)throw new Error('配合は0以上、合計は0より大きい値にしてください');
  return v.map(x=>x/total);
}
export function polygonVertices(n) {
  if(!Number.isInteger(n)||n<1)throw new Error("LoRA数は1以上が必要です");
  if(n===1)return [[180,160]];
  if(n===2)return [[40,160],[320,160]];
  return Array.from({length:n},(_,i)=>{const a=-Math.PI/2+2*Math.PI*i/n;return [180+125*Math.cos(a),160+125*Math.sin(a)];});
}
export function polygonMarker(values) {
  const w=polygonWeights(values), vertices=polygonVertices(w.length);
  return w.reduce((p,v,i)=>[p[0]+v*vertices[i][0],p[1]+v*vertices[i][1]],[0,0]);
}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function edgeProjection(p,a,b) {
  const ab=sub(b,a), ap=sub(p,a), t=Math.max(0,Math.min(1,(ap[0]*ab[0]+ap[1]*ab[1])/(ab[0]**2+ab[1]**2)));
  const q=[a[0]+t*ab[0],a[1]+t*ab[1]];
  return {t,q,d:(p[0]-q[0])**2+(p[1]-q[1])**2};
}
// Mean-value coordinates on a regular convex polygon; outside points project
// onto the closest edge. Vertex/edge cases are handled before angle division.
export function polygonPointWeights(p,n) {
  const v=polygonVertices(n);
  if(n===1)return [1];
  let closest;
  for(let i=0;i<(n===2?1:n);i++) {
    const j=(i+1)%n, e=edgeProjection(p,v[i],v[j]);
    if(!closest||e.d<closest.d)closest={...e,i,j};
  }
  const inside=n>2&&v.every((a,i)=>cross(sub(v[(i+1)%n],a),sub(p,a))>=-1e-8);
  if(n===2||!inside||closest.d<1e-14) {
    const w=Array(n).fill(0);w[closest.i]=1-closest.t;w[closest.j]=closest.t;return w;
  }
  const r=v.map(a=>sub(a,p)), d=r.map(a=>Math.hypot(...a));
  for(let i=0;i<n;i++)if(d[i]<1e-8){const w=Array(n).fill(0);w[i]=1;return w;}
  const tan=r.map((a,i)=>{const j=(i+1)%n;return Math.abs(cross(a,r[j]))/(d[i]*d[j]+a[0]*r[j][0]+a[1]*r[j][1]);});
  return polygonWeights(d.map((di,i)=>(tan[(i+n-1)%n]+tan[i])/di));
}
export function editPolygonSources(state, removeIndex=null, name='') {
  const next=JSON.parse(JSON.stringify(state));
  const n=next.loras.length;
  if(removeIndex!==null&&(!Number.isInteger(removeIndex)||removeIndex<0||removeIndex>=n||n<=1))throw new Error('最後のLoRAは削除できません');
  const adjust=v=>{
    if(removeIndex===null)return [...polygonWeights(v,n),0];
    const a=v.filter((_,i)=>i!==removeIndex);
    if(a.every(x=>Number(x)===0))return a.map((_,i)=>i===0?1:0);
    return polygonWeights(a,n-1);
  };
  next.global=adjust(next.global);
  if(next.te)next.te=adjust(next.te);
  for(const group of Object.values(next.overrides||{}))for(const el of Object.keys(group))group[el]=adjust(group[el]);
  if(removeIndex===null)next.loras.push(name);else next.loras.splice(removeIndex,1);
  return next;
}
export function validatePolygonState(data) {
  if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.loras)||!data.loras.length||data.loras.some(n=>typeof n!=='string'||!n.trim()))throw new Error('LoRA名を1つ以上指定してください');
  const copy=JSON.parse(JSON.stringify(data)), n=copy.loras.length;
  copy.global=polygonWeights(copy.global,n);
  if(copy.te)copy.te=polygonWeights(copy.te,n);
  copy.overrides??={};
  if(typeof copy.overrides!=='object'||Array.isArray(copy.overrides))throw new Error('overridesが不正です');
  for(const [block,group] of Object.entries(copy.overrides)) {
    if(!/^(ALL|BASE|M00|(B|IN|OUT)\d{2})$/.test(block)||!group||typeof group!=='object'||Array.isArray(group))throw new Error('階層の上書きが不正です');
    for(const [el,v] of Object.entries(group)) {
      if(!/^[a-zA-Z0-9_.]+$/.test(el))throw new Error('要素名が不正です');
      group[el]=polygonWeights(v,n);
    }
  }
  return copy;
}
