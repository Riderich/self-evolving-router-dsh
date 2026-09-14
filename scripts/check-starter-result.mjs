// Read-only model accounting; deterministic postcheck never loads API credentials.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {RuleStore} from '../lib/rule-store.js'
import {ObjectRouter} from '../lib/rule-router.js'
import {processOutput} from '../lib/rule-worker.js'
const output=resolve(process.argv[2]),root=join(output,'task-workspace'),store=new RuleStore(root)
const initial=JSON.parse(await readFile(join(output,'initial-state.json'),'utf8')),state=await store.read()
await writeFile(join(output,'state-before-postcheck.json'),JSON.stringify(state,null,2),{flag:'wx'})
const routes={}
for(const q of ['list visible files','show visible files','display visible files','count visible files','show visible files in dir1','show visible files excluding new-after-learning.txt'])routes[q]=await new ObjectRouter(root).route(q)
const nonce=randomUUID(),attempts=join(root,'.attempts-'+nonce),deny=join(root,'.deny-'+nonce+'.mjs')
await writeFile(attempts,'')
await writeFile(deny,`import{appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(attempts)},'attempt');throw Error('NETWORK_FORBIDDEN')}`)
let dsh
try{dsh=await processOutput(process.execPath,['--import',deny,fileURLToPath(new URL('../run.js',import.meta.url)),'show visible files'],{cwd:root,timeoutMs:180000})}catch(e){dsh={error:e.message,...e.processOutput}}
const calls=Object.values(state.maintenance.calls),rev=state.active['list-files'].revision,base=initial.active['list-files'].revision
const proof=state.proofs[state.active['list-files'].validation_id]
const summary={kind:'offline postcheck of existing paid update',routes,dsh,networkAttempts:await readFile(attempts,'utf8'),calls:calls.length,admissionCases:proof.results.length,admissionPassed:proof.passed,parentPreserved:JSON.parse(state.packages[rev].files['manifest.json']).parent_revision===base,executorUnchanged:state.packages[rev].files['executor.py']===initial.packages[base].files['executor.py'],otherRevisionsUnchanged:['count-files','recursive-lines'].every(k=>state.active[k].revision===initial.active[k].revision),unknownUsage:calls.filter(c=>!c.usage).length,usage:Object.fromEntries(['inputTokens','cacheReadTokens','cacheWriteTokens','outputTokens'].map(k=>[k,calls.reduce((n,c)=>n+(c.usage?.[k]??0),0)]))}
summary.passed=summary.admissionPassed&&summary.parentPreserved&&summary.otherRevisionsUnchanged&&['list visible files','show visible files','display visible files'].every(q=>routes[q].text==='new-after-learning.txt\n')&&routes['count visible files'].text==='1\n'&&['show visible files in dir1','show visible files excluding new-after-learning.txt'].every(q=>routes[q].kind==='fallback')&&dsh.exitCode===0&&dsh.stdout.trim()==='new-after-learning.txt'&&summary.networkAttempts===''
await writeFile(join(output,'postcheck.json'),JSON.stringify(summary,null,2),{flag:'wx'})
await writeFile(join(output,'state-after-postcheck.json'),JSON.stringify(await store.read(),null,2),{flag:'wx'})
console.log(JSON.stringify(summary,null,2));if(!summary.passed)process.exitCode=2
