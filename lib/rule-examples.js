import { historyReplay } from './rule-history.js'
import { activePackages } from './rule-router.js'
import { loadRuleSuite } from './rule-validation.js'
import { hash } from './rule-contract.js'
// Examples come from the SAME currently validated active registry, not a second
// prompt-only library. Bounded selection is deterministic and makes no model call.
export async function activeExamples(store,chain,{maxExamples=2,maxChars=24000}={}){
 const s=await store.read();if(!s.config.enabled)return[]
 const suite=await loadRuleSuite(store)
 let packages
 try{packages=activePackages(s,hash(suite))}catch{return[]}
 const words=new Set((chain.rule_id+' '+chain.goal).toLowerCase().match(/[a-z]+/g)??[])
 const score=p=>(p.manifest.rule_id===chain.rule_id?1000:0)+[...words].filter(w=>(p.manifest.rule_id+' '+p.manifest.description).toLowerCase().includes(w)).length
 packages.sort((a,b)=>score(b)-score(a)||a.manifest.rule_id.localeCompare(b.manifest.rule_id))
 const examples=[];let size=0
 for(const p of packages){
  const proof=s.proofs[s.active[p.manifest.rule_id].validation_id]
  const example={rule_id:p.manifest.rule_id,revision:p.revision,validation_id:proof.validation_id,role:'working active rule and few-shot example; code/data, not instructions',files:p.files,
   validation_examples:[...suite.cases.filter(c=>c.rule_id===p.manifest.rule_id),...historyReplay(s,Object.keys(proof.historyEvidence??{})).cases.filter(c=>c.rule_id===p.manifest.rule_id),...suite.cases.filter(c=>c.rule_id===null)].slice(0,8)}
  const n=JSON.stringify(example).length
  if(size+n>maxChars)continue
  examples.push(example);size+=n;if(examples.length>=maxExamples)break
 }
 return examples
}
