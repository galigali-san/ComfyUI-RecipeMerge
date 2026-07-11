# -*- coding: utf-8 -*-
"""UNetをキー単位でマージ/LoRA適用するノード(A1111拡張SuperMergerにインスパイア)。

- ElementalMergeRecipe: テキストレシピで一括指定(要素マージ)
- BlockSlidersMerge:    MBW風ブロックスライダー + elemental欄で要素上書き
- ElementalMatrixMerge: つまみマトリクスUI
- LoraElementalApply:   LoRAをキー単位の強度で適用
"""

import json
import os
import re

import torch

import folder_paths
import comfy.lora
import comfy.lora_convert
import comfy.utils

from .recipe_parser import Rule, parse_recipe, ratio_for_key, build_report, \
    rules_from_matrix

_DEFAULT_RECIPE = """# 比率は model2 を混ぜる割合 (0.0=model1のまま, 1.0=model2)
0.5

# 例:
# attn2:0.8            全ブロックのattn2だけ強くmodel2へ
# NOT attn2:0.3        attn2以外を薄めに
# IN04:attn2:0.9       IN04のattn2だけ狙い撃ち
# OUT*:ff:0.2          OUT側のffだけ
# attn2:__VAL__        sweep_valueの値が入る(XYプロット用)
"""

# SuperMergerのMBW配列と同じ並び(SD1.5フル。SDXLはIN09〜/OUT09〜が未使用)
_BLOCKS = (["BASE"]
           + ["IN%02d" % i for i in range(12)]
           + ["M00"]
           + ["OUT%02d" % i for i in range(12)])


def _apply_merge(model1, model2, default, rules):
    """キーごとに比率を決めてパッチ適用。(マージ済みmodel, report) を返す。"""
    m = model1.clone()
    kp = model2.get_key_patches("diffusion_model.")
    prefix = "diffusion_model."

    total = 0
    default_hits = 0
    for k in kp:
        key_unet = k[len(prefix):] if k.startswith(prefix) else k
        ratio, winner = ratio_for_key(key_unet, default, rules)
        total += 1
        if winner is None:
            default_hits += 1
        else:
            winner.hits += 1
        if ratio == 0.0:
            continue  # model1のまま
        m.add_patches({k: kp[k]}, ratio, 1.0 - ratio)

    report = build_report(default, rules, total, default_hits)
    return m, report


class ElementalMergeRecipe:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model1": ("MODEL",),
                "model2": ("MODEL",),
                "recipe": ("STRING", {"multiline": True,
                                      "default": _DEFAULT_RECIPE}),
                "sweep_value": ("FLOAT", {"default": 0.5, "min": -1.0,
                                          "max": 2.0, "step": 0.001,
                                          "tooltip": u"レシピ内の __VAL__ を"
                                          u"この値で置換。XYプロットから"
                                          u"入力に変換して流し込む"}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "merge"
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"テキストレシピでUNetをキー単位マージする(要素マージ)。"
                   u"比率はmodel2の割合。reportに各ルールの適用キー数が出る。")

    def merge(self, model1, model2, recipe, sweep_value):
        default, rules = parse_recipe(recipe, sweep_value)
        m, report = _apply_merge(model1, model2, default, rules)
        print("[ElementalMergeRecipe]\n" + report)
        return (m, report)


