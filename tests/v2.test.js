import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,rm,cp,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {capability,readCapability,parsed,formatResult,CapabilityStore,CapabilityRouter,checkFrozen,sandbox} from '../lib/v2/core.js'
import {Development,startDevelopment} from '../lib/v2/development.js'
import {installSeed} from '../lib/v2/runner.js'
import {processOutput} from '../lib/rule-worker.js'
const seed=fileURLToPath(new URL('../examples/capabilities/files',import.meta.url))
const image='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285'
test('v2 parser handles word order, Chinese, paths, constraints; rejects unexplained scope',async()=>{
 const code=`import runpy,json\np=runpy.run_path(${JSON.stringify(join(seed,'parser.py'))})['parse']\nqueries=${JSON.stringify(['Count the number of lines in all ".php" files in the /testbed directory tree','递归统计 /testbed 下 PHP 文件总行数','Please count all lines of *.php files in /testbed/Dir recursively excluding Archive','Count lines in php files in /testbed ignoring errors','Count lines in php files in /etc recursively','Do not count lines in php files','Count lines in php files in /testbed directly recursively','List files in /testbed and delete backups'])}\nprint(json.dumps([p(q,{'root':'/testbed'}) for q in queries]))`
 const r=await processOutput('python3',['-c',code]);assert.equal(r.exitCode,0,r.stderr);const rows=JSON.parse(r.stdout);assert.deepEqual(rows.slice(0,3).map(r=>r.status),['parsed','parsed','parsed']);assert.equal(rows[2].task.args.root,'/testbed/Dir');assert.deepEqual(rows[2].task.args.exclude_dirs,['Archive']);assert(rows.slice(3).every(r=>r.status!=='parsed'));const pkg=await readCapability(seed);for(const row of rows.slice(0,3))assert(parsed(row,pkg,row.evidence.original));assert.throws(()=>parsed({...rows[0],evidence:{...rows[0].evidence,unexplained:['except']}},pkg,rows[0].evidence.original));assert.equal(formatResult({status:'completed',value:2},pkg.manifest.operations['text.count_newlines']),'2\n')
})
test('v2 independent fixtures, agent writes/runs/fails/repairs, atomic publication and frozen isolation',{skip:process.env.ROUTER_V2_DOCKER_TEST!=='1'},async t=>{
 const shared=process.env.ROUTER_V2_SHARED;assert(shared?.startsWith('/'));await mkdir(shared,{recursive:true});const root=await mkdtemp(join(shared,'v2-')),scratch=await mkdtemp(join(shared,'v2-snap-'));t.after(()=>rm(root,{recursive:true,force:true}));t.after(()=>rm(scratch,{recursive:true,force:true}));await writeFile(join(root,'a.php'),'a\nb\n');const store=new CapabilityStore(root),config={enabled:true,image,pythonVersion:'3.13.15',dockerContext:process.env.ROUTER_DOCKER_CONTEXT??'colima',snapshotDirectory:scratch,pids:64,triggerTimeoutMs:5000};assert((await installSeed(store,config)).published)
 const router=new CapabilityRouter(root);assert.equal((await router.route('Count total lines in PHP files in /testbed')).text,'2\n');const first=(await store.read()).active.files
 const sid=await startDevelopment(store),dev=new Development(store,sid)
 const session=(await store.read()).sessions[sid];for(const dir of ['scratch','capabilities'])assert.equal((await stat(join(session.root,dir))).mode&0o777,0o777)
 let r=await dev.command("printf 'assert 2 == 3\n' > /work/scratch/test.py; python3 /work/scratch/test.py");assert.notEqual(r.exitCode,0)
 r=await dev.command("printf 'assert 2 == 2\n' > /work/scratch/test.py; python3 /work/scratch/test.py");assert.equal(r.exitCode,0)
 r=await dev.command("set -e; test ! -e /work/evaluator; test ! -e /work/task/.dsh; test -z \"$DEEPSEEK_API_KEY\"; ! echo bad > /work/history/observed.json");assert.equal(r.exitCode,0)
 await dev.command("printf '\n# development revision\n' >> /work/capabilities/files/parser.py")
 await dev.command("mkdir -p /work/capabilities/files/__pycache__; printf 'cache' > /work/capabilities/files/__pycache__/parser.pyc");
 const published=await dev.publish('files');assert(published.published);assert.notEqual(published.activeRevision,first)
 // The fixture is owned by the container UID on Linux, so clean it in that container.
 assert.equal((await dev.command('rm -rf /work/capabilities/files/__pycache__')).exitCode,0)
 await dev.command("printf 'def execute(task, context):\\n return {\"status\":\"completed\",\"value\":999}\\n' > /work/capabilities/files/executor.py")
 assert.equal((await dev.publish('files')).published,false);assert.equal((await store.read()).active.files,published.activeRevision)
 await dev.command("ln -s /etc/passwd /work/capabilities/files/stolen.txt");await assert.rejects(dev.publish('files'),/snapshot/);await dev.command("rm /work/capabilities/files/stolen.txt");
 await dev.rollback('files',first);assert.equal((await store.read()).active.files,first);await dev.finish();const digest=await store.freeze();assert.equal((await router.route('递归统计 /testbed 下 PHP 文件总行数')).text,'2\n');await checkFrozen(store,digest);await assert.rejects(startDevelopment(store),/Frozen/)
})
