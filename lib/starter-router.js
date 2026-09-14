import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleRegistry } from './rule-registry.js'
import { validateCollection } from './rule-validation.js'
import { configureMaintenance } from './maintenance-state.js'
import { assert } from './schema.js'
export const starterImage='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285'
export const starterDirectory=fileURLToPath(new URL('../examples/starter-router/',import.meta.url))
export async function installStarter(store,config){
 assert(!await store.exists(),'Starter install requires a fresh object registry; existing evidence is not overwritten')
 await mkdir(config.snapshotDirectory,{recursive:true})
 await store.configure(config)
 await writeFile(join(store.dir,'admission.json'),await readFile(join(starterDirectory,'admission.json')),{flag:'wx'})
 const registry=new RuleRegistry(store),target={}
 for(const rule_id of ['list-files','count-files','recursive-lines']){
  await registry.addSource('starter-'+rule_id,{kind:'manual-control',reference:'bundled starter-router/'+rule_id})
  const pkg=await registry.submit(join(starterDirectory,'rules',rule_id));target[rule_id]=pkg.revision
 }
 const proof=await validateCollection(store,target)
 assert(proof.passed,'Starter collection validation failed; nothing activated')
 const result=await registry.activate(proof.validation_id,proof.generation)
 await configureMaintenance(store,{enabled:true,maxCalls:20})
 return{...result,validation_id:proof.validation_id,validationCases:proof.results.length,validationMs:proof.durationMs,modelCalls:0}
}
