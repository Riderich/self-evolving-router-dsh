// New v2 ledger: configurable explicit ceiling; independent of preserved v1 limits.
import {readFileSync,appendFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
const auth=JSON.parse(readFileSync(process.env.ROUTER_ACCEPTANCE_AUTH,'utf8')),journal=process.env.ROUTER_ACCEPTANCE_JOURNAL,target=new URL(auth.baseURL),maximum=Number(process.env.ROUTER_ACCEPTANCE_MAX_CALLS)
if(!Number.isSafeInteger(maximum)||maximum<1||maximum>2048)throw Error('Explicit v2 HTTP budget required')
const original=globalThis.fetch,redact=s=>s.replaceAll(auth.apiKey,'[REDACTED]'),record=x=>appendFileSync(journal,redact(JSON.stringify({time:new Date().toISOString(),...x}))+'\n',{mode:0o600})
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
 if(url.origin!==target.origin||!url.pathname.endsWith('/chat/completions'))throw Error('Unaccounted network denied in v2 experiment')
 const prior=readFileSync(journal,'utf8').split('\n').filter(Boolean).map(JSON.parse);if(prior.filter(x=>x.type==='request').length>=maximum)throw Error('V2_GLOBAL_BUDGET_EXHAUSTED')
 const id=randomUUID(),start=performance.now();record({type:'request',id,body:JSON.parse(init.body)})
 try{const response=await original(input,init),copy=response.clone();void(async()=>{let body='';try{const reader=copy.body.getReader(),decoder=new TextDecoder();for(;;){const r=await reader.read();if(r.done)break;body+=decoder.decode(r.value,{stream:true})}body+=decoder.decode();record({type:'response',id,status:response.status,body,durationMs:performance.now()-start})}catch(e){record({type:'response-error',id,partialBody:body,error:e.message,durationMs:performance.now()-start})}})();return response}
 catch(e){record({type:'transport-error',id,error:e.message,durationMs:performance.now()-start});throw e}
}
