import test from 'node:test'
import assert from 'node:assert/strict'
import {curriculumData,publicCurriculum} from '../benchmarks/intercode/curriculum-data.js'
test('expanded stream keeps evaluator answers separate and varies files, parameters and operations',()=>{
 const data=curriculumData({'a.php':'hello world\n','b.txt':'one two\n','c.txt':'three\n'})
 assert.equal(data.train.length,24);assert.equal(data.test.length,12);assert.equal(new Set(data.train.map(x=>x.family)).size,6);assert.equal(new Set([...data.train,...data.test].map(x=>x.id)).size,36)
 const first=data.train.slice(0,6);assert.deepEqual(first.map(x=>x.expected),['4','3','40','7','2','2'])
 for(const mode of ['batch','autonomous']){const p=publicCurriculum(data,mode);assert.equal(p.tasks.length,24);assert(p.tasks.every(x=>!('expected'in x)&&!('family'in x)));assert(!p.tasks.some(x=>data.test.some(y=>x.id===y.id)))}
 assert.notDeepEqual(data.train[0].files,data.test[0].files)
})
