import { maintenanceState, createChain } from './maintenance-state.js'
import { event } from './store.js'
import { KERNEL_HASH } from './rule-contract.js'
import { assert } from './schema.js'
export class MaintenanceController {
  constructor(store,runner){this.store=store;this.runner=runner}
  async next(){
    const s=await this.store.read(),m=maintenanceState(s);if(!s.config.enabled||!m.config.enabled)return null
    const pending=Object.values(m.chains).find(c=>['ready','retry'].includes(c.status));if(pending)return pending
    const families=new Map()
    for(const h of Object.values(m.histories)){const rows=families.get(h.family)??[];rows.push(h);families.set(h.family,rows)}
    for(const[family,rows]of families){
      if(rows.length<m.config.minHistory)continue
      const old=Object.values(m.chains).filter(c=>c.rule_id===family),seen=new Set(old.flatMap(c=>c.source_ids))
      if(old.some(c=>!['complete','stopped'].includes(c.status))||rows.every(r=>seen.has(r.id)))continue
      return createChain(this.store,{rule_id:family,source_ids:rows.slice(-100).map(r=>r.id),base_revision:s.active[family]?.revision??null,goal:`Maintain a deterministic read-only rule for verified request family ${family}. Preserve past correct behavior, abstain outside supported scope.`})
    }
    return null
  }
  async run(chainId){
    assert(this.runner,'Maintenance runner not configured')
    const chain=await this.store.transaction(s=>{
      const m=maintenanceState(s),c=m.chains[chainId];assert(s.config.enabled && m.config.enabled,'Maintenance disabled');assert(c && ['ready','retry'].includes(c.status),'Chain not resumable')
      assert(!Object.values(m.calls).some(r=>r.chain_id===chainId && ['started','ambiguous'].includes(r.status)),'Unresolved paid call; no automatic retry')
      assert(!Object.values(m.operations).some(r=>r.chain_id===chainId && r.status==='started'),'Unresolved file operation; no automatic retry')
      assert(c.attempts<m.config.maxAttempts,'Attempt budget exhausted');c.attempts++;c.status='running';c.ownerPid=process.pid;event(s,'maintenance-attempt-start',{chain_id:chainId,attempt:c.attempts,kernelHash:KERNEL_HASH});return structuredClone(c)
    })
    let error
    try{await this.runner(chain)}catch(e){error=e.message}
    return this.store.transaction(s=>{
      const m=maintenanceState(s),c=m.chains[chainId],unresolved=Object.values(m.calls).some(r=>r.chain_id===chainId && ['started','ambiguous'].includes(r.status))||Object.values(m.operations).some(r=>r.chain_id===chainId && r.status==='started')
      c.status=unresolved?'ambiguous':c.promoted_revision?'complete':c.attempts>=m.config.maxAttempts||Object.keys(m.calls).length>=m.config.maxCalls?'stopped':'retry';c.lastError=error??null;delete c.ownerPid
      event(s,'maintenance-attempt-end',{chain_id:chainId,status:c.status,error:c.lastError});return c
    })
  }
  async recover(chainId){return this.store.transaction(s=>{
    const m=maintenanceState(s),c=m.chains[chainId];assert(c,'Unknown chain')
    if(c.ownerPid){let alive=true;try{process.kill(c.ownerPid,0)}catch(e){alive=e.code!=='ESRCH'}assert(!alive,'Maintenance owner still running')}
    const unknown=Object.values(m.calls).some(r=>r.chain_id===chainId && ['started','ambiguous'].includes(r.status))||Object.values(m.operations).some(r=>r.chain_id===chainId && r.status==='started')
    c.status=unknown?'ambiguous':c.promoted_revision?'complete':c.attempts>=m.config.maxAttempts?'stopped':'retry';delete c.ownerPid;event(s,'maintenance-recovery',{chain_id:chainId,status:c.status});return c
  })}
}
