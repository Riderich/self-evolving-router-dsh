import {readFile,lstat,mkdir,writeFile,rm,chmod,readdir,realpath,open} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Store,event} from '../store.js'
import {hash,ruleConfig,schema,valueMatches,id} from '../rule-contract.js'
import {assert,requestVeto,sensitive} from '../schema.js'
import {processOutput,requestSnapshot} from '../rule-worker.js'
export const VERSION='autonomous-capability-v2'
export function capability(files){
 assert(files&&typeof files==='object'&&!Array.isArray(files),'Package files required')
 assert(Object.keys(files).length<=64&&Buffer.byteLength(JSON.stringify(files))<=262144,'Package too large')
 for(const [p,v]of Object.entries(files))assert(/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(py|json|md|txt)$/.test(p)&&typeof v==='string'&&!v.includes('\0'),'Invalid package path/content')
 for(const p of ['manifest.json','parser.py','executor.py','CONTRACT.md'])assert(typeof files[p]==='string',`Missing ${p}`)
 const m=JSON.parse(files['manifest.json']);assert(m.version===2&&id(m.id)&&m.effect==='public-workspace-read','Unsupported identity/effect')
 assert(m.operations&&Object.keys(m.operations).length>0&&Object.keys(m.operations).length<=32,'Operations required')
 for(const [name,o]of Object.entries(m.operations)){assert(/^[a-z][a-z0-9_.-]{1,80}$/.test(name),'Invalid operation');schema(o.args);schema(o.result);assert(['integer','text','lines','json'].includes(o.format),'Invalid formatter')}
 return {files,manifest:m,revision:hash(files)}
}
export async function readCapability(dir){
 assert(await realpath(dir)===resolve(dir),'Canonical package required');const files={};let count=0,size=0
 async function walk(path,prefix=''){for(const n of await readdir(path)){const p=join(path,n),s=await lstat(p);assert(!s.isSymbolicLink()&&++count<=96,'Package links/count rejected');if(s.isDirectory())await walk(p,prefix+n+'/');else{assert(s.isFile()&&s.nlink===1&&(size+=s.size)<=262144,'Package size/type rejected');files[prefix+n]=await readFile(p,'utf8')}}}
 await walk(dir);return capability(files)
}
export class CapabilityStore extends Store{
 constructor(root){super(root);this.dir=join(this.root,'.dsh','capabilities-v2')}
 async exists(){try{await lstat(join(this.dir,'state.json'));return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
 async read(){await this.init();try{const p=join(this.dir,'state.json');assert(!(await lstat(p)).isSymbolicLink(),'State link');const s=JSON.parse(await readFile(p,'utf8'));assert(s.version===VERSION&&Array.isArray(s.events),'Invalid state');s.config=ruleConfig(s.config);return s}catch(e){if(e.code!=='ENOENT')throw e;return {version:VERSION,revision:0,generation:0,config:ruleConfig(),active:{},packages:{},checks:{},history:[],sessions:{},events:[],frozen:false}}}
 async configure(config){return this.transaction(s=>{assert(!s.frozen,'Frozen');s.config=ruleConfig(config);s.generation++;s.active={}})}
 async observe(row){return this.transaction(s=>{assert(!s.frozen,'Frozen');assert(typeof row.request==='string'&&!s.history.some(h=>h.id===row.id),'Invalid/duplicate history');assert(!('oracle'in row)&&!('family'in row)&&!('verified'in row),'No evaluator labels in autonomous history');s.history.push({...row,evidence:'observed-agent-trajectory-not-oracle'});event(s,'development-history',{id:row.id})})}
 async freeze(){return this.transaction(s=>{assert(!Object.values(s.sessions).some(x=>x.status==='running'),'Development still running');s.frozen=true;event(s,'capability-freeze',{});return {digest:persistent(s),eventCount:s.events.length,eventPrefix:hash(s.events)}})}
}
export function persistent(s){const {events,revision,...rest}=s;return hash(rest)}
export async function checkFrozen(store,digest){const s=await store.read();assert(s.frozen&&persistent(s)===digest.digest,'Frozen capabilities changed');assert(hash(s.events.slice(0,digest.eventCount))===digest.eventPrefix&&s.events.slice(digest.eventCount).every(e=>['capability-route','capability-agent-turn'].includes(e.type)),'Frozen audit history changed');return true}
// All untrusted imports, parser/executor code and shell run only in an isolated container.
export async function sandbox(config,mounts,command,{cwd='/work',timeoutMs=30000,signal,input=''}={}){
 const c=ruleConfig(config),name='dsh-v2-'+randomUUID(),prefix=c.dockerContext?['--context',c.dockerContext]:[]
 const args=[...prefix,'run','--rm','--pull=never','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit',String(c.pids),'--memory',`${c.memoryMb}m`,'--cpus',String(c.cpus),'--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=16m']
 for(const m of mounts){assert(!m.source.includes(',')&&await realpath(m.source)===m.source,'Canonical mount required');args.push('--mount',`type=bind,source=${m.source},target=${m.target}${m.readonly?',readonly':''}`)}
 args.push('--workdir',cwd,'--env','LC_ALL=C.UTF-8','--env','TZ=UTC','--env','PYTHONDONTWRITEBYTECODE=1','-i',c.image,'/bin/bash','--noprofile','--norc','-c',command)
 const started=performance.now();let output
 try{output=await processOutput(c.dockerCommand,args,{timeoutMs,maxOutputBytes:262144,signal,input});return {...output,durationMs:performance.now()-started}}
 finally{const clean=await processOutput(c.dockerCommand,[...prefix,'rm','-f',name],{timeoutMs:5000});assert(clean.exitCode===0||/No such container/.test(clean.stderr),'Container cleanup unconfirmed')}
}
const wrapper=`import sys,json,runpy,platform\nassert platform.python_version()==sys.argv[1]\nsys.path.insert(0,'/capability')\np=json.load(sys.stdin)\nf=runpy.run_path('/capability/'+p['phase']+'.py')\nr=f['parse'](p['request'],p['context']) if p['phase']=='parser' else f['execute'](p['task'],p['context'])\nprint(json.dumps(r,allow_nan=False))`
export async function invoke(pkg,phase,payload,config,snap,signal){
 capability(pkg.files);const dir=join(config.snapshotDirectory,'capability-'+randomUUID());await mkdir(dir,{mode:0o755})
 try{for(const [p,text]of Object.entries(pkg.files)){await mkdir(join(dir,p,'..'),{recursive:true,mode:0o755});await writeFile(join(dir,p),text,{mode:0o444})}
 const mounts=[{source:dir,target:'/capability',readonly:true}];if(phase==='executor')mounts.push({source:snap.path,target:'/testbed',readonly:true})
 const encoded=Buffer.from(wrapper).toString('base64');const r=await sandbox(config,mounts,`python3 -I -B -c 'import base64;exec(base64.b64decode("${encoded}"))' '${config.pythonVersion}'`,{cwd:'/capability',timeoutMs:phase==='parser'?config.triggerTimeoutMs:config.executionTimeoutMs,signal,input:JSON.stringify({phase,...payload})});assert(r.exitCode===0,'Capability process failed: '+r.stderr.slice(0,500));return {result:JSON.parse(r.stdout),durationMs:r.durationMs}
 }finally{await rm(dir,{recursive:true,force:true})}
}
export function parsed(result,pkg,request){
 assert(['parsed','unsupported','ambiguous'].includes(result?.status),'Invalid parse status');if(result.status!=='parsed')return null
 const {task,evidence}=result,o=pkg.manifest.operations[task?.operation];assert(o&&valueMatches(task.args,o.args),'Invalid task parameters')
 assert(evidence&&evidence.original===request&&Array.isArray(evidence.spans)&&evidence.spans.length>0&&Array.isArray(evidence.defaults)&&Array.isArray(evidence.unexplained)&&evidence.unexplained.length===0,'Missing interpretation evidence')
 for(const s of evidence.spans)assert(Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.start>=0&&s.end>s.start&&request.slice(s.start,s.end)===s.text&&typeof s.field==='string','Invalid source span')
 return {task,evidence}
}
export function formatResult(result,operation){
 assert(result?.status==='completed'&&valueMatches(result.value,operation.result),'Invalid capability result')
 if(operation.format==='integer'){assert(Number.isSafeInteger(result.value),'Integer expected');return String(result.value)+'\n'}
 if(operation.format==='text'){assert(typeof result.value==='string','Text expected');return result.value}
 if(operation.format==='lines'){assert(Array.isArray(result.value)&&result.value.every(v=>typeof v==='string'&&!/[\r\n]/.test(v)),'Lines expected');return result.value.length?result.value.join('\n')+'\n':''}
 return JSON.stringify(result.value)+'\n'
}
export async function evaluate(packages,request,config,root,signal){
 const interpretations=[];let snap
 for(const pkg of packages){const r=await invoke(pkg,'parser',{request,context:{root:'/testbed',defaults:{recursive:false},version:2}},config,null,signal);if(r.result.status==='ambiguous')return {kind:'fallback',reason:'ambiguous'};const p=parsed(r.result,pkg,request);if(p)interpretations.push({...p,pkg})}
 if(!interpretations.length)return {kind:'fallback',reason:'unsupported'}
 if(new Set(interpretations.map(p=>hash(p.task))).size!==1)return {kind:'fallback',reason:'conflicting-interpretations'}
 // Equivalent task + contract only; immutable lexical ID tie-break, never benchmark scores.
 if(new Set(interpretations.map(p=>hash(p.pkg.manifest.operations[p.task.operation]))).size!==1)return {kind:'fallback',reason:'incompatible-contracts'}
 const p=interpretations.sort((a,b)=>a.pkg.manifest.id.localeCompare(b.pkg.manifest.id))[0]
 try{snap=await requestSnapshot(root,config,signal);const r=await invoke(p.pkg,'executor',{task:p.task,context:{root:'/testbed',snapshot_id:snap.id}},config,snap,signal);if(r.result.status==='fallback')return {kind:'fallback',reason:r.result.reason??'execution-fallback'};const text=formatResult(r.result,p.pkg.manifest.operations[p.task.operation]);assert(!sensitive(text),'Sensitive result');return {kind:'completed',text,task:p.task,evidence:p.evidence,program:p.pkg.manifest.id,hash:p.pkg.revision}}
 finally{if(snap)await snap.dispose()}
}
export class CapabilityRouter{
 constructor(root){this.store=new CapabilityStore(root)}
 async route(request,signal){const start=performance.now();let result
 try{const s=await this.store.read();assert(s.config.enabled&&!requestVeto(request),'Disabled/veto');const generation=s.generation,packages=Object.values(s.active).map(rev=>{const p=capability(s.packages[rev].files);assert(p.revision===rev,'Package modified');return p});assert(packages.length<=s.config.maxRules,'Too many capabilities');result=await evaluate(packages,request,s.config,this.store.root,signal?AbortSignal.any([signal,AbortSignal.timeout(s.config.routeTimeoutMs)]):AbortSignal.timeout(s.config.routeTimeoutMs));assert((await this.store.read()).generation===generation,'Registry changed')}
 catch(e){result={kind:'fallback',reason:'capability-error',detail:e.message}}
 result={...result,backend:VERSION,modelCalls:0,durationMs:performance.now()-start};await this.store.transaction(s=>event(s,'capability-route',{request:sensitive(request)?'[redacted]':request,...result}));return result}
}
