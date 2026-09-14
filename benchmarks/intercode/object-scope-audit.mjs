// Post-hoc synthetic scope probes. Never add these to the completed stream score.
// No model calls; copy frozen registry so original run evidence stays unchanged.
import { cp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ObjectRouter } from '../../lib/rule-router.js'
import { inventory, expected } from './protocol.js'
const run=await realpath(resolve(process.argv[2])),output=resolve(process.argv[3])
await mkdir(output,{recursive:false,mode:0o700})
const root=join(output,'workspace');await cp(join(run,'B3'),root,{recursive:true})
const {files}=await inventory(resolve(process.argv[4]))
const probes=[
 {id:'subdirectory',request:'Count all the lines of all php files in the /testbed/dir1 directory recursively',keep:p=>p.startsWith('dir1/')},
 {id:'exclude-subdirectory',request:'Count all the lines of all php files in the /testbed directory recursively, excluding dir1',keep:p=>!p.startsWith('dir1/')},
]
const results=[]
for(const p of probes){
 const oracle=expected({oracle:'lines',extension:'php'},Object.fromEntries(Object.entries(files).filter(([name])=>p.keep(name))))
 const result=await new ObjectRouter(root).route(p.request)
 results.push({id:p.id,request:p.request,oracle,result,incorrectAutomation:result.kind==='completed'&&result.text!==oracle,safeAbstention:result.kind==='fallback'})
}
const report={kind:'post-hoc-synthetic-scope-audit',modelCalls:0,sourceRun:run,frozenStateHash:(await import('../../lib/rule-contract.js')).hash(JSON.parse(await readFile(join(run,'B3-final-state.json'),'utf8'))),results,
 caveat:'Probes chosen after reading the learned trigger. Diagnostic counterexamples, not held-out success rates or additional original benchmark tasks. Original registry and scores unchanged.'}
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({output,modelCalls:0,results:results.map(r=>({id:r.id,oracle:r.oracle,kind:r.result.kind,text:r.result.text,incorrectAutomation:r.incorrectAutomation}))},null,2))
