#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,realpath,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const args=process.argv.slice(2)
if(args.length){
  if(args.length===1&&args[0]==='--help'){
    console.log('npm run demo\nChecks Docker, downloads the pinned image if missing and runs a zero-API example in a fresh .sandbox/demo-* directory. No DSH profile or API credentials required.')
  }else{console.error('Unknown option. Use npm run demo -- --help');process.exitCode=1}
}else{
  const root=fileURLToPath(new URL('../',import.meta.url))
  const context=process.env.ROUTER_DOCKER_CONTEXT??process.env.DOCKER_CONTEXT??''
  const prefix=context?['--context',context]:[]
  const image='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285'
  function run(command,argv,{visible=false,timeoutMs=30000}={}){
    return new Promise((resolve,reject)=>{
      const child=spawn(command,argv,{cwd:root,stdio:visible?'inherit':['ignore','pipe','pipe']})
      let stdout='',stderr='',timedOut=false
      child.stdout?.on('data',x=>{stdout+=x})
      child.stderr?.on('data',x=>{stderr+=x})
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},timeoutMs)
      child.on('error',e=>{clearTimeout(timer);reject(e)})
      child.on('close',code=>{clearTimeout(timer);if(timedOut)reject(Error(`${command} timed out`));else resolve({code,stdout,stderr})})
    })
  }
  async function checked(command,argv,options){const r=await run(command,argv,options);if(r.code!==0)throw Error(r.stderr.trim()||`${command} failed (${r.code})`);return r.stdout}
  try{
    if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22+ is required.')
    console.log('1/3 Checking Docker…')
    try{await checked('docker',[...prefix,'info','--format','{{.ServerVersion}}'])}
    catch{throw Error('Docker is unavailable. Start Docker Desktop or Colima, then retry. For Colima: ROUTER_DOCKER_CONTEXT=colima npm run demo')}
    const available=await run('docker',[...prefix,'image','inspect',image])
    if(available.code!==0){console.log('Downloading the pinned Python image (first run only)…');await checked('docker',[...prefix,'pull',image],{visible:true,timeoutMs:600000})}
    const sandbox=join(root,'.sandbox');await mkdir(sandbox,{recursive:true})
    const directory=await realpath(await mkdtemp(join(sandbox,'demo-')))
    const task=join(directory,'task'),snapshots=join(directory,'snapshots')
    await mkdir(task);await mkdir(snapshots);await writeFile(join(task,'example.php'),'hello\nworld\n')
    console.log('2/3 Installing and checking the starter capability…')
    console.log(`Demo workspace: ${directory}`)
    await checked(process.execPath,[join(root,'v2.js'),'init',task,snapshots],{timeoutMs:180000})
    console.log('3/3 Running: Count total lines in PHP files in /testbed')
    const result=JSON.parse(await checked(process.execPath,[join(root,'v2.js'),'route',task,'Count total lines in PHP files in /testbed'],{timeoutMs:30000}))
    if(result.kind!=='completed'||result.text!=='2\n'||result.modelCalls!==0)throw Error(`Demo did not produce the expected result: ${JSON.stringify(result)}`)
    console.log('\nSuccess: 2 lines · 0 model calls · no API credentials used.')
    console.log(`Task directory: ${task}`)
    console.log('Next: see docs/getting-started.md to connect the full DSH agent.')
  }catch(e){console.error(`Demo failed: ${e.message}`);process.exitCode=1}
}