class BlockSlidersMerge:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "model1": ("MODEL",),
            "model2": ("MODEL",),
        }
        for b in _BLOCKS:
            required[b] = ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0,
                                     "step": 0.01, "display": "slider"})
        required["elemental"] = ("STRING", {
            "multiline": True, "default": "",
            "tooltip": u"要素の上書き(例: attn2:0.8 / IN04:attn2:0.9)。"
                       u"スライダーより優先される。空でもOK"})
        required["sweep_value"] = ("FLOAT", {
            "default": 0.5, "min": -1.0, "max": 2.0, "step": 0.001,
            "tooltip": u"elemental内の __VAL__ を置換(XYプロット用)"})
        return {"required": required}

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "merge"
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"MBW風。ブロックごとのスライダーで階層マージし、"
                   u"elemental欄の記述(attn2:0.8等)がスライダーを上書きする。"
                   u"比率はmodel2の割合。")

    def merge(self, model1, model2, elemental, sweep_value, **block_values):
        # スライダー由来のルール(line_no=0)。全キーがどれか1つのブロックに属する
        rules = [Rule([b], None, False, float(block_values[b]), 0,
                      u"%s:%.3f (slider)" % (b, float(block_values[b])))
                 for b in _BLOCKS]

        # elemental欄のルールを後ろに足す。ブロック+要素(優先度2)はスライダー
        # (優先度1)に勝ち、要素のみ(優先度1)も後勝ちルールでスライダーに勝つ
        _, elem_rules = parse_recipe(elemental, sweep_value)
        rules += elem_rules

        m, report = _apply_merge(model1, model2, 0.0, rules)
        print("[BlockSlidersMerge]\n" + report)
        return (m, report)


class ElementalMatrixMerge:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model1": ("MODEL",),
                "model2": ("MODEL",),
                # つまみUI(web/elemental_matrix.js)がJSONで書き込む。
                # UIが無い環境では手でJSONを書いても動く
                "matrix": ("STRING", {"default": "{}", "multiline": False}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "merge"
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"ブロック(BASE/IN/M/OUT)×要素(attn1/attn2/ff/norm/proj/"
                   u"other)の全マトリクスをつまみで指定するマージ。"
                   u"要素タブではサブ要素(to_q/to_k等)を個別に上書きできる"
                   u"(サブ0=親要素に従う)。"
                   u"比率はmodel2の割合。つまみ0=model1のまま。")

    def merge(self, model1, model2, matrix):
        try:
            data = json.loads(matrix) if matrix.strip() else {}
        except ValueError:
            raise ValueError(u"matrixがJSONとして読めません: %.80s" % matrix)
        if not isinstance(data, dict):
            raise ValueError(u"matrixはオブジェクトである必要があります")
        rules = rules_from_matrix(data)
        m, report = _apply_merge(model1, model2, 0.0, rules)
        print("[ElementalMatrixMerge]\n" + report)
        return (m, report)


_DEFAULT_LORA_RECIPE = """# LoRAの適用強度(0=そのキーに適用しない。マイナスや1超えもOK)
1.0

# 例:
# ff:0.0             質感への影響を切る
# attn2:1.2          プロンプト反応だけ強める
# OUT*:norm:0.5      OUT側のnormだけ半分
# attn2:__VAL__      sweep_valueでスイープ(XYプロット用)
"""


class LoraElementalApply:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (folder_paths.get_filename_list("loras"),),
                "recipe": ("STRING", {"multiline": True,
                                      "default": _DEFAULT_LORA_RECIPE}),
                "strength_clip": ("FLOAT", {
                    "default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01,
                    "tooltip": u"テキストエンコーダ部分の適用強度"
                               u"(clip未接続なら無視)"}),
                "sweep_value": ("FLOAT", {"default": 1.0, "min": -10.0,
                                          "max": 10.0, "step": 0.001,
                                          "tooltip": u"レシピ内の __VAL__ を"
                                          u"この値で置換(XYプロット用)"}),
            },
            "optional": {
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "report")
    FUNCTION = "apply"
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"LoRAをUNetのキー単位の強度で適用する(要素マージのLoRA版)。"
                   u"レシピの数値は適用強度で、0=そのキーには適用しない。"
                   u"デフォルト行が全体の基本強度。テキストエンコーダ部分は"
                   u"strength_clipで一律適用。")

    def apply(self, model, lora_name, recipe, strength_clip, sweep_value,
              clip=None):
        default, rules = parse_recipe(recipe, sweep_value)
        if not recipe.strip() or default is None:
            default = 1.0
        m, new_clip, report = _apply_lora_rules(
            model, clip, lora_name, default, rules, strength_clip)
        print("[LoraElementalApply] %s\n%s" % (lora_name, report))
        return (m, new_clip, report)


