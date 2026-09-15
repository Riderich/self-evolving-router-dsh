import {appendFileSync} from 'node:fs'
let turn=0
const mode=process.env.CURRICULUM_MOCK_MODE
const tool=(action,extra={})=>['training',{action,...extra}]
const solve=['solve',{command:'wc -l < /testbed/a.txt'}]
const edit=['bash',{command:"printf '\n# learned in ongoing task context\n' >> /work/capabilities/files/parser.py"}]
const publish=['capability',{action:'publish',id:'files'}]
const steps=mode==='batch'?[tool('next'),solve,tool('submit',{answer:'2'}),edit,publish,tool('end_development'),solve,tool('submit',{answer:'3'}),tool('end_development')]:[tool('next'),solve,tool('submit',{answer:'2'}),tool('begin_development',{reason:'Reuse observed line counting'}),edit,publish,tool('end_development'),solve,tool('submit',{answer:'3'})]
globalThis.fetch=async(url,options)=>{
 if(String(url)!=='https://starter-test.invalid/v1/chat/completions')throw Error('External network denied')
 const body=JSON.parse(options.body);if(body.tools.length!==6)throw Error('Wrong training tools')
 appendFileSync(process.env.CURRICULUM_MOCK_JOURNAL,JSON.stringify(body)+'\n')
 if(turn>=steps.length+1)throw Error('Mock limit')
 const step=steps[turn++],delta=step?{tool_calls:[{index:0,id:'curriculum-'+turn,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{content:'Training complete.'}
 return new Response([{choices:[{index:0,delta}]},{choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
}
