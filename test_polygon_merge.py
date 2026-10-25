"""CPU numerical and node regressions for arbitrary source counts."""
import json
import unittest
import torch
import test_anima_merge as h
from recipe_merge_test.triangle_merge import weights, recipe_rules, merge_groups, PolygonLoraMerge
BASE='lora_unet_blocks_3_cross_attn_q_proj'
TE='lora_te_layers_0_self_attn_q_proj'

class PolygonTests(unittest.TestCase):
    def sides(self,n):
        torch.manual_seed(80+n)
        return [{'down':torch.randn(i%3+1,5),'up':torch.randn(4,i%3+1),'alpha':torch.tensor(float((-1 if i%2 else 1)*(i%3+2)))} for i in range(n)]

    def test_arbitrary_counts_match_dense_deltas(self):
        for n in (1,2,3,4,5,12,32):
            sides=self.sides(n)
            for mix in ([1]+[0]*(n-1),list(range(1,n+1)),[1]*n):
                w=weights(mix,n)
                out,counts,rank=merge_groups([{BASE:g} for g in sides],w,w,[])
                actual=out[BASE+'.lora_up.weight']@out[BASE+'.lora_down.weight']
                expected=sum(v*float(g['alpha'])/g['down'].shape[0]*(g['up']@g['down']) for v,g in zip(w,sides))
                torch.testing.assert_close(actual,expected)
                self.assertEqual(len(counts),n)
                self.assertEqual(rank,sum(g['down'].shape[0] for v,g in zip(w,sides) if v))

    def test_overrides_and_te_five_sources(self):
        n=5;sides=self.sides(n)
        data={'global':[1,0,0,0,0],'te':[0,0,0,0,1],'overrides':{'B03':{'attn2':[0,0,0,1,0]}}}
        default,te,rules=recipe_rules(data,n)
        out,_,_=merge_groups([{BASE:g,TE:g} for g in sides],default,te,rules)
        for key,i in ((BASE,3),(TE,4)):
            g=sides[i]
            expected=float(g['alpha'])/g['down'].shape[0]*(g['up']@g['down'])
            torch.testing.assert_close(out[key+'.lora_up.weight']@out[key+'.lora_down.weight'],expected)

    def test_lengths_fail_instead_of_truncating(self):
        with self.assertRaises(ValueError):recipe_rules({'global':[1,0,0]},4)
        with self.assertRaises(ValueError):recipe_rules({'global':[1,0,0,0],'overrides':{'B03':{'ff':[1,0,0]}}},4)
        with self.assertRaises(ValueError):merge_groups([{BASE:g} for g in self.sides(4)],(1,0,0),(1,0,0),[])

    def test_saved_and_preview_with_four_loras(self):
        n=4;sides=self.sides(n);names=['lora%d'%i for i in range(n)]
        files={name:{BASE+'.lora_down.weight':g['down'],BASE+'.lora_up.weight':g['up'],BASE+'.alpha':g['alpha']} for name,g in zip(names,sides)}
        h.comfy.utils.load_torch_file=lambda path,**kw:files[path]
        saved={};applied={};metadata={}
        def save(sd,path,**kw):saved.update(sd);metadata.update(kw['metadata'])
        h.comfy.utils.save_torch_file=save
        h.folder.get_folder_paths=lambda kind:['/tmp']
        h.comfy.lora.model_lora_keys_unet=lambda model,m:m
        h.comfy.lora_convert.convert_lora=lambda sd:sd
        h.comfy.lora.load_lora=lambda sd,m:sd
        class Model:
            model=None
            def clone(self):return self
            def add_patches(self,sd,w):applied.update(sd);return list(sd)
        data={'loras':names,'global':[.1,.2,.3,.4],'overrides':{}}
        result=PolygonLoraMerge().merge(names[0],'Anima',json.dumps(data),'polygon_test',True,model=Model())
        for key in saved:torch.testing.assert_close(saved[key],applied[key])
        recipe=json.loads(metadata['recipemerge']);self.assertEqual(recipe['type'],'polygon');self.assertEqual(recipe['loras'],names)
        self.assertIn('最大rank',result[2])
        with self.assertRaises(ValueError):PolygonLoraMerge().merge(names[0],'Anima','{"loras":[]}','x',True)

if __name__=='__main__':unittest.main()
