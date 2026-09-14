import { mkdir, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { RuleStore } from '../lib/rule-store.js'
import { installStarter, starterImage } from '../lib/starter-router.js'
if(!process.argv[2])throw Error('Usage: node scripts/setup-starter.mjs ROOT')
await mkdir(resolve(process.argv[2]),{recursive:true})
const root=await realpath(resolve(process.argv[2])),store=new RuleStore(root)
const result=await installStarter(store,{enabled:true,image:starterImage,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'',snapshotDirectory:resolve(process.env.ROUTER_SNAPSHOT_DIR??join(root,'.dsh','snapshots')),triggerTimeoutMs:5000,pids:64})
console.log(JSON.stringify({root,...result,note:'Working handwritten router installed. Active rules also serve as maintenance examples. No histories fabricated and no model called; explicit evolve or trusted verified observations can start paid maintenance.'},null,2))
