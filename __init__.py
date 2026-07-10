# -*- coding: utf-8 -*-
"""UNetをキー単位でマージするノード(A1111拡張SuperMergerにインスパイア)。

- ElementalMergeRecipe: テキストレシピで一括指定(要素マージ)
- BlockSlidersMerge:    MBW風ブロックスライダー + elemental欄で要素上書き
"""

import json

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


WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "ElementalMergeRecipe": ElementalMergeRecipe,
    "BlockSlidersMerge": BlockSlidersMerge,
    "ElementalMatrixMerge": ElementalMatrixMerge,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ElementalMergeRecipe": "Elemental Merge (Recipe)",
    "BlockSlidersMerge": "Block Sliders Merge (MBW)",
    "ElementalMatrixMerge": "Elemental Matrix Merge (Knobs)",
}
