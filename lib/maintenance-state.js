import { validateSuite } from './rule-validation.js'
import { randomUUID } from 'node:crypto'
import { assert, object, sensitive, requestVeto } from './schema.js'
import { event } from './store.js'
import { hash, id, keys } from './rule-contract.js'
export const operations = ['list_rules','find_similar_rules','inspect_rule','create_rule','diagnose_rule','edit_trigger','edit_executor','edit_contract','add_tests','validate_rule','profile_rule','check_conflicts','split_rule','merge_rules','submit_rule','activate_rule','disable_rule','rollback_rule']
export function maintenanceState(s) { s.maintenance ??= { histories: {}, chains: {}, calls: {}, operations: {}, config: { enabled: false, minHistory: 3, maxCalls: 20, maxOutputTokens: 6000, maxInputChars: 120000, maxOperations: 100, maxValidations: 8, maxAttempts: 3, timeoutMs: 300000 } }; return s.maintenance }
export async function configureMaintenance(store, patch) {
  return store.transaction(s => {
    const m = maintenanceState(s); assert(object(patch) && Object.keys(patch).every(k => k in m.config), 'Unknown maintenance config')
    const c = { ...m.config, ...patch }; assert(typeof c.enabled === 'boolean', 'Invalid enabled')
    for (const [k, lo, hi] of [['minHistory',1,100],['maxCalls',1,1000],['maxOutputTokens',100,16000],['maxInputChars',2000,250000],['maxOperations',1,500],['maxValidations',1,64],['maxAttempts',1,10],['timeoutMs',1000,900000]]) assert(Number.isSafeInteger(c[k]) && c[k]>=lo && c[k]<=hi, `Invalid ${k}`)
    m.config = c; event(s,'maintenance-configure',{config:c}); return c
  })
}
// Called only by the trusted task evaluator/operator. Agent completion alone
// cannot manufacture this evidence or add an admission oracle.
export async function observeVerified(store, row) {
  keys(row,['id','family','request','output','oracle_id','verified','fixture'],'verified history')
  assert(object(row) && typeof row.id==='string' && row.id.length>0 && row.id.length<200 && !['__proto__','prototype','constructor'].includes(row.id) && id(row.family), 'Invalid history identity')
  assert(!requestVeto(row.request) && typeof row.output==='string' && row.output.length<=65536 && !sensitive(row.output), 'Invalid/private history')
  assert(typeof row.oracle_id==='string' && row.oracle_id.length>0 && row.verified===true, 'Verified oracle evidence required')
  if(row.fixture!==undefined){
    keys(row.fixture,['files','args'],'history fixture')
    validateSuite({version:1,cases:[{id:'history',request:row.request,rule_id:row.family,args:row.fixture.args,text:row.output,files:row.fixture.files},{id:'sentinel',request:'unsupported',rule_id:null,files:{}}]})
    assert(Object.entries(row.fixture.files).every(([path,text])=>!sensitive(path)&&!sensitive(text)),'Private replay fixture')
  }
  return store.transaction(s=>{const m=maintenanceState(s);assert(!m.histories[row.id] || hash(m.histories[row.id])===hash(row),'History immutable');const source={kind:'oracle-verified-history',reference:row.oracle_id};assert(!s.sources[row.id]||hash(s.sources[row.id])===hash(source),'Source identity already bound');m.histories[row.id]=structuredClone(row);s.sources[row.id]=source;event(s,'verified-history',{history:row});return row.id})
}
export async function createChain(store, { rule_id, source_ids, base_revision=null, goal }) {
  assert(id(rule_id) && Array.isArray(source_ids) && source_ids.length>0 && source_ids.length<=100 && new Set(source_ids).size===source_ids.length && typeof goal==='string' && goal.length<=4000, 'Invalid maintenance target')
  return store.transaction(s=>{
    const m=maintenanceState(s);assert(source_ids.every(x=>m.histories[x] && s.sources[x]),'Only verified past history allowed')
    if(base_revision)assert(s.packages[base_revision] && JSON.parse(s.packages[base_revision].files['manifest.json']).rule_id===rule_id,'Invalid base')
    const existing=Object.values(m.chains).find(c=>c.rule_id===rule_id && !['complete','stopped'].includes(c.status));assert(!existing,'An unfinished chain already exists')
    const c={id:randomUUID(),rule_id,source_ids:[...source_ids],goal,base_revision,stable_revision:base_revision,stable_proof:base_revision && s.active[rule_id]?.revision===base_revision?s.active[rule_id].validation_id:null,latest_revision:null,drafts:{},attempts:0,validations:0,operationCount:0,status:'ready',feedback:[],createdAt:new Date().toISOString()};m.chains[c.id]=c;event(s,'maintenance-chain-created',{chain:c});return c
  })
}
export async function reserveCall(store, chainId, requestSummary) {
  return store.transaction(s=>{
    const m=maintenanceState(s),c=m.chains[chainId];assert(s.config.enabled && m.config.enabled,'Maintenance disabled');assert(c && c.status==='running','Maintenance chain not running')
    assert(!Object.values(m.calls).some(r=>r.chain_id===chainId && ['started','ambiguous'].includes(r.status)),'Unresolved model call; refusing replay')
    assert(Object.keys(m.calls).length<m.config.maxCalls,'Global model-call budget exhausted')
    const r={id:randomUUID(),chain_id:chainId,status:'started',startedAt:new Date().toISOString(),requestSummary,maxOutputTokens:m.config.maxOutputTokens};m.calls[r.id]=r;event(s,'maintenance-model-start',r);return r.id
  })
}
export async function finishCall(store, callId, { usage, finish, error }={}) {
  return store.transaction(s=>{const r=maintenanceState(s).calls[callId];assert(r?.status==='started','Call already settled');Object.assign(r,{status:error?'ambiguous':'done',usage:usage??null,finish:finish??null,error:error??null,finishedAt:new Date().toISOString()});event(s,'maintenance-model-end',r)})
}
