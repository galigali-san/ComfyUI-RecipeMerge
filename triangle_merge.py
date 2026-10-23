"""Three-source LoRA concatenation with explicit barycentric weights."""
import json
import math
import os
import re

import torch
import folder_paths
import comfy.lora
import comfy.lora_convert
import comfy.utils

from .recipe_parser import Rule, ratio_for_key


def weights(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError('配合は[A, B, C]の3数値で指定してください')
    try:
        values = [float(v) for v in value]
    except (ValueError, TypeError):
        raise ValueError('配合には有限の数値を指定してください')
    if any(not math.isfinite(v) or v < 0 for v in values) or sum(values) <= 0:
        raise ValueError('配合は0以上、合計は0より大きい有限値が必要です')
    total = sum(values)
    if not math.isfinite(total):
        raise ValueError('配合の合計が大きすぎます')
    return tuple(v / total for v in values)


def recipe_rules(data):
    if not isinstance(data, dict):
        raise ValueError('triangleはJSONオブジェクトで指定してください')
    default = weights(data.get('global', [1, 0, 0]))
    te = weights(data.get('te', default))
    overrides = data.get('overrides', {})
    if not isinstance(overrides, dict):
        raise ValueError('overridesはオブジェクトで指定してください')
    rules = []
    for block, cells in overrides.items():
        if not re.fullmatch(r'ALL|BASE|M00|(?:B|IN|OUT)\d{2}', block):
            raise ValueError('未対応のブロック: ' + block)
        if not isinstance(cells, dict):
            raise ValueError('各ブロックには要素別の配合を指定してください')
        # Broad rule first; explicit element rules win independently of JSON order.
        for element in sorted(cells, key=lambda el: (el != 'ALL', el.count('.'), el)):
            if not re.fullmatch(r'ALL|[a-zA-Z0-9_.]+', element):
                raise ValueError('不正な要素: ' + element)
            # Extra specificity for sub-elements (parent must not overwrite a child).
            rule = Rule(None if block == 'ALL' else [block],
                        None if element == 'ALL' else (['proj_in', 'proj_out'] if element == 'proj' else [element]), False,
                        weights(cells[element]), 0, block + ':' + element)
            rule.specificity = (100 if block != 'ALL' else 0) + (0 if element == 'ALL' else 1 + element.count('.'))
            rules.append(rule)
    return default, te, rules


def merge_groups(groups, default, te, rules):
    from . import _lora_name_to_unet_key
    out = {}
    counts = [0, 0, 0]
    max_rank = 0
    for base in sorted(set().union(*(g.keys() for g in groups))):
        if base.startswith('lora_unet_'):
            key = _lora_name_to_unet_key(base[len('lora_unet_'):])
            mix, winner = ratio_for_key(key, default, rules)
            if winner is not None:
                winner.hits += 1
        elif base.startswith(('lora_te_', 'lora_te1_', 'lora_te2_', 'lora_te3_', 'text_encoders.', 'text_encoder.', 'text_encoder_2.')):
            mix = te
        else:
            raise ValueError('未対応のLoRAキー形式: ' + base)
        downs, ups = [], []
        dtype = None
        signature = None
        rank = 0
        for i, (g, w) in enumerate(zip(groups, mix)):
            side = g.get(base)
            if w == 0 or side is None:
                continue
            if set(side) - {'down', 'up', 'alpha'} or not {'down', 'up'} <= set(side):
                raise ValueError('通常LoRA/LoCon以外、または不完全なキー: ' + base)
            down, up = side['down'], side['up']
            if down.ndim not in (2, 4) or up.ndim != down.ndim or down.shape[0] == 0 or up.shape[1] != down.shape[0]:
                raise ValueError('LoRAのrank/形状が不正です: ' + base)
            if down.ndim == 4 and tuple(up.shape[2:]) != (1, 1):
                raise ValueError('LoConのupは1x1のみ対応します: ' + base)
            sig = (tuple(down.shape[1:]), up.shape[0], tuple(up.shape[2:]))
            if signature is not None and sig != signature:
                raise ValueError('LoRA同士の形状が一致しません（同じアーキテクチャが必要）: ' + base)
            signature = sig
            dtype = dtype or down.dtype
            r = down.shape[0]
            alpha = float(side.get('alpha', r))
            if not math.isfinite(alpha):
                raise ValueError('alphaは有限値が必要です: ' + base)
            scale = w * alpha / r
            # Split magnitude for conditioning, keep negative alpha's sign on up.
            s = math.sqrt(abs(scale))
            downs.append(down.float() * s)
            ups.append(up.float() * (s if scale >= 0 else -s))
            rank += r
            counts[i] += 1
        if not downs:
            continue
        out[base + '.lora_down.weight'] = torch.cat(downs, dim=0).to(dtype)
        out[base + '.lora_up.weight'] = torch.cat(ups, dim=1).to(dtype)
        out[base + '.alpha'] = torch.tensor(float(rank))
        max_rank = max(max_rank, rank)
    if not out:
        raise ValueError('マージ結果が空です。配合とLoRAの内容を確認してください')
    return out, counts, max_rank


class TriangleLoraMerge:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'lora_a': (folder_paths.get_filename_list('loras'),),
            'lora_b': (folder_paths.get_filename_list('loras'),),
            'lora_c': (folder_paths.get_filename_list('loras'),),
            'architecture': (['Anima', 'SD'],),
            'triangle': ('STRING', {'default': '{"global":[1,0,0],"overrides":{}}', 'multiline': True}),
            'filename': ('STRING', {'default': 'triangle_lora'}),
            'save_file': ('BOOLEAN', {'default': False}),
        }, 'optional': {'model': ('MODEL',), 'clip': ('CLIP',)}}

    RETURN_TYPES = ('MODEL', 'CLIP', 'STRING')
    RETURN_NAMES = ('model', 'clip', 'report')
    FUNCTION = 'merge'
    OUTPUT_NODE = True
    CATEGORY = 'advanced/model_merging'
    DESCRIPTION = ('3つのLoRAを三角形の配合でconcatマージ。Anima/SDの階層・要素別に上書き可能。'
                   '点の割合は合計100%。rankは最大3つの合計。チェックポイント同士や異なる構造の混合には非対応。')

    def merge(self, lora_a, lora_b, lora_c, architecture, triangle, filename,
              save_file, model=None, clip=None):
        from . import _normalize_anima_keys, _group_lora_keys, _diffusers_to_kohya
        if not save_file and model is None and clip is None:
            raise ValueError('試し生成用のmodel/clipを接続するか、save_fileをONにしてください')
        if architecture not in ('Anima', 'SD'):
            raise ValueError('未対応のarchitectureです')
        data = json.loads(triangle)
        default, te, rules = recipe_rules(data)
        for rule in rules:
            if rule.blocks and ((architecture == 'Anima' and rule.blocks[0].startswith(('IN', 'OUT', 'M'))) or (architecture == 'SD' and re.fullmatch(r'B\d{2}', rule.blocks[0]))):
                raise ValueError('階層の指定がarchitectureと一致しません: ' + rule.text)
        groups = []
        for name in (lora_a, lora_b, lora_c):
            sd = comfy.utils.load_torch_file(folder_paths.get_full_path_or_raise('loras', name), safe_load=True)
            sd = _normalize_anima_keys(sd)
            converted = {}
            for key, value in sd.items():
                if re.match(r'lora_unet_(down_blocks|up_blocks|mid_block)', key):
                    nk = _diffusers_to_kohya(key[len('lora_unet_'):])
                    if nk is None:
                        raise ValueError('SDキーを変換できません: ' + key)
                    key = 'lora_unet_' + nk
                key = key.replace('.lora_A.weight', '.lora_down.weight').replace('.lora_B.weight', '.lora_up.weight')
                if key in converted:
                    raise ValueError('変換後のキーが重複しています: ' + key)
                converted[key] = value
            families = set()
            for key in converted:
                if re.match(r'lora_unet_blocks_\d+_', key):
                    families.add('Anima')
                elif re.match(r'lora_unet_(input_blocks|output_blocks|middle_block)_', key):
                    families.add('SD')
            if families and families != {architecture}:
                raise ValueError('LoRAの階層構造がarchitectureと一致しません: ' + name)
            groups.append(_group_lora_keys(converted))
        out, counts, rank = merge_groups(groups, default, te, rules)
        new_model = new_clip = None
        applied = []
        if model is not None or clip is not None:
            key_map = {}
            if model is not None:
                key_map = comfy.lora.model_lora_keys_unet(model.model, key_map)
            if clip is not None:
                key_map = comfy.lora.model_lora_keys_clip(clip.cond_stage_model, key_map)
            loaded = comfy.lora.load_lora(comfy.lora_convert.convert_lora(out), key_map)
            for obj, label in ((model, 'model'), (clip, 'clip')):
                if obj is not None:
                    clone = obj.clone()
                    accepted = clone.add_patches(loaded, 1.0)
                    applied.append('%s適用キー: %d' % (label, len(accepted)))
                    if label == 'model':
                        new_model = clone
                    else:
                        new_clip = clone
        saved = '保存なし'
        if save_file:
            safe = re.sub(r'[\\/:*?"<>|]', '_', filename.strip()).strip('.') or 'triangle_lora'
            directory = folder_paths.get_folder_paths('loras')[0]
            path = os.path.join(directory, safe + '.safetensors')
            n = 1
            while os.path.exists(path):
                path = os.path.join(directory, '%s_%d.safetensors' % (safe, n))
                n += 1
            metadata = {'recipemerge': json.dumps({'type': 'triangle', 'loras': [lora_a, lora_b, lora_c], 'architecture': architecture, 'triangle': data}, ensure_ascii=False)}
            comfy.utils.save_torch_file(out, path, metadata=metadata)
            saved = '保存: ' + os.path.basename(path)
        report = '\n'.join([saved, '全体 A/B/C: ' + '/'.join('%.2f%%' % (v*100) for v in default),
                            'TE A/B/C: ' + '/'.join('%.2f%%' % (v*100) for v in te),
                            '使用キー A/B/C: %s / 最大rank: %d' % (counts, rank),
                            '片側にしかないキーは指定比率のまま保持（欠けた側へ再配分しません）'] + applied +
                           [r.text + ': %d keys%s' % (r.hits, ' ★一致なし' if not r.hits else '') for r in rules])
        return new_model, new_clip, report