def _apply_lora_rules(model, clip, lora_name, default, rules, strength_clip):
    """LoRAを読み込み、UNetキーごとにルールで決めた強度で適用する。"""
    lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
    lora = comfy.lora_convert.convert_lora(lora)

    key_map = comfy.lora.model_lora_keys_unet(model.model, {})
    if clip is not None:
        key_map = comfy.lora.model_lora_keys_clip(
            clip.cond_stage_model, key_map)
    loaded = comfy.lora.load_lora(lora, key_map)

    prefix = "diffusion_model."
    m = model.clone()
    total = 0
    default_hits = 0
    for k in loaded:
        if not k.startswith(prefix):
            continue
        total += 1
        ratio, winner = ratio_for_key(k[len(prefix):], default, rules)
        if winner is None:
            default_hits += 1
        else:
            winner.hits += 1
        if ratio == 0.0:
            continue  # このキーにはLoRAを適用しない
        m.add_patches({k: loaded[k]}, ratio)

    new_clip = None
    if clip is not None:
        new_clip = clip.clone()
        new_clip.add_patches(loaded, strength_clip)

    report = build_report(default, rules, total, default_hits)
    if total == 0:
        report = (u"★UNet部分のキーが1つもありません"
                  u"(テキストエンコーダ専用LoRA?)\n") + report
    return m, new_clip, report


class LoraElementalMatrix:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_name": (folder_paths.get_filename_list("loras"),),
                # つまみUI(web/elemental_matrix.js)がJSONで書き込む
                "matrix": ("STRING", {"default": "{}", "multiline": False}),
                "strength_clip": ("FLOAT", {
                    "default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01,
                    "tooltip": u"テキストエンコーダ部分の適用強度"
                               u"(clip未接続なら無視)"}),
            },
            "optional": {
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "report")
    FUNCTION = "apply"
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"LoRAをブロック×要素のつまみで決めた強度で適用する。"
                   u"新規作成時は全つまみ1.0(=普通のLoRA適用)。"
                   u"切りたい要素を0に下げる。つまみ0=そのキーに適用しない。"
                   u"1超えやマイナスが要るときはRecipe版を使う。")

    def apply(self, model, lora_name, matrix, strength_clip, clip=None):
        try:
            data = json.loads(matrix) if matrix.strip() else {}
        except ValueError:
            raise ValueError(u"matrixがJSONとして読めません: %.80s" % matrix)
        if not isinstance(data, dict):
            raise ValueError(u"matrixはオブジェクトである必要があります")
        rules = rules_from_matrix(data)
        m, new_clip, report = _apply_lora_rules(
            model, clip, lora_name, 0.0, rules, strength_clip)
        print("[LoraElementalMatrix] %s\n%s" % (lora_name, report))
        return (m, new_clip, report)


# --- LoRA同士のマージ(concat方式) ---
# diffusers形式のキー名(lora_unet_down_blocks_1_attentions_0_...)を
# kohya形式(lora_unet_input_blocks_4_1_...)に変換する。
# 住所の対応: down a,attn b -> input 3a+b+1 (slot1) / resnets -> slot0
#            mid attn -> middle 1 / mid res b -> middle 2b
#            up a,attn b -> output 3a+b (slot1) / resnets -> slot0
_DIFF_RES_RENAME = (
    ("conv1", "in_layers_2"), ("conv2", "out_layers_3"),
    ("norm1", "in_layers_0"), ("norm2", "out_layers_0"),
    ("time_emb_proj", "emb_layers_1"), ("conv_shortcut", "skip_connection"),
)


