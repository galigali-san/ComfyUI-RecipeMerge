# -*- coding: utf-8 -*-
"""要素マージ用テキストレシピのパーサとキーマッチング。

ComfyUIに依存しない純粋ロジックなので、単体でテストできる。

レシピ文法(1行1ルール、#以降はコメント):

    0.5                 デフォルト比率(未指定キー全部)
    attn2:0.8           要素の横断指定(全ブロックのattn2)
    NOT attn2:0.3       除外指定(attn2以外の全キー)
    IN04:attn2:0.9      ブロック+要素の狙い撃ち
    IN*:0.4             ブロックのワイルドカード指定
    IN00,IN01:ff:0.2    カンマ区切りで複数指定
    attn2:__VAL__       プレースホルダー(sweep_value入力で置換)

比率は「model2を混ぜる割合」。
0.0 = model1のまま / 1.0 = model2に置き換え。

優先度: ブロック+要素(2) > どちらか片方(1) > デフォルト(0)。
同じ優先度で複数マッチしたら、後に書いた行が勝つ。
"""

import fnmatch
import re

# ブロック指定トークン(大文字限定。要素名 attn/ff/norm 等と衝突させない)
_BLOCK_TOKEN = re.compile(r"(IN|OUT|M|BASE)[0-9*]*$")
_NOT_PREFIX = re.compile(r"^NOT\s+")


class RecipeError(ValueError):
    pass


class Rule(object):
    def __init__(self, blocks, elements, negate, ratio, line_no, text):
        self.blocks = blocks        # None または ["IN04", "OUT*", ...]
        self.elements = elements    # None または ["attn2", "ff.net", ...]
        self.negate = negate
        self.ratio = ratio
        self.line_no = line_no
        self.text = text
        self.specificity = (blocks is not None) + (elements is not None)
        self.hits = 0               # このルールが適用されたキー数(レポート用)


def _normalize_block(tok, line_no):
    tok = tok.strip()
    if not tok:
        raise RecipeError(u"%d行目: 空のブロック名があります" % line_no)
    if "*" in tok:
        return tok  # ワイルドカードはそのまま(fnmatchで照合)
    if tok == "M" or tok == "M00":
        return "M00"
    if tok == "BASE":
        return "BASE"
    m = re.match(r"(IN|OUT)(\d+)$", tok)
    if m:
        return "%s%02d" % (m.group(1), int(m.group(2)))
    raise RecipeError(u"%d行目: ブロック名が不正です: %s" % (line_no, tok))


def _is_block_spec(part):
    # UNetのキーは全部小文字なので、大文字で始まるトークンが1つでもあれば
    # ブロック指定とみなす(その後の検証でタイポはエラーになる)
    toks = [t.strip() for t in part.split(",")]
    return any(t[:1].isupper() for t in toks if t)


def parse_recipe(text, sweep_value=None):
    """レシピ文字列を (デフォルト比率, [Rule, ...]) に変換する。"""
    if sweep_value is not None:
        text = text.replace("__VAL__", "%.6f" % float(sweep_value))

    default = None
    rules = []

    for line_no, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue

        # 数値だけの行 = デフォルト比率
        try:
            default = float(line)
            continue
        except ValueError:
            pass

        if "__VAL__" in line:
            raise RecipeError(
                u"%d行目: __VAL__ が残っています(sweep_valueが未指定?)" % line_no)

        negate = bool(_NOT_PREFIX.match(line))
        body = _NOT_PREFIX.sub("", line)

        parts = [p.strip() for p in body.split(":")]
        if len(parts) < 2 or len(parts) > 3:
            raise RecipeError(
                u"%d行目: 書式が不正です(spec:比率 か ブロック:要素:比率): %s"
                % (line_no, raw.strip()))

        try:
            ratio = float(parts[-1])
        except ValueError:
            raise RecipeError(
                u"%d行目: 比率が数値ではありません: %s" % (line_no, parts[-1]))

        blocks = None
        elements = None
        if len(parts) == 3:
            blocks = [_normalize_block(t, line_no)
                      for t in parts[0].split(",") if t.strip()]
            elements = [t.strip() for t in parts[1].split(",") if t.strip()]
            if not blocks or not elements:
                raise RecipeError(u"%d行目: ブロック/要素が空です" % line_no)
        else:
            spec = parts[0]
            if _is_block_spec(spec):
                blocks = [_normalize_block(t, line_no)
                          for t in spec.split(",") if t.strip()]
            else:
                elements = [t.strip() for t in spec.split(",") if t.strip()]

        rules.append(Rule(blocks, elements, negate, ratio, line_no, line))

    if default is None:
        default = 0.0  # 未指定キーはmodel1のまま
    return default, rules


def block_label(key_unet):
    """UNetキー名(diffusion_model.プレフィックス除去済み)をブロック名にする。"""
    parts = key_unet.split(".")
    try:
        if parts[0] == "input_blocks":
            return "IN%02d" % int(parts[1])
        if parts[0] == "middle_block":
            return "M00"
        if parts[0] == "output_blocks":
            return "OUT%02d" % int(parts[1])
    except (IndexError, ValueError):
        pass
    return "BASE"  # time_embed, label_emb, out. など(DiT系モデルも全部ここ)


