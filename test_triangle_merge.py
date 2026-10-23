"""Run with python test_triangle_merge.py. Real CPU tensors, Comfy I/O stubbed."""
import json
import unittest
import torch
import test_anima_merge as harness
from recipe_merge_test.triangle_merge import weights, recipe_rules, merge_groups, TriangleLoraMerge

BASE = 'lora_unet_blocks_3_cross_attn_q_proj'

def group(rank, alpha=None):
    return {'down': torch.randn(rank, 5), 'up': torch.randn(4, rank), 'alpha': torch.tensor(float(rank if alpha is None else alpha))}

class TriangleTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(14)
        self.sides = [group(2, 1), group(3, 6), group(1, -1)]
        self.groups = [{BASE:s} for s in self.sides]

    def test_vertices_edges_center_and_asymmetry(self):
        for mix in ([1,0,0], [0,1,0], [0,0,1], [1,1,0], [1,1,1], [2,3,5]):
            w = weights(mix)
            out, counts, rank = merge_groups(self.groups, w, w, [])
            actual = out[BASE+'.lora_up.weight'] @ out[BASE+'.lora_down.weight']
            expected = sum(v*float(g['alpha'])/g['down'].shape[0]*(g['up'] @ g['down']) for v,g in zip(w,self.sides))
            torch.testing.assert_close(actual, expected)
            self.assertEqual(rank, sum(g['down'].shape[0] for v,g in zip(w,self.sides) if v))

    def test_override_zero_and_precedence(self):
        data = {'global':[1,0,0], 'overrides':{'B03':{'attn2.to_q':[0,0,1],'attn2':[0,1,0],'ALL':[1,0,0]}, 'ALL':{'attn2':[1,0,0]}}}
        default, te, rules = recipe_rules(data)
        out, _, _ = merge_groups(self.groups,default,te,rules)
        g=self.sides[2]
        torch.testing.assert_close(out[BASE+'.lora_up.weight'] @ out[BASE+'.lora_down.weight'], -(g['up']@g['down']))

    def test_missing_keys_not_renormalized_and_te(self):
        g=self.sides[0]; tebase='lora_te_layers_0_self_attn_q_proj'
        out,_,_=merge_groups([{BASE:g,tebase:g},{},{}],(.2,.3,.5),(1,0,0),[])
        torch.testing.assert_close(out[BASE+'.lora_up.weight'] @ out[BASE+'.lora_down.weight'], .1*(g['up']@g['down']))
        torch.testing.assert_close(out[tebase+'.lora_up.weight'] @ out[tebase+'.lora_down.weight'], .5*(g['up']@g['down']))

    def test_invalid_weights_and_shape_fail(self):
        for bad in ([0,0,0],[-1,1,1],[float('nan'),1,1],[float('inf'),0,0],[1,2]):
            with self.assertRaises(ValueError):weights(bad)
        self.groups[1][BASE]['down']=torch.randn(3,6)
        with self.assertRaises(ValueError):merge_groups(self.groups,(.5,.5,0),(1,0,0),[])

    def test_unsupported_fails_instead_of_partial_save(self):
        self.groups[0][BASE]['dora']=torch.ones(4)
        with self.assertRaises(ValueError):merge_groups(self.groups,(1,0,0),(1,0,0),[])

    def test_locon_and_sd_keys(self):
        groups = [{BASE: {'down': g['down'][:, :, None, None], 'up': g['up'][:, :, None, None], 'alpha': g['alpha']}} for g in self.sides]
        out,_,_=merge_groups(groups,(.2,.3,.5),(1,0,0),[])
        actual=out[BASE+'.lora_up.weight'].flatten(1) @ out[BASE+'.lora_down.weight'].flatten(1)
        expected=sum(w*float(g['alpha'])/g['down'].shape[0]*(g['up']@g['down']) for w,g in zip((.2,.3,.5),self.sides))
        torch.testing.assert_close(actual,expected)
        sdkey='lora_unet_input_blocks_4_1_transformer_blocks_0_attn2_to_q'
        default,te,rules=recipe_rules({'global':[1,0,0],'overrides':{'IN04':{'attn2':[0,1,0]}}})
        out,_,_=merge_groups([{sdkey:self.sides[0]},{sdkey:self.sides[1]},{}],default,te,rules)
        self.assertEqual(out[sdkey+'.lora_down.weight'].shape[0],3)

    def test_preview_and_saved_tensor_identical(self):
        files={}
        for i,g in enumerate(self.sides):
            files[str(i)]={BASE+'.lora_down.weight':g['down'], BASE+'.lora_up.weight':g['up'], BASE+'.alpha':g['alpha']}
        harness.comfy.utils.load_torch_file=lambda path,**kw: files[path]
        saved={}; applied={}
        harness.comfy.utils.save_torch_file=lambda sd,path,**kw: saved.update(sd)
        harness.folder.get_folder_paths=lambda kind:['/tmp']
        harness.comfy.lora.model_lora_keys_unet=lambda model,m: {BASE:'diffusion_model.blocks.3.cross_attn.q_proj.weight'}
        harness.comfy.lora_convert.convert_lora=lambda sd:sd
        harness.comfy.lora.load_lora=lambda sd,m:sd
        class Model:
            model=None
            def clone(self):return self
            def add_patches(self,sd,w):applied.update(sd);return list(sd)
        result=TriangleLoraMerge().merge('0','1','2','Anima',json.dumps({'global':[2,3,5]}),'triangle_test',True,model=Model())
        for key in saved:torch.testing.assert_close(saved[key],applied[key])
        self.assertIsNotNone(result[0])

if __name__=='__main__':unittest.main()