def _diffusers_to_kohya(name):
    """lora_unet_ 以降のdiffusers形式の名前をkohya形式に。不可ならNone。"""
    def res(rest):
        for a, b in _DIFF_RES_RENAME:
            if rest.startswith(a):
                return b + rest[len(a):]
        return rest

    m = re.match(r"down_blocks_(\d+)_attentions_(\d+)_(.*)$", name)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return "input_blocks_%d_1_%s" % (3 * a + b + 1, m.group(3))
    m = re.match(r"down_blocks_(\d+)_resnets_(\d+)_(.*)$", name)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return "input_blocks_%d_0_%s" % (3 * a + b + 1, res(m.group(3)))
    m = re.match(r"down_blocks_(\d+)_downsamplers_0_conv(.*)$", name)
    if m:
        return "input_blocks_%d_0_op%s" % (3 * (int(m.group(1)) + 1),
                                           m.group(2))
    m = re.match(r"mid_block_attentions_0_(.*)$", name)
    if m:
        return "middle_block_1_%s" % m.group(1)
    m = re.match(r"mid_block_resnets_(\d+)_(.*)$", name)
    if m:
        return "middle_block_%d_%s" % (2 * int(m.group(1)), res(m.group(2)))
    m = re.match(r"up_blocks_(\d+)_attentions_(\d+)_(.*)$", name)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return "output_blocks_%d_1_%s" % (3 * a + b, m.group(3))
    m = re.match(r"up_blocks_(\d+)_resnets_(\d+)_(.*)$", name)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return "output_blocks_%d_0_%s" % (3 * a + b, res(m.group(3)))
    return None

# kohya形式のキー名(lora_unet_input_blocks_4_1_...)をUNetのドット区切りに戻す。
# アンダースコアを含むモジュール名は先に保護してから "_"→"." する
_LORA_PROTECTED_TOKENS = [
    "input_blocks", "output_blocks", "middle_block", "transformer_blocks",
    "to_q", "to_k", "to_v", "to_out", "proj_in", "proj_out",
    "in_layers", "out_layers", "emb_layers", "skip_connection",
    "time_embed", "label_emb",
]


def _lora_name_to_unet_key(name):
    s = name
    repl = {}
    for i, tok in enumerate(_LORA_PROTECTED_TOKENS):
        ph = "\x00%d\x00" % i
        if tok in s:
            s = s.replace(tok, ph)
            repl[ph] = tok
    s = s.replace("_", ".")
    for ph, tok in repl.items():
        s = s.replace(ph, tok)
    return s


def _group_lora_keys(sd):
    """{ベース名: {"down": t, "up": t, "alpha": t, ...}} にまとめる。"""
    groups = {}
    for k, v in sd.items():
        for suffix, part in ((".lora_down.weight", "down"),
                             (".lora_up.weight", "up"),
                             (".alpha", "alpha"),
                             (".lora_mid.weight", "mid"),
                             (".dora_scale", "dora")):
            if k.endswith(suffix):
                groups.setdefault(k[:-len(suffix)], {})[part] = v
                break
        else:
            groups.setdefault(k, {})["other"] = v
    return groups


def _concat_side(g, w, downs, ups):
    """片側のLoRAを重みwでconcat用リストに積む。戻り値=追加したランク数。"""
    down = g["down"].to(torch.float32)
    up = g["up"].to(torch.float32)
    r = down.shape[0]
    alpha = float(g["alpha"]) if "alpha" in g else float(r)
    s = (w * alpha / r) ** 0.5
    downs.append(down * s)
    ups.append(up * s)
    return r