def _element_matches(element, key_segs):
    """要素指定("attn2" や "attn2.to_q")がキーのセグメント列に連続一致するか。

    各セグメントは前方一致。
    "attn"はattn1/attn2両方、"norm"はnorm1〜norm3に当たる。
    """
    el = element.split(".")
    n = len(el)
    for i in range(len(key_segs) - n + 1):
        if all(key_segs[i + j].startswith(el[j]) for j in range(n)):
            return True
    return False


def _rule_matches(rule, key_unet, label, key_segs):
    b = rule.blocks is None or any(
        fnmatch.fnmatchcase(label, p) for p in rule.blocks)
    e = rule.elements is None or any(
        _element_matches(el, key_segs) for el in rule.elements)
    m = b and e
    return (not m) if rule.negate else m


def ratio_for_key(key_unet, default, rules):
    """キー1つに適用する比率を決める。戻り値 (ratio, 勝ったRule or None)。"""
    label = block_label(key_unet)
    key_segs = key_unet.split(".")
    best = None
    for r in rules:
        if _rule_matches(r, key_unet, label, key_segs):
            # 優先度が高いほうが勝ち。同点なら後の行(>=)が勝ち。
            if best is None or r.specificity >= best.specificity:
                best = r
    if best is None:
        return default, None
    return best.ratio, best


# つまみマトリクスの列(otherは「その行のブロックの残り全部」)
MATRIX_ELEMENTS = ("attn1", "attn2", "ff", "norm", "proj", "other")

# 要素タブ内のサブ要素列(UI側と対応。値はそのまま要素指定として照合される)
MATRIX_SUB_ELEMENTS = {
    "attn1": ("attn1.to_q", "attn1.to_k", "attn1.to_v", "attn1.to_out"),
    "attn2": ("attn2.to_q", "attn2.to_k", "attn2.to_v", "attn2.to_out"),
    "ff": ("ff.net.0", "ff.net.2"),
    "norm": ("norm1", "norm2", "norm3"),
    "proj": ("proj_in", "proj_out"),
    "other": ("in_layers", "out_layers", "emb_layers",
              "skip_connection", "conv"),
}


def rules_from_matrix(matrix):
    """つまみマトリクス {block: {element: ratio}} をルール列に変換する。

    全つまみ0のブロックはルール自体を作らない(デフォルト0.0に落ちる)。
    どれか1つでも非0のブロックは、otherをブロック全体ルール(優先度1)、
    各要素を狙い撃ちルール(優先度2)として全部発行する。こうすると
    「other=0.5でattn2=0」のときにattn2がotherに巻き込まれない。

    MATRIX_ELEMENTS 以外のセルはサブ要素つまみ("attn2.to_q"や"norm1")。
    非0のときだけ要素ルールとして親要素より後ろに発行する。同じ優先度は
    後勝ちなので親要素のつまみを上書きし、サブ0は「親に従う」になる。
    """
    rules = []
    for block in sorted(matrix.keys()):
        cells = matrix.get(block) or {}
        vals = {}
        for el in MATRIX_ELEMENTS:
            try:
                v = float(cells.get(el, 0.0))
            except (TypeError, ValueError):
                v = 0.0
            vals[el] = min(max(v, 0.0), 1.0)
        subs = {}
        for el in cells:
            if el in MATRIX_ELEMENTS:
                continue
            try:
                v = float(cells.get(el) or 0.0)
            except (TypeError, ValueError):
                v = 0.0
            v = min(max(v, 0.0), 1.0)
            if v > 0.0:
                subs[str(el)] = v
        if not any(vals.values()) and not subs:
            continue
        label = _normalize_block(str(block).strip(), 0)
        rules.append(Rule([label], None, False, vals["other"], 0,
                          u"%s:other:%.2f (knob)" % (label, vals["other"])))
        for el in ("attn1", "attn2", "ff", "norm"):
            rules.append(Rule([label], [el], False, vals[el], 0,
                              u"%s:%s:%.2f (knob)" % (label, el, vals[el])))
        rules.append(Rule([label], ["proj_in", "proj_out"], False,
                          vals["proj"], 0,
                          u"%s:proj:%.2f (knob)" % (label, vals["proj"])))
        for el in sorted(subs):
            rules.append(Rule([label], [el], False, subs[el], 0,
                              u"%s:%s:%.2f (knob)" % (label, el, subs[el])))
    return rules


def build_report(default, rules, total, default_hits):
    lines = [u"total keys: %d" % total]
    if default_hits > 0 or not rules:
        lines.append(u"default %.4f -> %d keys" % (default, default_hits))
    for r in rules:
        # line_no=0 はスライダー由来のルール。0キーでも正常(SDXLのIN09〜等)
        label = (u"L%d  " % r.line_no) if r.line_no else u""
        mark = u""
        if r.hits == 0 and r.line_no:
            mark = u"  ★一致キーなし(書式・名前を確認)"
        neg = u"NOT " if r.negate else u""
        lines.append(u"%s%s%s -> %d keys%s"
                     % (label, neg, r.text.replace("NOT ", ""), r.hits, mark))
    return u"\n".join(lines)
