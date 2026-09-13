import { createRequire } from 'node:module'
import { realpath, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
export async function dshRuntime(){
  const require=createRequire(import.meta.url);let anchor,development=false
  if(process.env.DSH_ROUTER_RUNTIME)anchor=await realpath(join(resolve(process.env.DSH_ROUTER_RUNTIME),'node_modules/@deepseek-ai/dsh/package.json'))
  else{
    try{anchor=await realpath(require.resolve('@deepseek-ai/dsh/package.json'))}
    catch{
      // Compatibility for this research workspace only; published installations
      // resolve their declared DSH dependency above or an explicit runtime.
      anchor=await realpath(fileURLToPath(new URL('../../../dsh-runtime/node_modules/@deepseek-ai/dsh/package.json',import.meta.url)));development=true
    }
  }
  const pkg=JSON.parse(await readFile(anchor,'utf8'))
  if(pkg.version!=='0.1.0-rc.6')throw Error(`Unsupported DSH ${pkg.version}; expected 0.1.0-rc.6`)
  const home=process.env.DSH_HOME??(development?fileURLToPath(new URL('../../../dsh-runtime/state',import.meta.url)):join(homedir(),'.dsh'))
  return{anchor,require:createRequire(anchor),home,version:pkg.version,development}
}
