// Elemental Matrix Merge (Knobs) — シンセ風つまみマトリクスUI
// Sytrus風タブ: [ALL]=全要素マトリクス / [attn1]等=その要素だけ大きいつまみで。
// レイアウトはSuperMergerのMBW風(IN左列 / OUT右列 / BASE・M00下段)。
// 値はJSONで隠しウィジェット "matrix" に保存される。
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const IN_BLOCKS = [];
const OUT_BLOCKS = [];
for (let i = 0; i < 12; i++) {
  IN_BLOCKS.push("IN" + String(i).padStart(2, "0"));
  OUT_BLOCKS.push("OUT" + String(i).padStart(2, "0"));
}
const MID_BLOCKS = ["BASE", "M00"];
const ALL_BLOCKS = [...IN_BLOCKS, ...OUT_BLOCKS, ...MID_BLOCKS];

const ELEMENTS = ["attn1", "attn2", "ff", "norm", "proj", "other"];
const TABS = ["ALL", ...ELEMENTS];

// 要素タブ内のサブ要素列: [表示ラベル, 保存キー(=そのままレシピの要素指定)]。
// サブつまみ0=親要素のつまみに従う(Python側がルールを出さない)。
const SUBS = {
  attn1: [["to_q", "attn1.to_q"], ["to_k", "attn1.to_k"],
          ["to_v", "attn1.to_v"], ["to_out", "attn1.to_out"]],
  attn2: [["to_q", "attn2.to_q"], ["to_k", "attn2.to_k"],
          ["to_v", "attn2.to_v"], ["to_out", "attn2.to_out"]],
  ff:    [["net.0", "ff.net.0"], ["net.2", "ff.net.2"]],
  norm:  [["norm1", "norm1"], ["norm2", "norm2"], ["norm3", "norm3"]],
  proj:  [["proj_in", "proj_in"], ["proj_out", "proj_out"]],
  other: [["in_l", "in_layers"], ["out_l", "out_layers"],
          ["emb", "emb_layers"], ["skip", "skip_connection"],
          ["conv", "conv"]],
};
const SUB_PARENT = {}; // 保存キー -> 親要素タブ名
for (const t of ELEMENTS) for (const [, key] of SUBS[t]) SUB_PARENT[key] = t;

// --- プリセット ---
// ユーザープリセットはComfyUIのuserdata API(user/フォルダ)に保存。
// APIが使えない環境ではlocalStorageにフォールバック。
const PRESET_FILE = "recipe_merge_matrix_presets.json";
const PRESET_LS_KEY = "gg.recipemerge.matrix_presets";

