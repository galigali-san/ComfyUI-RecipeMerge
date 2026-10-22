// Native Anima controls. These are experimental starting ratios, not measured
// claims about which layers control style, identity, pose or detail.
const cells = (attn1, attn2, ff, other = 0) => ({attn1, attn2, ff, norm: 0, proj: 0, other});
const matrix = (fn, base = cells(0, 0, 0)) => {
  const out = {BASE: base};
  for (let i = 0; i < 28; i++) out['B' + String(i).padStart(2, '0')] = fn(i / 27);
  return out;
};
export const ANIMA_FACTORY = {
  ANIMA_BALANCED_25: () => matrix(() => ({attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}), {attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}),
  ANIMA_BALANCED_50: () => matrix(() => ({attn1:.5, attn2:.5, ff:.5, norm:.5, proj:.5, other:.5}), {attn1:.5, attn2:.5, ff:.5, norm:.5, proj:.5, other:.5}),
  ANIMA_SELF_ATTN: () => matrix(() => cells(.7, .15, .15)),
  ANIMA_CROSS_ATTN: () => matrix(() => cells(.15, .7, .15)),
  ANIMA_MLP: () => matrix(() => cells(.15, .15, .7)),
  ANIMA_EARLY: () => matrix(t => {const v = Math.round((.75 - .6*t)*100)/100; return cells(v,v,v);}),
  ANIMA_LATE: () => matrix(t => {const v = Math.round((.15 + .6*t)*100)/100; return cells(v,v,v);}),
  ANIMA_BASE_LIGHT: () => matrix(() => cells(0,0,0), {attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}),
};
