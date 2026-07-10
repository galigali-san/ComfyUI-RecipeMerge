# -*- coding: utf-8 -*-
"""recipe_parser の単体テスト。ComfyUI不要、素のPythonで動く:
    python test_parser.py
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from recipe_parser import (parse_recipe, ratio_for_key, block_label,
                           rules_from_matrix, RecipeError)

# SDXL/SD1.5風の代表的なUNetキー(diffusion_model.除去済み)
KEYS = {
    "conv_in":    "input_blocks.0.0.weight",
    "in4_attn2":  "input_blocks.4.1.transformer_blocks.0.attn2.to_q.weight",
    "in4_attn1":  "input_blocks.4.1.transformer_blocks.0.attn1.to_k.weight",
    "in7_ff":     "input_blocks.7.1.transformer_blocks.2.ff.net.0.proj.weight",
    "mid_attn2":  "middle_block.1.transformer_blocks.3.attn2.to_v.weight",
    "out2_attn2": "output_blocks.2.1.transformer_blocks.1.attn2.to_out.0.weight",
    "out5_ff":    "output_blocks.5.1.transformer_blocks.0.ff.net.2.weight",
    "time":       "time_embed.0.weight",
    "out_final":  "out.2.weight",
    "in4_norm1":  "input_blocks.4.1.transformer_blocks.0.norm1.weight",
    "in4_conv":   "input_blocks.4.0.in_layers.2.weight",
    "in4_attn2v": "input_blocks.4.1.transformer_blocks.0.attn2.to_v.weight",
    "in4_emb":    "input_blocks.4.0.emb_layers.1.weight",
}


def resolve(recipe, key, sweep=None):
    default, rules = parse_recipe(recipe, sweep)
    ratio, _ = ratio_for_key(KEYS[key], default, rules)
    return ratio


def check(name, actual, expected):
    ok = abs(actual - expected) < 1e-6
    print("%s %-28s actual=%.4f expected=%.4f"
          % ("OK " if ok else "NG!", name, actual, expected))
    assert ok, name


# --- block_label ---
assert block_label(KEYS["in4_attn2"]) == "IN04"
assert block_label(KEYS["mid_attn2"]) == "M00"
assert block_label(KEYS["out2_attn2"]) == "OUT02"
assert block_label(KEYS["time"]) == "BASE"
assert block_label(KEYS["out_final"]) == "BASE"
print("OK  block_label")

# --- デフォルトのみ ---
check("default only", resolve("0.5", "in4_attn2"), 0.5)
check("default omitted -> 0", resolve("# nothing", "in4_attn2"), 0.0)

# --- 要素の横断指定 ---
r = "0.5\nattn2:0.8"
check("attn2 cross-cut hit", resolve(r, "in4_attn2"), 0.8)
check("attn2 cross-cut hit(mid)", resolve(r, "mid_attn2"), 0.8)
check("attn1 falls to default", resolve(r, "in4_attn1"), 0.5)

# --- NOT除外 ---
r = "attn2:0.8\nNOT attn2:0.3"
check("NOT: attn2 keeps 0.8", resolve(r, "out2_attn2"), 0.8)
check("NOT: others get 0.3", resolve(r, "in7_ff"), 0.3)
check("NOT: conv gets 0.3", resolve(r, "conv_in"), 0.3)

# --- ブロック+要素の狙い撃ちが横断指定に勝つ ---
r = "0.5\nattn2:0.8\nIN04:attn2:0.9"
check("IN04:attn2 wins", resolve(r, "in4_attn2"), 0.9)
check("other attn2 stays 0.8", resolve(r, "out2_attn2"), 0.8)

# --- ワイルドカード ---
r = "0.5\nIN*:0.4"
check("IN* hits IN07", resolve(r, "in7_ff"), 0.4)
check("IN* misses OUT05", resolve(r, "out5_ff"), 0.5)
check("IN* misses BASE", resolve(r, "time"), 0.5)

# --- カンマ区切り ---
r = "0.5\nIN04,OUT02:attn2,attn1:0.7"
check("comma blocks+elems 1", resolve(r, "in4_attn1"), 0.7)
check("comma blocks+elems 2", resolve(r, "out2_attn2"), 0.7)
check("comma no hit", resolve(r, "mid_attn2"), 0.5)

# --- 同じ優先度なら後の行が勝つ ---
r = "attn2:0.8\nattn2:0.2"
check("later line wins", resolve(r, "in4_attn2"), 0.2)

# --- 深い要素指定 ---
r = "0.5\nattn2.to_q:0.9"
check("attn2.to_q hits to_q", resolve(r, "in4_attn2"), 0.9)
check("attn2.to_q misses to_v", resolve(r, "mid_attn2"), 0.5)

# --- 前方一致(SuperMergerの部分一致相当) ---
r = "0.5\nattn:0.6"
check("attn hits attn1", resolve(r, "in4_attn1"), 0.6)
check("attn hits attn2", resolve(r, "in4_attn2"), 0.6)
check("attn misses ff", resolve(r, "in7_ff"), 0.5)
r = "0.5\nnorm:0.4"
check("norm hits norm1", resolve(r, "in4_norm1"), 0.4)
check("norm misses attn", resolve(r, "in4_attn2"), 0.5)

# --- __VAL__ 置換 ---
r = "0.5\nattn2:__VAL__"
check("__VAL__ sweep 0.25", resolve(r, "in4_attn2", sweep=0.25), 0.25)

# --- エラー系 ---
for bad in ["attn2:abc", "a:b:c:0.5", "IN99x:0.5"]:
    try:
        parse_recipe(bad)
        raise AssertionError("should have raised: " + bad)
    except RecipeError:
        print("OK  error raised: %s" % bad)

try:
    parse_recipe("attn2:__VAL__")  # sweep未指定
    raise AssertionError("should have raised __VAL__")
except RecipeError:
    print("OK  error raised: __VAL__ without sweep")

# --- つまみマトリクス ---
def resolve_m(matrix, key):
    rules = rules_from_matrix(matrix)
    ratio, _ = ratio_for_key(KEYS[key], 0.0, rules)
    return ratio

m = {"IN04": {"attn2": 0.8, "other": 0.5}}
check("matrix attn2 knob", resolve_m(m, "in4_attn2"), 0.8)
check("matrix other -> conv only", resolve_m(m, "in4_conv"), 0.5)
check("matrix attn1 shielded to 0", resolve_m(m, "in4_attn1"), 0.0)
check("matrix norm shielded to 0", resolve_m(m, "in4_norm1"), 0.0)
check("matrix untouched block", resolve_m(m, "out2_attn2"), 0.0)

m = {"OUT02": {"ff": 1.5}}   # 範囲外はクランプ
check("matrix clamp to 1.0", resolve_m({"IN07": {"ff": 1.5}}, "in7_ff"), 1.0)

m = {"M00": {"other": 0.7}}
check("matrix M00 other", resolve_m(m, "mid_attn2"), 0.0)  # attn2はシールド
check("matrix M00 ff shielded", resolve_m(m, "in7_ff"), 0.0)

m = {"BASE": {"other": 0.3}}
check("matrix BASE other", resolve_m(m, "time"), 0.3)

# 全0のブロックはルール0本
assert rules_from_matrix({"IN04": {"attn2": 0}}) == []
print("OK  matrix: all-zero block -> no rules")

# --- サブ要素つまみ(要素タブの列分割) ---
# サブ要素は親要素のつまみを上書きする
m = {"IN04": {"attn2": 0.8, "attn2.to_q": 0.3}}
check("matrix sub overrides parent", resolve_m(m, "in4_attn2"), 0.3)
check("matrix sibling keeps parent", resolve_m(m, "in4_attn2v"), 0.8)

# サブ0は保存されていてもルールを出さない=親に従う
m = {"IN04": {"attn2": 0.8, "attn2.to_v": 0.0}}
check("matrix sub zero inherits", resolve_m(m, "in4_attn2v"), 0.8)

# 親0(シールド)でもサブは狙い撃てる
m = {"IN04": {"other": 0.5, "attn2.to_q": 0.9}}
check("matrix sub w/ shielded parent", resolve_m(m, "in4_attn2"), 0.9)
check("matrix shield stays on to_v", resolve_m(m, "in4_attn2v"), 0.0)

# otherのサブ(in_layers等)はotherのブロック全体ルールに勝つ
m = {"IN04": {"other": 0.2, "in_layers": 0.9}}
check("matrix other sub in_layers", resolve_m(m, "in4_conv"), 0.9)
check("matrix other rest keeps 0.2", resolve_m(m, "in4_emb"), 0.2)

# ffのサブ(net.0 / net.2)
m = {"IN07": {"ff": 0.5, "ff.net.0": 0.1}}
check("matrix ff.net.0 sub", resolve_m(m, "in7_ff"), 0.1)

# normのサブ(norm1)
m = {"IN04": {"norm": 0.6, "norm1": 0.9}}
check("matrix norm1 sub", resolve_m(m, "in4_norm1"), 0.9)

# サブだけ非0のブロックもルールが出る(他要素はシールド0)
m = {"IN04": {"attn2.to_q": 0.9}}
check("matrix sub-only block hit", resolve_m(m, "in4_attn2"), 0.9)
check("matrix sub-only block shield", resolve_m(m, "in4_attn1"), 0.0)

# サブも含めて全0ならルール0本
assert rules_from_matrix({"IN04": {"attn2.to_q": 0}}) == []
print("OK  matrix: all-zero incl sub -> no rules")

print("\nALL TESTS PASSED")