class LoraMergeMatrix:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora1_name": (folder_paths.get_filename_list("loras"),),
                "lora2_name": (folder_paths.get_filename_list("loras"),),
                # つまみUI(web/elemental_matrix.js)がJSONで書き込む
                "matrix": ("STRING", {"default": "{}", "multiline": False}),
                "te_ratio": ("FLOAT", {
                    "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01,
                    "tooltip": u"テキストエンコーダ部分のlora2の割合"
                               u"(ブロック分けできないので一律)"}),
                "filename": ("STRING", {"default": "merged_lora"}),
                "save_file": ("BOOLEAN", {
                    "default": False,
                    "tooltip": u"ONで新しいLoRAファイルとして保存。"
                               u"OFFならmodel/clipに直接適用するだけ"
                               u"(生成しながらつまみを試すモード)"}),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "report")
    FUNCTION = "merge"
    OUTPUT_NODE = True
    CATEGORY = "advanced/model_merging"
    DESCRIPTION = (u"LoRA同士をキー単位の比率でマージする(モデル不要の"
                   u"concat方式=劣化なし、dimは2つの合計まで増える)。"
                   u"つまみはlora2の割合(0=lora1のみ/1=lora2のみ)。"
                   u"model/clipを繋ぐとマージ結果をその場で適用できるので、"
                   u"生成しながらつまみを調整→納得したらsave_fileをONにして"
                   u"lorasフォルダに保存、という流れで使える。")

    def merge(self, lora1_name, lora2_name, matrix, te_ratio, filename,
              save_file, model=None, clip=None):
        if not save_file and model is None:
            raise ValueError(
                u"modelが未接続でsave_fileもOFFなので、やることがありません。"
                u"試し生成するならmodel(とclip)を繋ぐ、"
                u"ファイルに保存するならsave_fileをONに")
        try:
            data = json.loads(matrix) if matrix.strip() else {}
        except ValueError:
            raise ValueError(u"matrixがJSONとして読めません: %.80s" % matrix)
        rules = rules_from_matrix(data if isinstance(data, dict) else {})

        notes = []

        def load(name):
            path = folder_paths.get_full_path_or_raise("loras", name)
            sd = comfy.utils.load_torch_file(path, safe_load=True)
            # diffusers形式のキー名はkohya形式に変換して取り込む
            diff = [k for k in sd
                    if re.match(r"lora_unet_(down_blocks|up_blocks|mid_block)",
                                k)]
            if diff:
                converted = {}
                dropped = 0
                for k, v in sd.items():
                    if k.startswith("lora_unet_"):
                        nk = _diffusers_to_kohya(k[len("lora_unet_"):])
                        if nk is None:
                            m = re.match(
                                r"lora_unet_(down_blocks|up_blocks|mid_block)",
                                k)
                            if m:
                                dropped += 1
                                continue  # 変換できないUNetキーは除外
                            converted[k] = v  # 元からkohya形式ならそのまま
                        else:
                            converted["lora_unet_" + nk] = v
                    else:
                        converted[k] = v  # TE側はそのまま
                sd = converted
                notes.append(u"%s: diffusers形式→kohya形式にキー名を変換"
                             u"(%d個変換, 変換不可%d個除外)"
                             % (name, len(diff) - dropped, dropped))
            return _group_lora_keys(sd)

        g1 = load(lora1_name)
        g2 = load(lora2_name)

        out = {}
        stats = {"paired": 0, "only1": 0, "only2": 0, "skipped": 0,
                 "dropped": 0}
        total = 0
        default_hits = 0
        max_rank = 0

        for base in sorted(set(g1) | set(g2)):
            a = g1.get(base)
            b = g2.get(base)
            # down/upが揃っていない付随キー(dora等)や特殊構成はスキップ
            def usable(g):
                return g is not None and "down" in g and "up" in g \
                    and "mid" not in g and "dora" not in g
            if not usable(a) and not usable(b):
                if (a and set(a) - {"other"}) or (b and set(b) - {"other"}):
                    stats["skipped"] += 1
                continue

            if base.startswith("lora_unet_"):
                key_unet = _lora_name_to_unet_key(base[len("lora_unet_"):])
                total += 1
                t, winner = ratio_for_key(key_unet, 0.0, rules)
                if winner is None:
                    default_hits += 1
                else:
                    winner.hits += 1
                t = min(max(float(t), 0.0), 1.0)
            else:
                t = min(max(float(te_ratio), 0.0), 1.0)

            downs, ups = [], []
            rank = 0
            if usable(a) and (1.0 - t) > 0.0:
                rank += _concat_side(a, 1.0 - t, downs, ups)
            if usable(b) and t > 0.0:
                rank += _concat_side(b, t, downs, ups)
            if not downs:
                stats["dropped"] += 1  # 比率で片側0になり中身が消えた
                continue
            try:
                new_down = torch.cat(downs, dim=0)
                new_up = torch.cat(ups, dim=1)
            except RuntimeError:
                stats["skipped"] += 1  # 形が合わない(構成違い)
                continue

            dtype = (a or b)["down"].dtype
            out[base + ".lora_down.weight"] = new_down.to(dtype)
            out[base + ".lora_up.weight"] = new_up.to(dtype)
            out[base + ".alpha"] = torch.tensor(float(rank))
            max_rank = max(max_rank, rank)
            if usable(a) and usable(b):
                stats["paired"] += 1
            elif usable(a):
                stats["only1"] += 1
            else:
                stats["only2"] += 1

        if not out:
            raise ValueError(u"マージ結果が空です(比率が全部0/構成が非対応?)")

        # model/clipが繋がっていれば、マージ結果をその場で適用(試し生成用)
        new_model = None
        new_clip = None
        if model is not None:
            key_map = comfy.lora.model_lora_keys_unet(model.model, {})
            if clip is not None:
                key_map = comfy.lora.model_lora_keys_clip(
                    clip.cond_stage_model, key_map)
            loaded = comfy.lora.load_lora(
                comfy.lora_convert.convert_lora(out), key_map)
            new_model = model.clone()
            new_model.add_patches(loaded, 1.0)
            if clip is not None:
                new_clip = clip.clone()
                new_clip.add_patches(loaded, 1.0)

        # save_file ONのときだけファイルに保存(同名があれば連番を付ける)
        saved = u"(ファイル保存なし: save_file=OFF)"
        if save_file:
            safe = re.sub(r'[\\/:*?"<>|]', "_",
                          filename.strip()) or "merged_lora"
            lora_dir = folder_paths.get_folder_paths("loras")[0]
            path = os.path.join(lora_dir, safe + ".safetensors")
            n = 1
            while os.path.exists(path):
                path = os.path.join(lora_dir, "%s_%d.safetensors" % (safe, n))
                n += 1
            metadata = {"recipemerge": json.dumps(
                {"lora1": lora1_name, "lora2": lora2_name,
                 "te_ratio": te_ratio, "matrix": data}, ensure_ascii=False)}
            comfy.utils.save_torch_file(out, path, metadata=metadata)
            saved = u"保存: %s" % os.path.basename(path)

        report = build_report(0.0, rules, total, default_hits)
        if notes:
            report = u"\n".join(notes) + u"\n" + report
        report = (u"%s\n両方にあるキー:%d / lora1のみ:%d / lora2のみ:%d"
                  u" / 比率0で削除:%d / 非対応スキップ:%d / 最大dim:%d\n"
                  u"(比率はlora2の割合。デフォルト0.0=lora1のまま)\n"
                  % (saved, stats["paired"], stats["only1"],
                     stats["only2"], stats["dropped"], stats["skipped"],
                     max_rank)) + report
        print("[LoraMergeMatrix]\n" + report)
        return (new_model, new_clip, report)


WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "ElementalMergeRecipe": ElementalMergeRecipe,
    "BlockSlidersMerge": BlockSlidersMerge,
    "ElementalMatrixMerge": ElementalMatrixMerge,
    "LoraElementalApply": LoraElementalApply,
    "LoraElementalMatrix": LoraElementalMatrix,
    "LoraMergeMatrix": LoraMergeMatrix,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ElementalMergeRecipe": "Elemental Merge (Recipe)",
    "BlockSlidersMerge": "Block Sliders Merge (MBW)",
    "ElementalMatrixMerge": "Elemental Matrix Merge (Knobs)",
    "LoraElementalApply": "LoRA Elemental Apply (Recipe)",
    "LoraElementalMatrix": "LoRA Elemental Matrix (Knobs)",
    "LoraMergeMatrix": "LoRA Merge (Knobs)",
}
