import {mkdir,writeFile,readFile,readdir,lstat,chmod,rm,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {CapabilityStore,capability,readCapability,evaluate,sandbox} from './core.js'
import {snapshot} from '../executor.js'
import {hash} from '../rule-contract.js'
import {event} from '../store.js'
import {assert} from '../schema.js'
export async function writable(dir){for(const n of await readdir(dir)){const p=join(dir,n),s=await lstat(p);assert(!s.isSymbolicLink(),'No workspace links');if(s.isDirectory())await writable(p);else await chmod(p,0o666)}await chmod(dir,0o777)}
export async function startDevelopment(store,{maxCalls=64}={}){
 const s=await store.read();assert(!s.frozen,'Frozen');assert(Number.isSafeInteger(maxCalls)&&maxCalls>0&&maxCalls<=256,'Invalid development budget');const sid=randomUUID(),root=join(store.dir,'development',sid)
 await mkdir(root,{recursive:true,mode:0o755});for(const d of ['capabilities','history','scratch'])await mkdir(join(root,d),{mode:d==='history'?0o755:0o777});await chmod(root,0o755)
 const copied=await snapshot(store.root,s.config.snapshotDirectory);const {cp}=await import('node:fs/promises');await cp(copied,join(root,'task'),{recursive:true});await rm(copied,{recursive:true,force:true});await writable(join(root,'task'))
 for(const [id,rev]of Object.entries(s.active)){const dir=join(root,'capabilities',id);await mkdir(dir,{mode:0o777});for(const [p,text]of Object.entries(s.packages[rev].files)){await mkdir(join(dir,p,'..'),{recursive:true,mode:0o777});await writeFile(join(dir,p),text,{mode:0o666})}await writable(dir)}
 await writeFile(join(root,'history','observed.json'),JSON.stringify(s.history,null,2),{mode:0o444})
 await store.transaction(x=>{assert(!x.frozen,'Frozen');x.sessions[sid]={id:sid,root,status:'running',maxCalls,calls:[],commands:[],createdAt:new Date().toISOString()};event(x,'development-start',{sid})})
 return sid
}
export class Development{
 constructor(store,sid){this.store=store;this.sid=sid}
 async context(){const s=await this.store.read(),session=s.sessions[this.sid];assert(session&&session.status==='running'&&!s.frozen,'Development not running/frozen');return {s,session}}
 async command(command,signal){assert(typeof command==='string'&&command.length>0&&command.length<=65536&&!command.includes('\0'),'Invalid command');const {s,session}=await this.context(),id=randomUUID(),start=performance.now();let result
 // No original root, registry, credentials, evaluator or API environment is mounted.
 try{result=await sandbox(s.config,[{source:join(session.root,'capabilities'),target:'/work/capabilities'},{source:join(session.root,'task'),target:'/work/task'},{source:join(session.root,'scratch'),target:'/work/scratch'},{source:join(session.root,'history'),target:'/work/history',readonly:true}],command,{cwd:'/work',timeoutMs:60000,signal});return {...result,log:id}}
 catch(e){result={error:e.message,...e.processOutput};throw e}
 finally{await this.store.transaction(x=>{x.sessions[this.sid].commands.push({id,command,result,durationMs:performance.now()-start});event(x,'development-command',{sid:this.sid,id,exitCode:result?.exitCode??null})})}}
 async finish(error=null){await this.store.transaction(s=>{const c=s.sessions[this.sid];assert(c,'Unknown session');c.status=c.calls.some(x=>x.status==='started')?'ambiguous':error?'failed':'complete';c.error=error;event(s,'development-end',{sid:this.sid,status:c.status})})}
 async check(id,signal){assert(/^[a-z][a-z0-9-]{1,63}$/.test(id),'Capability ID required');const {s,session}=await this.context();const collect=`import os,json,pathlib,stat
root=pathlib.Path('/work/capabilities/${id}')
assert not root.is_symlink() and root.is_dir()
files={}; total=0; count=0
for directory,dirs,names in os.walk(root,followlinks=False):
    dirs[:]=[d for d in dirs if d not in ('__pycache__','.pytest_cache')]
    for d in dirs: assert not pathlib.Path(directory,d).is_symlink()
    for n in names:
        p=pathlib.Path(directory,n); st=p.lstat()
        assert stat.S_ISREG(st.st_mode) and st.st_nlink==1
        total+=st.st_size; count+=1
        assert total<=262144 and count<=64
        files[str(p.relative_to(root))]=p.read_text()
print(json.dumps(files))`
 const encoded=Buffer.from(collect).toString('base64')
 const snapshot=await sandbox(s.config,[{source:join(session.root,'capabilities'),target:'/work/capabilities',readonly:true}],`python3 -I -B -c 'import base64;exec(base64.b64decode("${encoded}"))'`,{cwd:'/work',signal})
 assert(snapshot.exitCode===0,'Cannot snapshot development package: '+snapshot.stderr.slice(0,500))
 const pkg=capability(JSON.parse(snapshot.stdout));assert(pkg.manifest.id===id,'ID mismatch')
 const proposed=JSON.parse(pkg.files['tests/cases.json']??'null');assert(Array.isArray(proposed)&&proposed.length>=3&&proposed.length<=64,'Declare >=3 development cases in tests/cases.json')
 const previous=s.active[id],locked=Object.values(s.active).flatMap(rev=>s.packages[rev].lockedCases??[])
 const cases=[...new Map([...locked,...proposed].map(c=>[hash(c),c])).values()];assert(cases.length<=128,'Too many regression cases')
 assert(proposed.some(c=>c.kind==='unsupported')&&proposed.filter(c=>c.kind==='completed').length>=2,'Include positive variation and a rejected request')
 const target={...s.active,[id]:pkg.revision},packages=Object.entries(target).map(([name,rev])=>name===id?pkg:capability(s.packages[rev].files)),results=[]
 for(const c of cases){assert(typeof c.request==='string'&&c.files&&typeof c.files==='object'&&!Array.isArray(c.files)&&['completed','unsupported'].includes(c.kind),'Invalid declared case');const fixture=join(s.config.snapshotDirectory,'development-case-'+randomUUID());await mkdir(fixture,{mode:0o755});let size=0
 try{assert(Object.keys(c.files).length<=64,'Fixture too large');for(const [p,text]of Object.entries(c.files)){assert(/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p)&&typeof text==='string'&&(size+=Buffer.byteLength(text))<=131072,'Invalid fixture');await mkdir(join(fixture,p,'..'),{recursive:true,mode:0o755});await writeFile(join(fixture,p),text,{mode:0o444})}
 let actual;try{actual=await evaluate(packages,c.request,s.config,fixture,signal)}catch(e){actual={kind:'error',detail:e.message}}
 const passed=c.kind==='unsupported'?actual.kind==='fallback'&&['unsupported','ambiguous','conflicting-interpretations'].includes(actual.reason):actual.kind==='completed'&&actual.text===c.text&&(!c.task||hash(actual.task)===hash(c.task));results.push({request:c.request,passed,expected:c,actual})
 }finally{await rm(fixture,{recursive:true,force:true})}}
 const checkId=randomUUID(),row={id:checkId,sid:this.sid,revision:pkg.revision,package:pkg,target,generation:s.generation,environment:hash(s.config),passed:results.every(r=>r.passed),cases,results,evidence:'agent-declared-development-tests-not-independent-oracle',createdAt:new Date().toISOString()}
 await this.store.transaction(x=>{assert(!x.frozen,'Frozen');x.checks[checkId]=row;event(x,'development-check',{sid:this.sid,checkId,passed:row.passed})})
 return {checkId,revision:pkg.revision,passed:row.passed,total:results.length,failed:results.filter(r=>!r.passed).map(r=>({request:r.request,expected:r.expected.text??'unsupported',actual:r.actual})),evidence:row.evidence}
 }
 async publish(id,signal){
 // A single explicit publication request checks the immutable snapshot and switches atomically.
 const proof=await this.check(id,signal);if(!proof.passed)return {...proof,published:false}
 return this.store.transaction(s=>{assert(!s.frozen,'Frozen');const p=s.checks[proof.checkId];assert(s.generation===p.generation&&hash(s.config)===p.environment,'Stale publication; no switch');const prior=s.active[id]??null;assert(prior!==p.revision,'No code change');s.packages[p.revision]={files:p.package.files,lockedCases:p.cases,parent:prior,sourceIds:s.history.map(h=>h.id),checkId:p.id};s.active=p.target;s.generation++;event(s,'capability-publish',{sid:this.sid,id,revision:p.revision,parent:prior,checkId:p.id});return {...proof,published:true,activeRevision:p.revision}})
 }
 async rollback(id,revision){return this.store.transaction(s=>{assert(!s.frozen,'Frozen');const p=s.packages[revision];assert(p&&capability(p.files).manifest.id===id,'Unknown rollback target');const active=s.packages[s.active[id]];assert(active?.parent===revision,'Rollback must select previous active version');s.active[id]=revision;s.generation++;event(s,'capability-rollback',{sid:this.sid,id,revision});return {activeRevision:revision}})}
}
