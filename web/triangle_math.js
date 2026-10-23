export function normalizeWeights(values) {
  if (!Array.isArray(values) || values.length !== 3) throw new Error('A/B/Cの3数値が必要です');
  const v = values.map(Number), total = v.reduce((a,b)=>a+b,0);
  if (v.some(x=>!Number.isFinite(x)||x<0) || !Number.isFinite(total) || total<=0) throw new Error('0以上の配合を入力してください（合計0は不可）');
  return v.map(x=>x/total);
}
export function pointWeights(x,y) {
  const c = (y-25)/220;
  const b = ((x-160)/135 + 1-c)/2;
  return normalizeWeights([1-b-c,b,c].map(v=>Math.max(0,v)));
}
export function weightPoint(values) {
  const [a,b,c]=normalizeWeights(values);
  return [25*a+295*b+160*c,25*(a+b)+245*c];
}
