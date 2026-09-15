// Authored public requests on InterCode-derived files, not official benchmark scores.
const families=['lines','files','bytes','words','contains','extensions']
function fixture(original,n){return {...original,[`practice/part${n}.php`]:`alpha beta\n${'hello world\n'.repeat(n%4+1)}`,[`practice/part${n}.txt`]:'hello x\nmore words here\n',[`archive/skip${n}.php`]:'skip\n',[`archive/skip${n}.txt`]:'hello\n'}}
function row(family,n,files,test=false){
 const extension=n%2?'txt':'php',exclude=n>=2,root=n%3===1?'/testbed/practice':'/testbed',scope=`${root} recursively${exclude?' excluding archive directories':''}`
 const queries={
  lines:[`Count total newline characters in .${extension} files under ${scope}.`,`Under ${scope}, how many newline characters do all .${extension} files contain in total?`],
  files:[`Count all regular .${extension} files under ${scope}.`,`How many regular files with extension .${extension} are under ${scope}?`],
  bytes:[`Count total bytes in all .${extension} files under ${scope}.`,`What is the combined byte count of .${extension} files under ${scope}?`],
  words:[`Count whitespace-separated words in all .${extension} files under ${scope}.`,`How many whitespace-separated words are in .${extension} files under ${scope} in total?`],
  contains:[`Count .${extension} files containing the literal case-sensitive text "hello" under ${scope}.`,`How many .${extension} files under ${scope} contain "hello" as a case-sensitive literal substring?`],
  extensions:[`Count distinct nonempty final file extensions, case-sensitive, among all regular files under ${scope}.`,`How many different nonempty final file extensions occur among regular files under ${scope}? Compare extensions case-sensitively.`]
 }
 const request=queries[family][test?1:n%2],selected=Object.entries(files).filter(([p])=>(root==='/testbed'||p.startsWith('practice/'))&&(!exclude||!p.split('/').slice(0,-1).includes('archive'))&&(family==='extensions'||p.endsWith('.'+extension)))
 let value;if(family==='files')value=selected.length;else if(family==='extensions')value=new Set(selected.map(([p])=>p.split('/').at(-1).includes('.')?p.split('.').at(-1):'').filter(Boolean)).size;else value=selected.reduce((sum,[,s])=>sum+(family==='lines'?(s.match(/\n/g)||[]).length:family==='bytes'?Buffer.byteLength(s):family==='words'?(s.match(/\S+/g)||[]).length:s.includes('hello')?1:0),0)
 return {id:`${test?'test':'train'}-${n}-${family}`,family,request,files,expected:String(value),answerContract:'Return exactly one nonnegative integer, with no explanation.'}
}
export function curriculumData(original){return {train:Array.from({length:4},(_,n)=>families.map(f=>row(f,n,fixture(original,n)))).flat(),test:Array.from({length:2},(_,i)=>families.map(f=>row(f,i+4,fixture(original,i+10),true))).flat(),limitations:['24 authored training requests, six operation families, 12 authored transfer tests on altered InterCode public files.','Development/exploratory, not sealed or official InterCode score.','Both arms share task order, files, model, seed and total call cap; their trajectories diverge after scheduling decisions.','Single order/replicate. Does not isolate batch size, context length or dataset size effects.']}}
export function publicCurriculum(data,mode){return {mode,batchSize:6,tasks:data.train.map(({id,request,files,answerContract})=>({id,request,files,answerContract}))}}
