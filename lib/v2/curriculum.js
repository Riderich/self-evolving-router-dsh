import {mkdir,writeFile,rm,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {sandbox} from './core.js'
import {assert} from '../schema.js'
import {event} from '../store.js'

// Trusted sequential delivery. Only the current public task enters the container.
export class Curriculum {
 constructor(store,sid,plan){this.store=store;this.sid=sid;this.plan=plan;this.busy=false}
 async init(){
  assert(['batch','autonomous'].includes(this.plan.mode),'Invalid schedule')
  assert(Number.isInteger(this.plan.batchSize)&&this.plan.batchSize>0,'Invalid batch size')
  assert(Array.isArray(this.plan.tasks)&&this.plan.tasks.length>0,'Tasks required')
  await this.store.transaction(s=>{s.sessions[this.sid].curriculum={mode:this.plan.mode,index:-1,phase:'ready',answers:[],solves:[],decisions:[],deliveredCall:-1}})
 }
 async state(){const s=await this.store.read();assert(!s.frozen&&s.sessions[this.sid].status==='running','Training inactive');return {s,c:s.sessions[this.sid].curriculum,session:s.sessions[this.sid]}}
 async exclusive(fn){assert(!this.busy,'Sequential training tools only');this.busy=true;try{return await fn()}finally{this.busy=false}}
 async next(){
  const {session,c}=await this.state(),index=c.index+1
  if(index===this.plan.tasks.length){await this.store.transaction(s=>{s.sessions[this.sid].curriculum.phase='done';event(s,'curriculum-done',{sid:this.sid})});return {done:true}}
  const t=this.plan.tasks[index];assert(typeof t.id==='string'&&typeof t.request==='string'&&t.files&&typeof t.files==='object','Invalid public task')
  const dir=join(session.root,'lesson');await rm(dir,{recursive:true,force:true});await mkdir(dir,{mode:0o755});let bytes=0
  for(const [p,text]of Object.entries(t.files)){assert(/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p)&&typeof text==='string'&&(bytes+=Buffer.byteLength(text))<=1048576,'Invalid public fixture');await mkdir(join(dir,p,'..'),{recursive:true,mode:0o755});await writeFile(join(dir,p),text,{mode:0o444})}
  await this.store.transaction(s=>{const x=s.sessions[this.sid];Object.assign(x.curriculum,{index,phase:'task',deliveredCall:x.calls.length});event(s,'curriculum-task',{sid:this.sid,index,id:t.id})})
  return {taskId:t.id,request:t.request,answerContract:t.answerContract??'Return only the requested result.',position:index+1}
 }
 async solve(command,signal){return this.exclusive(async()=>{
  const {s,c,session}=await this.state();assert(c.phase==='task','No active task');assert(session.calls.length>c.deliveredCall,'Current task must be processed by a new model call');assert(typeof command==='string'&&command.length>0&&command.length<=65536&&!command.includes('\0'),'Invalid solve command')
  const result=await sandbox(s.config,[{source:join(session.root,'lesson'),target:'/testbed',readonly:true}],command,{cwd:'/testbed',signal,timeoutMs:60000})
  await this.store.transaction(x=>{x.sessions[this.sid].curriculum.solves.push({index:c.index,command,result,call:session.calls.length});event(x,'curriculum-solve',{sid:this.sid,index:c.index,exitCode:result.exitCode})});return result
 })}
 async control(a){return this.exclusive(async()=>{
  const {c,session}=await this.state()
  if(a.action==='next'){assert(c.phase==='ready','Use submit for the current task');return this.next()}
  if(a.action==='begin_development'){
   assert(this.plan.mode==='autonomous'&&c.phase==='task','Manual start only in autonomous task phase');assert(typeof a.reason==='string'&&a.reason.trim(),'Record why development is useful')
   await this.store.transaction(s=>{const x=s.sessions[this.sid].curriculum;x.phase='development';x.decisions.push({index:c.index,action:a.action,reason:a.reason,call:session.calls.length,trigger:'agent'});event(s,'curriculum-development',{sid:this.sid,index:c.index,trigger:'agent',reason:a.reason})});return {phase:'development',resume:'Call end_development to resume this task.'}
  }
  if(a.action==='end_development'){
   assert(c.phase==='development','Not developing');await this.store.transaction(s=>{const x=s.sessions[this.sid].curriculum;x.decisions.push({index:c.index,action:a.action,reason:a.reason??'',call:session.calls.length});x.phase='task'})
   return this.plan.mode==='batch'?this.next():{phase:'task',taskId:this.plan.tasks[c.index].id}
  }
  assert(a.action==='submit'&&c.phase==='task','Cannot submit now');assert(typeof a.answer==='string'&&a.answer.length<=65536,'Answer required');const trace=c.solves.filter(x=>x.index===c.index);assert(trace.length>0&&session.calls.length>c.deliveredCall,'Every task requires model-mediated solve execution')
  const t=this.plan.tasks[c.index];await this.store.observe({id:t.id,request:t.request,output:a.answer,trajectory:trace,route:{routed:false,reason:'training-always-model'}})
  await this.store.transaction(s=>{s.sessions[this.sid].curriculum.answers.push({index:c.index,id:t.id,answer:a.answer,call:session.calls.length});event(s,'curriculum-submit',{sid:this.sid,index:c.index,id:t.id})})
  const history=(await this.store.read()).history;await chmod(join(session.root,'history','observed.json'),0o644);await writeFile(join(session.root,'history','observed.json'),JSON.stringify(history,null,2));await chmod(join(session.root,'history','observed.json'),0o444)
  if(this.plan.mode==='batch'&&((c.index+1)%this.plan.batchSize===0||c.index+1===this.plan.tasks.length)){
   await this.store.transaction(s=>{const x=s.sessions[this.sid].curriculum;x.phase='development';x.decisions.push({index:c.index,action:'batch_opportunity',trigger:'scheduler',call:session.calls.length});event(s,'curriculum-development',{sid:this.sid,index:c.index,trigger:'scheduler'})});return {received:true,phase:'development',instruction:'Review accumulated work and decide whether to develop reusable capabilities. You may skip. Call end_development when finished.'}
  }
  return this.next()
 })}
 async guardDevelopment(){const {c}=await this.state();assert(c.phase==='development','Enter a development interval before using development tools')}
}
