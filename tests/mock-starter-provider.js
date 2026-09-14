// Fully offline DSH fixture: update the active seed's trigger, preserve executor.
import { appendFileSync } from 'node:fs'
let turn=0
const steps=[
 ['rule',{action:'edit_trigger'}],
 ['str_replace_editor',{command:'str_replace',path:'/draft/trigger.py',old_str:"== 'list visible files'",new_str:"in ('list visible files', 'show visible files', 'display visible files')"}],
 ['rule',{action:'submit_rule'}],['rule',{action:'validate_rule'}],['rule',{action:'activate_rule'}],
]
globalThis.fetch=async(url,options)=>{
 if(String(url)!=='https://starter-test.invalid/v1/chat/completions')throw Error('All external network forbidden')
 const body=JSON.parse(options.body),prompt=JSON.stringify(body.messages)
 if(!prompt.includes('Working router examples')||!prompt.includes('starter-list-files')||!prompt.includes('follow_symlinks'))throw Error('Working seed code missing from few-shot')
 appendFileSync(process.env.STARTER_TEST_CALLS,JSON.stringify({turn,body})+'\n')
 const step=steps[turn++];if(turn>6)throw Error('Offline fixture call limit')
 const delta=step?{tool_calls:[{index:0,id:'starter-operation',type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{content:'Incremental trigger update validated and activated.'}
 const rows=[{choices:[{index:0,delta}]},{choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}]
 return new Response(rows.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
}
