import {Curriculum} from './curriculum.js'
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {startDevelopment,Development,writable} from './development.js'
import {processOutput} from '../rule-worker.js'
export async function installSeed(store,config){await store.configure(config);const sid=await startDevelopment(store,{maxCalls:1}),dev=new Development(store,sid),s=await store.read(),dir=join(s.sessions[sid].root,'capabilities','files');await cp(fileURLToPath(new URL('../../examples/capabilities/files',import.meta.url)),dir,{recursive:true});await writable(dir);try{const p=await dev.publish('files');if(!p.published)throw Error(JSON.stringify(p));return p}finally{await dev.finish()}}
export async function develop(store,{authFile,loader,maxCalls=64,timeoutMs=900000,curriculum}){
 const sid=await startDevelopment(store,{maxCalls}),dev=new Development(store,sid),s=await store.read(),dir=s.sessions[sid].root,file=join(dir,'session.json');await writeFile(file,JSON.stringify({root:store.root,sid,maxCalls,...(curriculum?{curriculum}:{})}),{mode:0o600});let proc,error
 if(curriculum)await new Curriculum(store,sid,curriculum).init()
 try{proc=await processOutput(process.execPath,[...(loader?['--import',loader]:[]),fileURLToPath(new URL('../../run.js',import.meta.url)),'--auth-file',authFile,'--development-file',file,curriculum?'Start the sequential training stream.': 'Review the observed training history. Decide whether to improve persistent deterministic capabilities, implement and test improvements yourself, and publish useful working changes. You may skip unnecessary changes.'],{cwd:join(dir,'scratch'),timeoutMs,maxOutputBytes:200000});if(proc.exitCode!==0)error=proc.stderr}
 catch(e){error=e.message;proc=e.processOutput??{}}
 finally{await writeFile(join(dir,'process.json'),JSON.stringify({...proc,error},null,2));await dev.finish(error)}
 const state=(await store.read()).sessions[sid];return {sid,process:proc,error,status:state.status,...(curriculum?{curriculumComplete:state.curriculum?.phase==='done'}:{})}
}
