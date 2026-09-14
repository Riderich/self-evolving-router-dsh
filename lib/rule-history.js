import { hash } from './rule-contract.js'
import { assert } from './schema.js'
// Only trusted observeVerified records can supply replay fixtures. The model
// tool surface cannot create/replace these records or the base admission suite.
export function historyReplay(state, ids) {
 const cases=[],evidence={}
 for(const id of [...new Set(ids)].sort()){
  const row=state.maintenance?.histories?.[id];assert(row,'Unknown replay history')
  if(!row.fixture)continue
  evidence[id]=hash(row)
  cases.push({id:'history-'+hash(id),request:row.request,rule_id:row.family,args:row.fixture.args,text:row.output,files:row.fixture.files})
 }
 return{cases,evidence}
}
export function checkHistoryEvidence(state,proof){
 for(const [id,digest]of Object.entries(proof.historyEvidence??{}))assert(state.maintenance?.histories?.[id]&&hash(state.maintenance.histories[id])===digest,'Replay evidence changed since validation')
}
export function executableChanged(before,after){
 const select=files=>Object.fromEntries(Object.entries(files).filter(([p])=>p.endsWith('.py')&&!p.startsWith('tests/')))
 return hash(select(before))!==hash(select(after))
}
