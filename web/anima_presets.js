// Map the SD MBW curve onto Anima depth. This is a control-curve mapping,
// not a claim that SD and DiT layers have equivalent visual effects.
export function adaptPreset(matrix, anima) {
  const keys = Object.keys(matrix);
  const sd = keys.some(k => /^(IN|OUT)\d{2}$|^M00$/.test(k));
  const dit = keys.some(k => /^B\d{2}$/.test(k));
  if (sd && dit) throw new Error("SD階層とAnima階層が混在しています");
  if (!anima && dit) throw new Error("AnimaプリセットはAnimaノードで使用してください");
  if (!anima || !sd) return JSON.parse(JSON.stringify(matrix));
  const blocks = [
    ...Array.from({length: 12}, (_, i) => 'IN' + String(i).padStart(2, '0')),
    'M00',
    ...Array.from({length: 12}, (_, i) => 'OUT' + String(i).padStart(2, '0')),
  ];
  const elements = new Set(['attn1', 'attn2', 'ff', 'norm', 'proj', 'other']);
  for (const block of blocks) for (const key of Object.keys(matrix[block] || {})) elements.add(key);
  const out = {};
  if (matrix.BASE) out.BASE = {...matrix.BASE};
  for (let i = 0; i < 28; i++) {
    const x = i * 24 / 27;
    const lo = Math.floor(x), hi = Math.ceil(x), t = x - lo;
    const cells = {};
    for (const el of elements) {
      const a = Number(matrix[blocks[lo]]?.[el] || 0);
      const b = Number(matrix[blocks[hi]]?.[el] || 0);
      cells[el] = Math.round((a * (1 - t) + b * t) * 100) / 100;
    }
    out['B' + String(i).padStart(2, '0')] = cells;
  }
  return out;
}
