#!/usr/bin/env node
import {resolve,join} from 'node:path'
import {readFile,writeFile,realpath,mkdir} from 'node:fs/promises'
import {CapabilityStore,CapabilityRouter} from './lib/v2/core.js'
import {installSeed,develop} from './lib/v2/runner.js'
const [action,root,...args]=process.argv.slice(2)
if(!action||action==='--help'){
 console.log('dsh-router-v2 init ROOT DOCKER_SHARED_SNAPSHOTS\ndsh-router-v2 observe ROOT OBSERVED_HISTORY_JSON\ndsh-router-v2 develop ROOT PRIVATE_AUTH [MAX_MODEL_CALLS=64]\ndsh-router-v2 route ROOT REQUEST...\ndsh-router-v2 freeze ROOT\ndsh-router-v2 status ROOT\nDevelop calls the configured model. Observe records actual history, not verified benchmark answers.');
}else try{
 if(!['init','observe','develop','route','freeze','status'].includes(action))throw Error('Unknown command; use --help')
 if(!root)throw Error('ROOT required');const store=new CapabilityStore(await realpath(resolve(root)));let result
 const initialized=await store.exists()
 if(action==='status'&&!initialized){console.log(JSON.stringify({initialized:false,root:store.root},null,2));process.exit(0)}
 if(action!=='init'&&!initialized)throw Error('No v2 registry. Run init first; see --help')
 if(action==='init'){if(!args[0])throw Error('Docker-shared snapshot path required');if(initialized)throw Error('Existing registry; init never overwrites it');await mkdir(resolve(args[0]),{recursive:true});const snapshots=await realpath(resolve(args[0]));if(snapshots===store.root||snapshots.startsWith(store.root+'/'))throw Error('Snapshot directory must be outside the task workspace');result=await installSeed(store,{enabled:true,image:'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??process.env.DOCKER_CONTEXT??'',snapshotDirectory:snapshots,pids:64,triggerTimeoutMs:5000})}
 else if(action==='observe'){if(!args[0])throw Error('Observed history JSON path required');await store.observe(JSON.parse(await readFile(resolve(args[0]),'utf8')));result={recorded:true}}
 else if(action==='develop'){if(!args[0])throw Error('Private auth path required');result=await develop(store,{authFile:resolve(args[0]),maxCalls:Number(args[1]??64)});if(result.status!=='complete')process.exitCode=1}
 else if(action==='route'){if(!args.join(' ').trim())throw Error('Request text required');result=await new CapabilityRouter(store.root).route(args.join(' '))}
 else if(action==='freeze'){result=await store.freeze();await writeFile(join(store.dir,'frozen.json'),JSON.stringify(result,null,2),{mode:0o600})}
 else if(action==='status'){const s=await store.read();result={initialized:true,backend:s.version,active:s.active,frozen:s.frozen,history:s.history.length,sessions:Object.values(s.sessions).map(x=>({id:x.id,status:x.status,modelCalls:x.calls.length}))}}
 else throw Error('Unknown command; use --help')
 console.log(JSON.stringify(result,null,2))
}catch(e){console.error(e.message);process.exitCode=1}
