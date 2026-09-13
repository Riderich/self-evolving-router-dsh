import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processOutput } from './rule-worker.js'
import { maintenanceState } from './maintenance-state.js'
import { event } from './store.js'
export function dshMaintenanceRunner(store,{authFile=process.env.DSH_ROUTER_AUTH_FILE,providerFile=process.env.DSH_ROUTER_PROVIDER_FILE,loader}={}){
  return async chain=>{
    const s=await store.read(),m=maintenanceState(s),dir=join(store.dir,'runs',`${chain.id}-${chain.attempts}`)
    await mkdir(dir,{recursive:true})
    const session=await mkdtemp(join(s.config.snapshotDirectory,'dsh-maintenance-session-'))
    const config=join(dir,'session.json');await writeFile(config,JSON.stringify({root:store.root,chain_id:chain.id}),{mode:0o600})
    const args=[...(loader?['--import',loader]:[]),fileURLToPath(new URL('../run.js',import.meta.url)),...(authFile?['--auth-file',authFile]:[]),...(providerFile?['--provider-file',providerFile]:[]),'--object-maintenance-file',config,'Maintain the permitted executable rule. Use the tools to produce a validated working version.']
    const started=performance.now();let result
    try{result=await processOutput(process.execPath,args,{cwd:session,timeoutMs:m.config.timeoutMs,maxOutputBytes:200000});await writeFile(join(dir,'process.json'),JSON.stringify(result,null,2));if(result.exitCode!==0)throw Error(`DSH maintenance exited ${result.exitCode}: ${result.stderr.slice(-1500)}`)}
    catch(e){if(e.processOutput)await writeFile(join(dir,'process.json'),JSON.stringify({...e.processOutput,error:e.message},null,2));throw e}
    finally{await store.transaction(s=>event(s,'maintenance-process',{chain_id:chain.id,durationMs:performance.now()-started,exitCode:result?.exitCode??null,runDirectory:dir}));await rm(session,{recursive:true,force:true})}
    return result
  }
}
