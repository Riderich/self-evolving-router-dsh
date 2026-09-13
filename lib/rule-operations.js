import { mkdir, writeFile, chmod, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assert } from './schema.js'
import { id, hash, BACKEND } from './rule-contract.js'
import { RuleRegistry } from './rule-registry.js'
import { readPackage, checkPackage } from './rule-package.js'
import { validateCollection } from './rule-validation.js'
import { editDraft } from './draft-editor.js'
import { maintenanceState, operations } from './maintenance-state.js'
import { event } from './store.js'
const emptySchema={type:'object',properties:{},required:[],additionalProperties:false}
const resultSchema={type:'object',properties:{text:{type:'string',maxLength:65536}},required:['text'],additionalProperties:false}
export class RuleOperations {
  constructor(store,chainId,options={}){this.store=store;this.chainId=chainId;this.options=options;this.registry=new RuleRegistry(store,options)}
  async context(){const s=await this.store.read();const c=maintenanceState(s).chains[this.chainId];assert(c,'Unknown chain');return{s,c}}
  async journal(name,data,opId,fn){
    const previous=await this.store.transaction(s=>{const m=maintenanceState(s),c=m.chains[this.chainId],p=m.operations[opId];assert(c,'Unknown chain');if(p){assert(p.chain_id===c.id && p.name===name && p.inputHash===hash(data),'Operation ID reused');assert(p.status==='done','Ambiguous operation; inspect before resuming');return p}
      assert(c.operationCount<m.config.maxOperations,'Operation budget exhausted');c.operationCount++;m.operations[opId]={chain_id:c.id,name,inputHash:hash(data),status:'started'};event(s,'maintenance-operation-start',{chain_id:c.id,operation_id:opId,name,data});return null});
    if(previous)return previous.result
    try{const result=await fn();await this.store.transaction(s=>{const p=maintenanceState(s).operations[opId];Object.assign(p,{status:'done',result});event(s,'maintenance-operation-end',{chain_id:this.chainId,operation_id:opId,name,result})});return result}
    catch(e){await this.store.transaction(s=>{Object.assign(maintenanceState(s).operations[opId],{status:'done',result:{error:e.message}});event(s,'maintenance-operation-error',{chain_id:this.chainId,operation_id:opId,name,error:e.message})});throw e}
  }
  async newDraft(ruleId,baseRevision=null,group=null){
    const{s,c}=await this.context();assert(id(ruleId),'Invalid rule ID');assert(ruleId===c.rule_id || group,'Rule outside chain')
    const draftId=randomUUID(),dir=join(this.store.dir,'drafts',draftId)
    let files
    if(baseRevision){assert(s.packages[baseRevision],'Unknown base');files=structuredClone(s.packages[baseRevision].files)}
    else files={'manifest.json':JSON.stringify({backend:BACKEND,rule_id:ruleId,description:c.goal.slice(0,1000),trigger:'trigger.py',executor:'executor.py',args_schema:emptySchema,result_schema:resultSchema,capabilities:['public-workspace-read'],source_ids:c.source_ids,parent_revision:null},null,2)+'\n','README.md':c.goal+'\n','trigger.py':"def trigger(request, context):\n    return {'decision':'abstain','reason_code':'not_implemented'}\n",'executor.py':"def execute(request, args, context):\n    return {'status':'fallback','reason_code':'not_implemented'}\n"}
    const m=JSON.parse(files['manifest.json']);m.rule_id=ruleId;m.source_ids=c.source_ids;m.parent_revision=baseRevision && JSON.parse(s.packages[baseRevision].files['manifest.json']).rule_id===ruleId?baseRevision:null;files['manifest.json']=JSON.stringify(m,null,2)+'\n'
    await mkdir(dir,{recursive:true});await chmod(dir,0o777)
    for(const[p,text]of Object.entries(files)){await mkdir(dirname(join(dir,p)),{recursive:true,mode:0o777});if(dirname(p)!=='.')await chmod(dirname(join(dir,p)),0o777);await writeFile(join(dir,p),text);await chmod(join(dir,p),0o666)}
    const draft={id:draftId,rule_id:ruleId,base_revision:baseRevision,group,allowed:['manifest.json','README.md','trigger.py','executor.py','helpers/','tests/']}
    await this.store.transaction(s=>{const c=maintenanceState(s).chains[this.chainId];c.drafts[draftId]=draft;c.current_draft=draftId})
    return{draft_id:draftId,path:'/draft',files:Object.keys(files),base_revision:baseRevision}
  }
  async edit(args,operationId,signal){return this.journal('file-edit',args,operationId,async()=>{
    const{s,c}=await this.context(),d=c.drafts[c.current_draft];assert(d,'Select/create a draft first')
    const result=await editDraft(join(this.store.dir,'drafts',d.id),args,s.config,d.allowed,signal)
    if(args.command!=='view')await this.store.transaction(s=>{const c=maintenanceState(s).chains[this.chainId];c.latest_proof=null;delete c.drafts[d.id].revision})
    return result
  })}
  async submit(draftId){
    const{s,c}=await this.context(),d=c.drafts[draftId??c.current_draft];assert(d,'Unknown draft')
    const dir=join(this.store.dir,'drafts',d.id),pkg=await readPackage(dir),m=pkg.manifest
    assert(m.rule_id===d.rule_id && hash(m.source_ids)===hash(c.source_ids),'Identity/provenance cannot be edited')
    const expected=d.base_revision && JSON.parse(s.packages[d.base_revision].files['manifest.json']).rule_id===m.rule_id?d.base_revision:null
    assert(m.parent_revision===expected,'Parent cannot be edited')
    const submitted=await this.registry.submit(dir)
    const before=d.base_revision?s.packages[d.base_revision].files:{}
    const diff=Object.keys({...before,...pkg.files}).filter(k=>before[k]!==pkg.files[k]).map(path=>({path,before:before[path]??null,after:pkg.files[path]??null}))
    await this.store.transaction(s=>{const c=maintenanceState(s).chains[this.chainId];c.drafts[d.id].revision=submitted.revision;c.latest_revision=submitted.revision;event(s,'maintenance-code-diff',{chain_id:c.id,revision:submitted.revision,base_revision:d.base_revision,diff})})
    return submitted
  }
  async validation(signal){
    const{s,c}=await this.context();assert(c.latest_revision,'Submit draft first')
    await this.store.transaction(s=>{const m=maintenanceState(s),c=m.chains[this.chainId];assert(c.validations<m.config.maxValidations,'Validation budget exhausted');c.validations++})
    let proof
    if(c.composition){
      const target=Object.fromEntries(Object.entries(s.active).map(([k,v])=>[k,v.revision])),coverage={}
      for(const old of c.composition.replace)delete target[old]
      for(const draftId of c.composition.drafts){const d=c.drafts[draftId];assert(d.revision,'Submit every composition member');target[d.rule_id]=d.revision;coverage[d.rule_id]=c.composition.families}
      proof=await validateCollection(this.store,target,{...this.options,signal,expectedGeneration:s.generation,coverage})
    }else proof=await this.registry.validate(c.latest_revision,signal)
    await this.store.transaction(s=>{
      const c=maintenanceState(s).chains[this.chainId],previous=c.stable_proof?s.proofs[c.stable_proof]:null
      const regressed=previous && previous.suiteHash===proof.suiteHash?previous.results.filter(r=>r.passed && !proof.results.find(n=>n.case_id===r.case_id)?.passed).map(r=>r.case_id):[]
      const passed=proof.results.filter(r=>r.passed).length,prior=previous?.results.filter(r=>r.passed).length??-1
      c.latest_proof=proof.validation_id;c.feedback.push({revision:c.latest_revision,validation_id:proof.validation_id,regressed,passed})
      if(!regressed.length && passed>prior){c.stable_revision=c.latest_revision;c.stable_proof=proof.validation_id}
    })
    return this.feedback(proof)
  }
  feedback(proof){return{validation_id:proof.validation_id,generation:proof.generation,passed:proof.passed,status:proof.status,durationMs:proof.durationMs,results:proof.results.map(r=>({case_id:r.case_id,request:r.request,passed:r.passed,expected:r.expected,validation_error:r.validation_error,runs:r.runs?.map(x=>({kind:x.kind,reason:x.reason,text:x.text,detail:x.detail,triggers:x.triggers?.map(t=>({rule_id:t.rule_id,result:t.result,error:t.error,stderr:t.stderr,durationMs:t.durationMs})),execution:x.execution}))}))}}
  async call(action,data={},operationId=randomUUID(),signal){assert(operations.includes(action),'Unknown rule operation');return this.journal(action,data,operationId,async()=>{
    const{s,c}=await this.context()
    if(action==='list_rules'||action==='find_similar_rules')return Object.entries(s.packages).map(([rev,p])=>{const m=JSON.parse(p.files['manifest.json']);return{rule_id:m.rule_id,revision:rev,description:m.description,active:s.active[m.rule_id]?.revision===rev}}).filter(r=>action==='list_rules'||`${r.rule_id} ${r.description}`.toLowerCase().includes(String(data.query??'').toLowerCase())).slice(0,100)
    if(action==='inspect_rule'){const rev=data.revision??c.latest_revision??c.stable_revision;assert(s.packages[rev],'Unknown revision');return{revision:rev,...s.packages[rev],chain:{stable_revision:c.stable_revision,latest_revision:c.latest_revision,feedback:c.feedback}}}
    if(action==='create_rule')return this.newDraft(c.rule_id)
    if(['edit_trigger','edit_executor','edit_contract','add_tests'].includes(action)){
      let draftId=data.draft_id??c.current_draft
      if(data.base_revision || !draftId){const base=data.base_revision??c.stable_revision;assert(base && [c.stable_revision,c.latest_revision,...Object.values(c.drafts).map(d=>d.revision)].includes(base),'Base outside chain');draftId=(await this.newDraft(c.rule_id,base)).draft_id}
      const allowed=action==='edit_trigger'?['trigger.py','helpers/']:action==='edit_executor'?['executor.py','helpers/']:action==='add_tests'?['tests/']:['manifest.json','README.md','trigger.py','executor.py','helpers/','tests/']
      await this.store.transaction(s=>{const c=maintenanceState(s).chains[this.chainId];assert(c.drafts[draftId],'Unknown draft');c.current_draft=draftId;c.drafts[draftId].allowed=allowed})
      return{draft_id:draftId,path:'/draft',allowed}
    }
    if(action==='submit_rule')return this.submit(data.draft_id)
    if(['validate_rule','profile_rule','check_conflicts'].includes(action))return this.validation(signal)
    if(action==='diagnose_rule'){assert(c.latest_proof,'No validation yet');return this.feedback(s.proofs[c.latest_proof])}
    if(action==='activate_rule'){
      assert(c.latest_proof && (!data.validation_id||data.validation_id===c.latest_proof),'Use chain latest validation')
      const proof=s.proofs[c.latest_proof];assert(proof.passed,'Candidate rejected')
      const r=await this.registry.activate(proof.validation_id,proof.generation)
      await this.store.transaction(s=>{const c=maintenanceState(s).chains[this.chainId];c.published=proof.target;c.promoted_revision=c.latest_revision})
      return r
    }
    if(action==='disable_rule')return this.registry.disable(c.rule_id,s.generation)
    if(action==='rollback_rule'){assert(data.revision && JSON.parse(s.packages[data.revision]?.files['manifest.json']??'{}').rule_id===c.rule_id,'Rollback outside target');return this.registry.rollback(c.rule_id,data.revision,s.generation,signal)}
    if(action==='split_rule'||action==='merge_rules'){
      const replace=action==='split_rule'?[c.rule_id]:data.rule_ids
      assert(Array.isArray(replace)&&replace.length>0&&replace.includes(c.rule_id)&&replace.every(k=>s.active[k]),'Composition requires active source rules')
      // Additional merge sources must already be explicitly authorized histories.
      assert(replace.every(k=>JSON.parse(s.packages[s.active[k].revision].files['manifest.json']).source_ids.every(x=>c.source_ids.includes(x))),'Merge provenance outside allowed history')
      const ids=action==='split_rule'?data.child_ids:[data.new_rule_id]
      assert(Array.isArray(ids)&&ids.length>0&&ids.length<=8&&new Set(ids).size===ids.length&&ids.every(k=>id(k)&&!s.active[k]),'Invalid/new composition IDs required')
      const group=randomUUID(),drafts=[]
      for(const ruleId of ids)drafts.push((await this.newDraft(ruleId,s.active[replace[0]].revision,group)).draft_id)
      await this.store.transaction(s=>{maintenanceState(s).chains[this.chainId].composition={group,replace,drafts,families:[...new Set(replace.flatMap(k=>s.proofs[s.active[k].validation_id]?.coverage?.[k]??[k]))]}})
      return{group,replace,drafts}
    }
    throw Error('Unsupported operation')
  })}
}
