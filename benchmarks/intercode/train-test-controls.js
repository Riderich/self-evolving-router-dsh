// B2: handwritten executors + observed training wording, never test wording.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { starterDirectory } from '../../lib/starter-router.js'
export async function templatePackage(family,rows,sourceIds,parent=null) {
  assert(rows.length && rows.every(t=>t.family===family),'One observed family required')
  assert(['recursive-lines','file-count'].includes(family),'Template control not audited for this training family')
  const seed=family==='file-count'?'count-files':family,dir=join(starterDirectory,'rules',seed)
  const files=Object.fromEntries(await Promise.all(['manifest.json','README.md','trigger.py','executor.py'].map(async n=>[n,await readFile(join(dir,n),'utf8')])))
  const manifest=JSON.parse(files['manifest.json']);manifest.rule_id=family;manifest.parent_revision=parent;manifest.source_ids=sourceIds
  manifest.description='Handwritten executor with wording collected only from the training prefix'
  files['manifest.json']=JSON.stringify(manifest,null,2)
  files['README.md']='Manual B2 control; observed training wording, frozen at test time.\n'
  if(family==='recursive-lines') {
    const forms=[...new Set(rows.map(t=>{
      const q=t.query.trim().toLowerCase(),re=new RegExp('\\b'+t.extension+'\\b','g')
      assert((q.match(re)??[]).length===1,'Extension slot must be unique and explicit')
      return q.replace(re,'{extension}')
    }))]
    files['trigger.py']+=`\n_seed_trigger = trigger\nimport re\n_FORMS = ${JSON.stringify(forms)}\ndef trigger(request, context):\n    result = _seed_trigger(request, context)\n    if result['decision'] != 'no_match': return result\n    if not isinstance(request, str): return result\n    for form in _FORMS:\n        pattern = re.escape(form).replace(re.escape('{extension}'), r'(?P<extension>[a-z0-9]{1,12})')\n        match = re.fullmatch(pattern, request.strip().lower())\n        if match: return {'decision':'match','args':{'extension':match.group('extension')},'reason_code':'observed_template'}\n    return result\n`
  } else {
    files['trigger.py']=`_REQUESTS = ${JSON.stringify([...new Set(rows.map(t=>t.query.trim().toLowerCase()))])}\ndef trigger(request, context):\n    if isinstance(request,str) and request.strip().lower() in _REQUESTS:\n        return {'decision':'match','args':{},'reason_code':'observed_template'}\n    return {'decision':'no_match','reason_code':'unmatched'}\n`
    files['executor.py']="import os\ndef _raise(error): raise error\ndef execute(request,args,context):\n    try:\n        total=sum(len(names) for _,_,names in os.walk(context['root'],onerror=_raise,followlinks=False))\n        return {'status':'completed','result':{'text':str(total)+'\\n'}}\n    except OSError:\n        return {'status':'fallback','reason_code':'read_error'}\n"
  }
  return files
}
