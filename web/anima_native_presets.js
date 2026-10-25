// Native Anima controls. These are experimental starting ratios, not measured
// claims about which layers control style, identity, pose or detail.
const cells = (attn1, attn2, ff, other = 0) => ({attn1, attn2, ff, norm: 0, proj: 0, other});
const matrix = (fn, base = cells(0, 0, 0)) => {
  const out = {BASE: base};
  for (let i = 0; i < 28; i++) out['B' + String(i).padStart(2, '0')] = fn(i / 27);
  return out;
};
const round = v => Math.round(v * 100) / 100;
const purpose = (a, b, f, late = 0) => matrix(t =>
  cells(round(a * (1 + late*t)), round(b * (1 + late*t)), round(f * (1 + late*t))));
export const ANIMA_FACTORY = {
  ANIMA_BALANCED_25: () => matrix(() => ({attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}), {attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}),
  ANIMA_BALANCED_50: () => matrix(() => ({attn1:.5, attn2:.5, ff:.5, norm:.5, proj:.5, other:.5}), {attn1:.5, attn2:.5, ff:.5, norm:.5, proj:.5, other:.5}),
  ANIMA_SELF_ATTN: () => matrix(() => cells(.7, .15, .15)),
  ANIMA_CROSS_ATTN: () => matrix(() => cells(.15, .7, .15)),
  ANIMA_MLP: () => matrix(() => cells(.15, .15, .7)),
  ANIMA_EARLY: () => matrix(t => {const v = Math.round((.75 - .6*t)*100)/100; return cells(v,v,v);}),
  ANIMA_LATE: () => matrix(t => {const v = Math.round((.15 + .6*t)*100)/100; return cells(v,v,v);}),
  ANIMA_BASE_LIGHT: () => matrix(() => cells(0,0,0), {attn1:.25, attn2:.25, ff:.25, norm:.25, proj:.25, other:.25}),
  ANIMA_PAINT_SOFT: () => purpose(.05, .03, .3),
  ANIMA_PAINT_TRANSFER: () => purpose(.1, .05, .55),
  ANIMA_PAINT_STRONG: () => purpose(.2, .1, .8),
  ANIMA_PAINT_FACE_GUARD: () => purpose(0, 0, .4),
  ANIMA_SOFT_SHADING: () => purpose(.05, .03, .3, .5),
  ANIMA_COLOR_LIGHT: () => purpose(.08, .05, .4, .25),
  ANIMA_LINE_BLEND: () => purpose(.3, .05, .25),
  ANIMA_DETAIL_BLEND: () => purpose(.1, .05, .3, 1),
  ANIMA_POSE_GENTLE: () => purpose(.25, .3, .05),
  ANIMA_COMPOSITION_BLEND: () => purpose(.45, .45, .1),
};

// Labels describe intended experiments, not guaranteed disentanglement.
export const ANIMA_PRESET_LABELS = {
  ANIMA_PAINT_SOFT: "塗り移植・弱",
  ANIMA_PAINT_TRANSFER: "塗り移植・標準",
  ANIMA_PAINT_STRONG: "塗り移植・強",
  ANIMA_PAINT_FACE_GUARD: "塗り移植・顔への影響を抑える試行",
  ANIMA_SOFT_SHADING: "柔らかい陰影を取り込む試行",
  ANIMA_COLOR_LIGHT: "色・光を取り込む試行",
  ANIMA_LINE_BLEND: "線の特徴を混ぜる試行",
  ANIMA_DETAIL_BLEND: "細部を混ぜる試行",
  ANIMA_POSE_GENTLE: "ポーズを弱く取り込む試行",
  ANIMA_COMPOSITION_BLEND: "構図を取り込む試行",
};
