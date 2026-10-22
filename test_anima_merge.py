"""CPU regression tests; ComfyUI I/O is stubbed, tensor math is real PyTorch."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
import torch

ROOT = Path(__file__).parent
folder = types.ModuleType('folder_paths')
folder.get_full_path_or_raise = lambda kind, name: name
folder.get_filename_list = lambda kind: []
sys.modules['folder_paths'] = folder
comfy = types.ModuleType('comfy')
for name in ('lora', 'lora_convert', 'utils'):
    module = types.ModuleType('comfy.' + name)
    setattr(comfy, name, module)
    sys.modules[module.__name__] = module
sys.modules['comfy'] = comfy
spec = importlib.util.spec_from_file_location('recipe_merge_test', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
node = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = node
spec.loader.exec_module(node)
parser = sys.modules[spec.name + '.recipe_parser']

class AnimaMergeTests(unittest.TestCase):
    def test_block_and_elements(self):
        matrix = {'B03': {'attn1': .2, 'attn2': .7, 'ff': .4, 'other': .1, 'attn2.to_q': .9}}
        rules = parser.rules_from_matrix(matrix)
        for key, expected in [('blocks.3.self_attn.q_proj', .2), ('blocks.3.cross_attn.k_proj', .7), ('blocks.3.cross_attn.q_proj', .9), ('blocks.3.mlp.layer1', .4), ('blocks.3.adaln_modulation.0', .1), ('blocks.4.self_attn.q_proj', 0)]:
            self.assertEqual(parser.ratio_for_key(key, 0, rules)[0], expected, key)
        self.assertEqual(parser.block_label('llm_adapter.blocks.0.cross_attn.q_proj'), 'BASE')

    def test_native_and_kohya_merge_equivalence(self):
        torch.manual_seed(42)
        for t in (0., .25, 1.):
            d1, u1 = torch.randn(2, 5), torch.randn(4, 2)
            d2, u2 = torch.randn(3, 5), torch.randn(4, 3)
            first = {'diffusion_model.blocks.3.cross_attn.q_proj.lora_A.weight': d1,
                     'diffusion_model.blocks.3.cross_attn.q_proj.lora_B.weight': u1,
                     'diffusion_model.blocks.3.cross_attn.q_proj.alpha': torch.tensor(1.)}
            base = 'lora_unet_blocks_3_cross_attn_q_proj'
            second = {base + '.lora_down.weight': d2, base + '.lora_up.weight': u2, base + '.alpha': torch.tensor(6.)}
            files = {'a': first, 'b': second}
            comfy.utils.load_torch_file = lambda path, **kw: files[path]
            saved = {}
            comfy.utils.save_torch_file = lambda sd, path, **kw: saved.update(sd)
            folder.get_folder_paths = lambda kind: ['/tmp']
            node.AnimaLoraMergeMatrix().merge('a', 'b', '{"B03":{"attn2":%s}}' % t, 0.99, 'test', True)
            actual = saved[base + '.lora_up.weight'] @ saved[base + '.lora_down.weight']
            expected = (1-t) * .5 * (u1 @ d1) + t * 2 * (u2 @ d2)
            torch.testing.assert_close(actual, expected)

    def test_duplicate_rejected(self):
        with self.assertRaises(ValueError):
            node._normalize_anima_keys({'diffusion_model.blocks.0.mlp.layer1.alpha': 1,
                'lora_unet_blocks_0_mlp_layer1.alpha': 2})

if __name__ == '__main__':
    unittest.main()
