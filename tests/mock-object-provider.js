// Network-free DSH protocol fixture: first submit an overbroad trigger, consume
// real independent feedback, repair the file, and publish the new revision.
import { appendFileSync } from 'node:fs'
let turn=0
const trigger=`def trigger(request, context):
    if request.startswith('list'):
        return {'decision':'match','args':{},'reason_code':'supported'}
    return {'decision':'no_match','reason_code':'unsupported'}
`
const executor=`import os
def execute(request, args, context):
    return {'status':'completed','result':{'text':''.join(n+'\\n' for n in sorted(os.listdir(context['root'])))}}
`
const steps=[
 ['rule',{action:'create_rule'}],
 ['str_replace_editor',{command:'str_replace',path:'/draft/trigger.py',old_str:"def trigger(request, context):\n    return {'decision':'abstain','reason_code':'not_implemented'}\n",new_str:trigger}],
 ['str_replace_editor',{command:'str_replace',path:'/draft/executor.py',old_str:"def execute(request, args, context):\n    return {'status':'fallback','reason_code':'not_implemented'}\n",new_str:executor}],
 ['rule',{action:'submit_rule'}],['rule',{action:'validate_rule'}],['rule',{action:'diagnose_rule'}],
 ['rule',{action:'edit_trigger'}],
 ['str_replace_editor',{command:'str_replace',path:'/draft/trigger.py',old_str:"request.startswith('list')",new_str:"request == 'list visible files'"}],
 ['rule',{action:'submit_rule'}],['rule',{action:'validate_rule'}],['rule',{action:'activate_rule'}],
]
globalThis.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);if(process.env.OBJECT_TEST_CALLS)appendFileSync(process.env.OBJECT_TEST_CALLS,JSON.stringify({turn,model:body.model,messages:body.messages,tools:body.tools})+'\n')
 const step=steps[turn++];const delta=step?{tool_calls:[{index:0,id:'reused-provider-call-id',type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{content:'Verified rule repaired and activated.'}
 const rows=[{choices:[{index:0,delta}]},{choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:120,completion_tokens:30,total_tokens:150}}]
 return new Response(rows.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
}
