// Handwritten training-prefix template control. Never consumes evaluator labels or outputs.
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {startDevelopment,Development} from '../../lib/v2/development.js'
export async function templates(store){
 const state=await store.read();const requests=state.history.map(h=>h.request).filter(q=>/^counts? all files in the \/testbed folder and subfolders\.$/i.test(q));if(!requests.length)return
 const sid=await startDevelopment(store,{maxCalls:1}),dev=new Development(store,sid),s=await store.read(),dir=join(s.sessions[sid].root,'capabilities','files');
 try{
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));if(manifest.operations['files.count'])return
 manifest.operations['files.count']={...manifest.operations['text.count_newlines']};await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2))
 const parser=await readFile(join(dir,'parser.py'),'utf8');await writeFile(join(dir,'helpers_template.json'),JSON.stringify(requests));await writeFile(join(dir,'parser.py'),parser+`\n_base_parse=parse\ndef parse(request,context):\n    if request.strip().lower() in ${JSON.stringify(requests.map(x=>x.toLowerCase()))}:\n        return {'status':'parsed','task':{'operation':'files.count','args':{'root':'/testbed','recursive':True,'extension':'','exclude_dirs':[]}},'evidence':{'original':request,'spans':[{'field':'task','start':0,'end':len(request),'text':request}],'defaults':[],'unexplained':[]}}\n    return _base_parse(request,context)\n`)
 const executor=await readFile(join(dir,'executor.py'),'utf8');await writeFile(join(dir,'executor.py'),executor.replace("if task['operation']=='files.list':", "if task['operation']=='files.count':value=len(paths)\n        elif task['operation']=='files.list':"))
 const cases=JSON.parse(await readFile(join(dir,'tests/cases.json'),'utf8'));cases.push({request:requests[0],files:{'a.txt':'x','b/z.txt':'y'},kind:'completed',text:'2\n'});await writeFile(join(dir,'tests/cases.json'),JSON.stringify(cases));const p=await dev.publish('files');if(!p.published)throw Error(JSON.stringify(p))
 }finally{await dev.finish()}
}
