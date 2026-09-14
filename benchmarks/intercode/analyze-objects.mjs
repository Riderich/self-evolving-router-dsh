// Read-only analysis of the preserved run; no models, Docker or registry mutations.
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
const output=resolve(process.argv[2]), report=JSON.parse(await readFile(join(output,'report.json'),'utf8'))
const events=(await readFile(join(output,'http.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse)
const requests=events.filter(e=>e.type==='request'), byId=new Map(requests.map(e=>[e.id,e]))
const sum=(xs,k)=>xs.reduce((n,x)=>n+(x?.[k]??0),0)
function provider(ids){
 const rows=ids.map(id=>{
  const response=events.filter(e=>e.id===id&&['response','response-error'].includes(e.type)).at(-1),body=response?.body??response?.partialBody??'';let usage,model
  for(const line of body.split('\n'))if(line.startsWith('data: '))try{const chunk=JSON.parse(line.slice(6));if(chunk.usage)usage=chunk.usage;if(chunk.model)model=chunk.model}catch{}
  const known=Number.isFinite(usage?.prompt_tokens)&&Number.isFinite(usage?.completion_tokens),cached=usage?.prompt_tokens_details?.cached_tokens??usage?.prompt_cache_hit_tokens
  return{id,known,model,streamDone:body.includes('data: [DONE]'),observerError:response?.error??null,prompt:known?usage.prompt_tokens:null,output:known?usage.completion_tokens:null,cached:Number.isFinite(cached)?cached:null,uncached:known&&Number.isFinite(cached)?usage.prompt_tokens-cached:null,reasoning:usage?.completion_tokens_details?.reasoning_tokens??null}
 })
 return{calls:ids.length,unknownUsage:rows.filter(r=>!r.known).length,unknownCacheSplit:rows.filter(r=>r.cached===null).length,promptTokens:sum(rows,'prompt'),outputTokens:sum(rows,'output'),cachedInputTokens:sum(rows,'cached'),uncachedInputTokens:sum(rows,'uncached'),totalTokens:sum(rows,'prompt')+sum(rows,'output'),rows}
}
const physical=provider(requests.map(r=>r.id)),checks=[],conditions={},lineages={},leakage=[]
const assigned=[...report.runs.flatMap(r=>r.requestIds),...report.maintenance.flatMap(m=>m.requestIds)]
checks.push({check:'every physical request attributed once',passed:assigned.length===requests.length&&new Set(assigned).size===assigned.length&&assigned.every(id=>byId.has(id))})
checks.push({check:'physical HTTP cap',passed:requests.length<=report.maxHTTPCalls})
checks.push({check:'source reset fingerprints unchanged',passed:report.runs.every(r=>r.sourceUnchanged)})
checks.push({check:'routed turns make zero HTTP requests',passed:report.runs.filter(r=>r.routed).every(r=>r.requestIds.length===0)})
checks.push({check:'known provider usage and complete stream terminator',passed:physical.rows.every(r=>r.known&&r.streamDone)})
for(const m of report.maintenance.filter(m=>m.kind==='model-maintenance')){
 const future=report.stream.filter(t=>m.label==='initial'?[40,56].includes(t.index):t.index===56)
 const matches=m.requestIds.flatMap(id=>future.filter(t=>JSON.stringify(byId.get(id)?.body).includes(t.query)).map(t=>({requestId:id,futureIndex:t.index})))
 leakage.push({condition:m.condition,label:m.label,unseenExactQueries:future.map(t=>t.index),matches})
}
checks.push({check:'no exact future request text in maintenance inputs',passed:leakage.every(x=>!x.matches.length),limit:'Exact-text audit only; not a general proof of no contamination.'})
for(const c of report.conditions){
 const state=JSON.parse(await readFile(join(output,`${c}-final-state.json`),'utf8'))
 const rows=[...report.runs.filter(r=>r.condition===c),...(['B2','B3','B4'].includes(c)?report.runs.filter(r=>r.condition==='B0'&&[20,22,28].includes(r.index)):[])]
 const maintenance=[...report.maintenance.filter(m=>m.condition===c),...(c==='B4'?report.maintenance.filter(m=>m.condition==='B3'&&m.label==='initial'):[])]
 const ids=[...rows.flatMap(r=>r.requestIds),...maintenance.flatMap(m=>m.requestIds)],u=provider(ids)
 const hostRows=[...rows.map(r=>r.turn.usage),...Object.values(state.maintenance?.calls??{}).map(x=>x.usage)]
 const host={inputTokens:sum(hostRows,'inputTokens'),cacheReadTokens:sum(hostRows,'cacheReadTokens'),cacheWriteTokens:sum(hostRows,'cacheWriteTokens'),outputTokens:sum(hostRows,'outputTokens')}
 checks.push({check:`${c} host/provider token reconciliation`,passed:host.inputTokens+host.cacheReadTokens+host.cacheWriteTokens===u.promptTokens&&host.outputTokens===u.outputTokens})
 const routed=rows.filter(r=>r.routed),correctRoutes=routed.filter(r=>r.correct),bd=report.boundaries.filter(b=>b.condition===c)
 const future=rows.filter(r=>[40,56].includes(r.index))
 conditions[c]={...report.summary[c],usage:{...u,rows:undefined},hostUsage:host,routePrecision:routed.length?correctRoutes.length/routed.length:null,correctRouteCoverage:correctRoutes.length/rows.length,
  future:future.map(r=>({index:r.index,correct:r.correct,routed:r.routed,calls:r.httpRequests,wallMs:r.wallMs})),boundaryChecks:bd.length,boundaryMisroutes:bd.filter(b=>b.result.kind!=='fallback').length,
  validationMs:sum(Object.values(state.proofs),'durationMs'),maintenanceCalls:maintenance.reduce((n,m)=>n+m.httpRequests,0),manualImplementationCost:null}
 lineages[c]={active:state.active,chains:Object.values(state.maintenance?.chains??{}).map(x=>({id:x.id,status:x.status,attempts:x.attempts,sourceIds:x.source_ids,stable:x.stable_revision,latest:x.latest_revision,promoted:x.promoted_revision})),
  proofs:Object.values(state.proofs).map(p=>({validationId:p.validation_id,target:p.target,passed:p.passed,status:p.status,passingCases:p.results.filter(r=>r.passed).length,totalCases:p.results.length,failedCases:p.results.filter(r=>!r.passed).map(r=>({id:r.case_id,expected:r.expected,observed:r.runs.map(x=>({kind:x.kind,reason:x.reason,text:x.text,errors:x.triggers?.map(t=>t.error).filter(Boolean)}))}))}))}
}
const b0=conditions.B0,b3=conditions.B3,b4=conditions.B4
const comparison={b4VersusB0:{tokenChange:b4.usage.totalTokens-b0.usage.totalTokens,wallChangeMs:b4.totalMs-b0.totalMs},b4VersusB3:{tokenChange:b4.usage.totalTokens-b3.usage.totalTokens,wallChangeMs:b4.totalMs-b3.totalMs},
 observedBreakEven:report.completed&&b4.usage.totalTokens<=b0.usage.totalTokens&&b4.totalMs<=b0.totalMs,
 caution:'Observed whole-stream comparison only. No amortized reuse forecast from two future tasks; no monetary cost or confidence interval.'}
const analysis={protocol:report.protocol,completed:report.completed,physical,checks,conditions,lineages,leakage,comparison,limitations:report.limitations}
await writeFile(join(output,'analysis.json'),JSON.stringify(analysis,null,2),{mode:0o600})
console.log(JSON.stringify({completed:report.completed,physicalCalls:physical.calls,physicalTokens:physical.totalTokens,checks,summary:Object.fromEntries(Object.entries(conditions).map(([k,v])=>[k,{correct:v.correct,routed:v.routed,tokens:v.usage.totalTokens,seconds:v.totalMs/1000,maintenanceCalls:v.maintenanceCalls}]))},null,2))
assert(checks.every(c=>c.passed),'Accounting/integrity check failed; inspect analysis.json')