async function loadUserPresets() {
  try {
    const resp = await api.getUserData(PRESET_FILE);
    if (resp.status === 200) {
      const data = await resp.json();
      if (data && typeof data === "object") return data;
    }
  } catch (e) { /* userdata API無し → localStorageへ */ }
  try {
    return JSON.parse(localStorage.getItem(PRESET_LS_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

async function persistUserPresets(presets) {
  try {
    const resp = await api.storeUserData(PRESET_FILE, presets,
      { stringify: true, throwOnError: false });
    if (resp && resp.status >= 200 && resp.status < 300) return;
  } catch (e) { /* userdata API無し → localStorageへ */ }
  try { localStorage.setItem(PRESET_LS_KEY, JSON.stringify(presets)); } catch (e) {}
}

// 定番MBWカーブ(IN00..M00..OUT11の25点)を全要素に展開した同梱プリセット。
// fn(t, i): t=0..1(IN00→OUT11), i=ブロック番号。MBW移植なのでBASEは常に0。
const CURVE_BLOCKS = [...IN_BLOCKS, "M00", ...OUT_BLOCKS];
const curveMatrix = (fn) => {
  const m = {};
  CURVE_BLOCKS.forEach((b, i) => {
    const t = i / (CURVE_BLOCKS.length - 1);
    const v = Math.round(Math.min(1, Math.max(0, fn(t, i))) * 100) / 100;
    if (v <= 0) return;
    m[b] = {};
    for (const el of ELEMENTS) m[b][el] = v;
  });
  return m;
};
const FACTORY = {
  FLAT_25: () => curveMatrix(() => 0.25),
  FLAT_50: () => curveMatrix(() => 0.5),
  FLAT_75: () => curveMatrix(() => 0.75),
  FLAT_100:() => curveMatrix(() => 1.0),
  GRAD_V:  () => curveMatrix((t) => Math.abs(t - 0.5) * 2),
  GRAD_A:  () => curveMatrix((t) => 1 - Math.abs(t - 0.5) * 2),
  COS_IN:  () => curveMatrix((t) => 0.5 + 0.5 * Math.cos(Math.PI * t)),
  COS_OUT: () => curveMatrix((t) => 0.5 - 0.5 * Math.cos(Math.PI * t)),
  WRAP08:  () => curveMatrix((t, i) => (i < 4 || i > 20 ? 1 : 0)),
  PAINT_TRANSFER: () => {
    const m = {};
    for (const b of OUT_BLOCKS) {
      m[b] = {
        attn1: 0.5,
        attn2: 0.5,
        ff: 1.0,
        norm: 0.8,
        proj: 0.8,
        other: 0.8
      };
    }
    return m;
  },
  PAINT_SOFT_SHADING: () => {
    const m = {};
    for (let i = 0; i < 12; i++) {
      const b = "OUT" + String(i).padStart(2, "0");
      if (i <= 5) {
        m[b] = { attn1: 0.2, attn2: 0.2, ff: 0.5, norm: 0.5, proj: 0.5, other: 0.5 };
      } else {
        m[b] = { attn1: 0.6, attn2: 0.6, ff: 1.0, norm: 0.9, proj: 0.9, other: 0.9 };
      }
    }
    return m;
  },
  PAINT_COLOR_LIGHT: () => {
    const m = {};
    for (let i = 0; i < 12; i++) {
      const b = "OUT" + String(i).padStart(2, "0");
      if (i <= 5) {
        m[b] = { attn1: 0.5, attn2: 0.5, ff: 1.0, norm: 0.8, proj: 0.8, other: 1.0 };
      } else {
        m[b] = { attn1: 0.2, attn2: 0.2, ff: 0.3, norm: 0.3, proj: 0.3, other: 0.3 };
      }
    }
    return m;
  },
  PAINT_FLAT_ANIME: () => {
    const m = {};
    for (const b of OUT_BLOCKS) {
      m[b] = {
        attn1: 0.3,
        attn2: 0.3,
        ff: 0.8,
        norm: 1.0,
        proj: 1.0,
        other: 0.7
      };
    }
    return m;
  },
};

// 配布用プリセットJSON(共有ファイル)の検証。ブロック名と数値だけ通す。
// 受け付ける形: {type,version,name,matrix:{...}} または素の {block:{el:v}}
const sanitizeMatrix = (m) => {
  if (!m || typeof m !== "object") return null;
  const out = {};
  for (const b of Object.keys(m)) {
    if (!/^(IN|OUT)\d{2}$|^M00$|^BASE$/.test(b)) continue;
    const cells = m[b];
    if (!cells || typeof cells !== "object") continue;
    const oc = {};
    for (const k of Object.keys(cells)) {
      const v = Number(cells[k]);
      if (!isFinite(v)) continue;
      oc[k] = Math.min(1, Math.max(0, Math.round(v * 100) / 100));
    }
    if (Object.keys(oc).length) out[b] = oc;
  }
  return Object.keys(out).length ? out : null;
};

const CSS = `
.gg-matrix {
  font-family: "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #4a4f5e 0%, #3a3e4b 100%);
  border: 1px solid #23252e;
  border-radius: 4px;
  padding: 4px;
  user-select: none;
  color: #c9cdd8;
}
.gg-tabs { display: flex; gap: 2px; margin-bottom: 4px; }
.gg-tab {
  flex: 1; text-align: center; padding: 3px 0; cursor: pointer;
  font-size: 10px; font-weight: 600; color: #99a;
  background: #2c2f3a; border: 1px solid #23252e; border-radius: 3px;
  text-shadow: 0 1px 1px #000;
}
.gg-tab:hover { color: #dde; }
.gg-tab.gg-active {
  background: linear-gradient(180deg, #6a7080, #4a4f5e);
  color: #f5e04a;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.2);
}
.gg-cols { display: flex; gap: 10px; justify-content: center; }
.gg-mid { display: flex; justify-content: center; margin-top: 2px; }
.gg-matrix table { border-collapse: collapse; }
.gg-matrix th {
  font-size: 9px; font-weight: 600; color: #e8d44d;
  padding: 1px 2px; text-shadow: 0 1px 1px #000;
}
.gg-matrix th.gg-sub { color: #9fb3d9; font-weight: 400; }
.gg-matrix td.gg-lbl {
  font-size: 9px; color: #aab; text-align: right;
  padding: 0 4px 0 0; text-shadow: 0 1px 1px #000; min-width: 30px;
}
.gg-matrix td.gg-lbl-r { text-align: left; padding: 0 0 0 4px; }
.gg-matrix td { padding: 1px; }
.gg-knob {
  width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #6a7080, #2c2f3a 70%);
  box-shadow: 0 2px 3px rgba(0,0,0,.6), inset 0 1px 1px rgba(255,255,255,.25);
  position: relative; cursor: ns-resize; margin: 0 auto;
}
.gg-knob::after {
  content: ""; position: absolute; left: 50%; top: 2px;
  width: 2px; height: 8px; margin-left: -1px;
  background: #f5e04a; border-radius: 1px;
  transform-origin: 1px 9px;
  transform: rotate(var(--rot, -135deg));
  box-shadow: 0 0 3px rgba(245,224,74,.6);
}
.gg-knob.gg-zero::after { background: #7d8496; box-shadow: none; }
.gg-knob.gg-big { width: 26px; height: 26px; }
.gg-knob.gg-big::after {
  top: 2px; width: 2px; height: 10px;
  transform-origin: 1px 11px;
}
.gg-info {
  margin-top: 4px; padding: 3px 8px;
  background: #1b2027; border: 1px solid #0d0f13; border-radius: 3px;
  font-size: 11px; color: #b8e08a; min-height: 15px;
  font-family: Consolas, monospace; text-shadow: 0 0 4px rgba(150,220,90,.5);
}
.gg-toolbar { display: flex; gap: 4px; margin-bottom: 4px; justify-content: center; }
.gg-toolbar button, .gg-presetbar button {
  font-size: 10px; padding: 1px 8px; cursor: pointer;
  background: linear-gradient(180deg, #5a6070, #3a3e4b);
  color: #dde; border: 1px solid #23252e; border-radius: 3px;
}
.gg-toolbar button:hover, .gg-presetbar button:hover { color: #f5e04a; }
.gg-presetbar { display: flex; gap: 4px; margin-bottom: 4px; }
.gg-presetbar select {
  flex: 1; font-size: 10px; padding: 1px 2px; cursor: pointer;
  background: #2c2f3a; color: #dde;
  border: 1px solid #23252e; border-radius: 3px;
}
`;

function injectCSS() {
  if (document.getElementById("gg-matrix-css")) return;
  const s = document.createElement("style");
  s.id = "gg-matrix-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

app.registerExtension({
  name: "galigali.recipemerge.elemental_matrix",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ElementalMatrixMerge") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      injectCSS();

      const mw = this.widgets.find((w) => w.name === "matrix");
      // 生JSONウィジェットは隠す(値の保存はこれが担う)
      mw.computeSize = () => [0, -4];
      mw.hidden = true;
      mw.type = "hidden";

      let state = {};
      const load = () => {
        try { state = JSON.parse(mw.value || "{}"); } catch (e) { state = {}; }
        if (typeof state !== "object" || state === null) state = {};
      };
      let updateTabMarks = () => {}; // タブ生成後に差し替え
      const save = () => {
        mw.value = JSON.stringify(state);
        updateTabMarks();
      };
      const get = (b, el) => (state[b] && Number(state[b][el])) || 0;
      const set = (b, el, v) => {
        v = Math.min(1, Math.max(0, v));
        v = Math.round(v * 100) / 100;
        if (!state[b]) state[b] = {};
        state[b][el] = v;
        save();
        return v;
      };

      load();

      const root = document.createElement("div");
      root.className = "gg-matrix";

      // --- タブバー ---
      const tabbar = document.createElement("div");
      tabbar.className = "gg-tabs";
      root.appendChild(tabbar);

      // --- プリセットバー ---
      const presetbar = document.createElement("div");
      presetbar.className = "gg-presetbar";
      root.appendChild(presetbar);

      // --- 一括ボタン ---
      const toolbar = document.createElement("div");
      toolbar.className = "gg-toolbar";
      root.appendChild(toolbar);

      // --- コンテンツ(タブごとに作り直す) ---
      const content = document.createElement("div");
      root.appendChild(content);

      const info = document.createElement("div");
      info.className = "gg-info";
      info.textContent = "drag=回す / dblclick=0 / wheel=±0.05 / サブつまみ0=親要素に従う";
      root.appendChild(info);

      let knobs = {}; // "BLOCK|el" -> knob div (現在表示中のぶんだけ)
      let activeTab = "ALL";

      const paint = (b, el) => {
        const k = knobs[b + "|" + el];
        if (!k) return;
        const v = get(b, el);
        k.style.setProperty("--rot", (-135 + v * 270) + "deg");
        k.classList.toggle("gg-zero", v === 0);
      };
      const paintAll = () => {
        for (const key of Object.keys(knobs)) {
          const [b, el] = key.split("|");
          paint(b, el);
        }
      };
      this._ggPaintAll = () => { load(); paintAll(); updateTabMarks(); };

      const show = (b, el, v) => {
        let msg = b + " : " + el + " = " + v.toFixed(2);
        if (v === 0 && SUB_PARENT[el]) msg += "  (0=" + SUB_PARENT[el] + "に従う)";
        info.textContent = msg;
      };

      const mkKnob = (b, el, big) => {
        const knob = document.createElement("div");
        knob.className = big ? "gg-knob gg-big" : "gg-knob";
        knobs[b + "|" + el] = knob;

        knob.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          knob.setPointerCapture(e.pointerId);
          let lastY = e.clientY;
          const move = (ev) => {
            const dy = lastY - ev.clientY;
            lastY = ev.clientY;
            const v = set(b, el, get(b, el) + dy * 0.01);
            paint(b, el);
            show(b, el, v);
          };
          const up = (ev) => {
            knob.releasePointerCapture(ev.pointerId);
            knob.removeEventListener("pointermove", move);
            knob.removeEventListener("pointerup", up);
          };
          knob.addEventListener("pointermove", move);
          knob.addEventListener("pointerup", up);
          show(b, el, get(b, el));
        });
        knob.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          show(b, el, set(b, el, 0));
          paint(b, el);
        });
        knob.addEventListener("wheel", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = set(b, el, get(b, el) + (e.deltaY < 0 ? 0.05 : -0.05));
          paint(b, el);
          show(b, el, v);
        }, { passive: false });
        knob.addEventListener("pointerenter", () => show(b, el, get(b, el)));
        return knob;
      };

      // 表示中タブの列構成: {label, key, big, sub}
      // ALL=6要素 / 要素タブ=親(大つまみ)+サブ要素列
      const tabCols = (t) => {
        if (t === "ALL") return ELEMENTS.map((el) => ({ label: el, key: el }));
        const cols = [{ label: t, key: t, big: true }];
        for (const [label, key] of SUBS[t]) cols.push({ label, key, sub: true });
        return cols;
      };

      // ブロック列のテーブル。labelRight=trueでラベル右側(OUT列用)
      const mkTable = (blocks, labelRight, withHeader, cols) => {
        const table = document.createElement("table");
        if (withHeader) {
          const thead = table.insertRow();
          if (!labelRight) thead.appendChild(document.createElement("th"));
          for (const c of cols) {
            const th = document.createElement("th");
            th.textContent = c.label;
            if (c.sub) th.className = "gg-sub";
            thead.appendChild(th);
          }
          if (labelRight) thead.appendChild(document.createElement("th"));
        }
        for (const b of blocks) {
          const tr = table.insertRow();
          const addLabel = () => {
            const lbl = tr.insertCell();
            lbl.className = labelRight ? "gg-lbl gg-lbl-r" : "gg-lbl";
            lbl.textContent = b;
          };
          if (!labelRight) addLabel();
          for (const c of cols) {
            const td = tr.insertCell();
            td.appendChild(mkKnob(b, c.key, c.big));
          }
          if (labelRight) addLabel();
        }
        return table;
      };

      const buildContent = () => {
        knobs = {};
        content.innerHTML = "";
        const tcols = tabCols(activeTab);

        const cols = document.createElement("div");
        cols.className = "gg-cols";
        cols.appendChild(mkTable(IN_BLOCKS, false, true, tcols));
        cols.appendChild(mkTable(OUT_BLOCKS, true, true, tcols));
        content.appendChild(cols);

        const mid = document.createElement("div");
        mid.className = "gg-mid";
        mid.appendChild(mkTable(MID_BLOCKS, false, false, tcols));
        content.appendChild(mid);

        paintAll();
      };

      // タブ生成
      const tabEls = {};
      for (const t of TABS) {
        const tab = document.createElement("div");
        tab.className = "gg-tab" + (t === activeTab ? " gg-active" : "");
        tab.textContent = t;
        tab.addEventListener("click", (e) => {
          e.stopPropagation();
          activeTab = t;
          for (const k of Object.keys(tabEls)) {
            tabEls[k].classList.toggle("gg-active", k === t);
          }
          buildContent();
        });
        tabEls[t] = tab;
        tabbar.appendChild(tab);
      }

      // 一括ボタン(表示中のタブの親要素つまみだけに効く。サブは触らない)
      const bulk = (v) => {
        const elements = activeTab === "ALL" ? ELEMENTS : [activeTab];
        for (const b of ALL_BLOCKS) {
          for (const el of elements) {
            if (v === 0) {
              if (state[b]) delete state[b][el];
            } else {
              set(b, el, v);
            }
          }
          if (state[b] && !Object.keys(state[b]).length) delete state[b];
        }
        save();
        paintAll();
      };
      // SUB 0 = 表示中タブのサブ要素の上書きを全部消す(親に従う状態に戻す)
      const subClear = () => {
        const tabs = activeTab === "ALL" ? ELEMENTS : [activeTab];
        for (const t of tabs) {
          for (const [, key] of SUBS[t]) {
            for (const b of ALL_BLOCKS) {
              if (state[b]) {
                delete state[b][key];
                if (!Object.keys(state[b]).length) delete state[b];
              }
            }
          }
        }
        save();
        paintAll();
      };
      const mkBtn = (label, fn) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        toolbar.appendChild(btn);
      };
      mkBtn("SET 0", () => bulk(0));
      mkBtn("SET 0.5", () => bulk(0.5));
      mkBtn("SET 1", () => bulk(1));
      mkBtn("SUB 0", () => subClear());

      // サブ要素の上書きがある要素タブに「•」を付ける
      updateTabMarks = () => {
        const has = {};
        for (const b of Object.keys(state)) {
          for (const k of Object.keys(state[b] || {})) {
            if (state[b][k] && SUB_PARENT[k]) has[SUB_PARENT[k]] = true;
          }
        }
        for (const t of ELEMENTS) {
          tabEls[t].textContent = has[t] ? t + " •" : t;
        }
      };
      updateTabMarks();

      // --- プリセット(マトリクス全体を保存/適用) ---
      const sel = document.createElement("select");
      presetbar.appendChild(sel);
      sel.addEventListener("pointerdown", (e) => e.stopPropagation());

      let userPresets = {};
      let undoState = null; // 直前の適用で消えた状態(1段だけ戻せる)

      const rebuildOptions = (selected) => {
        sel.innerHTML = "";
        const opt = (value, label, parent) => {
          const o = document.createElement("option");
          o.value = value;
          o.textContent = label;
          (parent || sel).appendChild(o);
        };
        opt("", "PRESET...");
        if (undoState) opt("__undo__", "(適用前に戻す)");
        const gf = document.createElement("optgroup");
        gf.label = "定番カーブ(BASE=0)";
        sel.appendChild(gf);
        for (const name of Object.keys(FACTORY)) opt("f:" + name, "★" + name, gf);
        const names = Object.keys(userPresets).sort();
        if (names.length) {
          const gu = document.createElement("optgroup");
          gu.label = "ユーザー";
          sel.appendChild(gu);
          for (const name of names) opt("u:" + name, name, gu);
        }
        sel.value = selected || "";
        if (sel.selectedIndex < 0) sel.value = "";
      };

      const applyMatrix = (m, name) => {
        if (Object.keys(state).length) undoState = JSON.stringify(state);
        state = JSON.parse(JSON.stringify(m));
        save();
        paintAll();
        rebuildOptions(sel.value);
        info.textContent = "プリセット適用: " + name;
      };

      sel.addEventListener("change", (e) => {
        e.stopPropagation();
        const v = sel.value;
        if (!v) return;
        if (v === "__undo__") {
          const prev = JSON.parse(undoState);
          undoState = Object.keys(state).length ? JSON.stringify(state) : null;
          state = prev;
          save();
          paintAll();
          rebuildOptions("");
          info.textContent = "適用前の状態に戻した";
        } else if (v.startsWith("f:")) {
          applyMatrix(FACTORY[v.slice(2)](), v.slice(2));
        } else if (v.startsWith("u:")) {
          applyMatrix(userPresets[v.slice(2)] || {}, v.slice(2));
        }
      });

      const mkPresetBtn = (label, fn) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        presetbar.appendChild(btn);
      };
      mkPresetBtn("SAVE", () => {
        const cur = sel.value.startsWith("u:") ? sel.value.slice(2) : "";
        const name = (window.prompt("プリセット名(同名は上書き):", cur) || "").trim();
        if (!name) return;
        userPresets[name] = JSON.parse(JSON.stringify(state));
        persistUserPresets(userPresets);
        rebuildOptions("u:" + name);
        info.textContent = "プリセット保存: " + name;
      });
      mkPresetBtn("DEL", () => {
        if (!sel.value.startsWith("u:")) {
          info.textContent = "削除するユーザープリセットを選んでからDEL";
          return;
        }
        const name = sel.value.slice(2);
        if (!window.confirm("プリセット「" + name + "」を削除する?")) return;
        delete userPresets[name];
        persistUserPresets(userPresets);
        rebuildOptions("");
        info.textContent = "プリセット削除: " + name;
      });

      // --- 共有(取り込み/書き出し) ---
      // 取り込んだプリセットは保存した上で即つまみに反映する
      const importFiles = async (files) => {
        let lastName = null;
        let count = 0;
        for (const f of files) {
          let data;
          try {
            data = JSON.parse(await f.text());
          } catch (e) {
            info.textContent = "JSONとして読めなかった: " + f.name;
            continue;
          }
          const matrix = sanitizeMatrix(data.matrix || data);
          if (!matrix) {
            info.textContent = "プリセットとして読めなかった: " + f.name;
            continue;
          }
          let name = (typeof data.name === "string" && data.name.trim())
            || f.name.replace(/\.json$/i, "");
          if (userPresets[name] &&
              !window.confirm("「" + name + "」は既にある。上書きする?\n(キャンセル=別名で取り込む)")) {
            let i = 2;
            while (userPresets[name + " (" + i + ")"]) i++;
            name = name + " (" + i + ")";
          }
          userPresets[name] = matrix;
          lastName = name;
          count++;
        }
        if (!count) return;
        persistUserPresets(userPresets);
        rebuildOptions("u:" + lastName);
        applyMatrix(userPresets[lastName], lastName);
        info.textContent = "取り込んで適用: " + lastName
          + (count > 1 ? " (他" + (count - 1) + "件も保存)" : "");
      };

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json,application/json";
      fileInput.multiple = true;
      fileInput.style.display = "none";
      root.appendChild(fileInput);
      fileInput.addEventListener("change", () => {
        const files = [...fileInput.files];
        fileInput.value = "";
        importFiles(files);
      });
      mkPresetBtn("IMP", () => fileInput.click());

      mkPresetBtn("EXP", () => {
        let name;
        let matrix;
        const v = sel.value;
        if (v.startsWith("u:")) {
          name = v.slice(2);
          matrix = userPresets[name];
        } else if (v.startsWith("f:")) {
          name = v.slice(2);
          matrix = FACTORY[name]();
        } else {
          name = (window.prompt("書き出す名前(現在のつまみを書き出す):", "") || "").trim();
          if (!name) return;
          matrix = JSON.parse(JSON.stringify(state));
        }
        const data = { type: "recipe_merge_matrix_preset", version: 1,
                       name: name, matrix: matrix };
        const blob = new Blob([JSON.stringify(data, null, 2)],
                              { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name.replace(/[\\/:*?"<>|]/g, "_") + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        info.textContent = "書き出した: " + a.download;
      });

      // プリセットJSONをパネルに直接ドロップしても取り込める
      root.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      root.addEventListener("drop", (e) => {
        const files = [...(e.dataTransfer?.files || [])]
          .filter((f) => /\.json$/i.test(f.name));
        if (!files.length) return; // 関係ないドロップはComfyUI側に任せる
        e.preventDefault();
        e.stopPropagation();
        importFiles(files);
      });

      rebuildOptions("");
      loadUserPresets().then((p) => {
        userPresets = p || {};
        rebuildOptions(sel.value);
      });

      buildContent();

      this.addDOMWidget("matrix_ui", "gg_matrix_ui", root, {
        serialize: false,
        getMinHeight: () => 505,
      });
      // IN/OUT横並び+プリセットバー+下段が収まるサイズに
      this.size = [Math.max(this.size[0], 560),
                   Math.max(this.size[1], 570)];
    };

    // 保存済みワークフローを開いたとき、復元された値でつまみを描き直す
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      onConfigure?.apply(this, arguments);
      this._ggPaintAll?.();
    };
  },
});
