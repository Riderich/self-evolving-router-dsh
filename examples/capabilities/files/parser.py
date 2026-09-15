"""Deterministic lexical interpretation; unconsumed words cause abstention."""
import re

def parse(request, context):
    if not isinstance(request, str):
        return {'status':'unsupported','reasons':['invalid_request']}
    original=request
    # Replace only recognized language spans; paths retain their original case.
    text=request
    aliases={'递归':' recursively ','统计':' count ','计算':' count ','总行数':' total lines ','行数':' lines ','文件':' files ','目录':' directory ','列出':' list ','显示':' show ','排除':' excluding ','所有':' all ','下面':' in ','下的':' in ','下':' in ','一共有多少':' count ','多少':' count ','请':' please ','的':' ','中':' in ','？':'?','，':','}
    for a,b in aliases.items(): text=text.replace(a,b)
    paths=re.findall(r'/[A-Za-z0-9_./-]+',text)
    roots=[p.rstrip('.') for p in paths]
    if len(set(roots))>1 or any(not(p=='/testbed' or p.startswith('/testbed/')) or '..' in p.split('/') for p in roots):
        return {'status':'ambiguous','reasons':['scope']}
    root=roots[0] if roots else context['root']
    for p in paths:text=text.replace(p,' ')
    excludes=[]
    def exclusion(m):
        excludes.append(m.group(1));return ' '
    text=re.sub(r'\b(?:excluding|exclude|except)\s+[\'\"]?([A-Za-z0-9_-]+)[\'\"]?(?:\s+directories|\s+directory|\s+folders|\s+folder)?',exclusion,text,flags=re.I)
    negative=bool(re.search(r'\b(?:non-recursive|nonrecursive|top-level|directly)\b',text,re.I))
    recursive=bool(re.search(r'\b(?:recursively|recursive|subfolders|subdirectories|tree)\b',text,re.I))
    if negative and recursive:return {'status':'ambiguous','reasons':['recursion_conflict']}
    extension=None
    glob=re.search(r"(?:['\"])?(?:\*)?\.([A-Za-z0-9]{1,12})(?:['\"])?",text)
    if glob:extension=glob.group(1);text=text[:glob.start()]+' '+text[glob.end():]
    else:
        ext=re.search(r'\b(c|php|java|py|txt|js|json|md|csv)\b',text,re.I)
        if ext:extension=ext.group(0).lower();text=text[:ext.start()]+' '+text[ext.end():]
    lower=text.lower()
    lines=bool(re.search(r'\b(?:lines|line|newlines)\b',lower))
    listing=bool(re.search(r'\b(?:list|show|display)\b',lower))
    counting=bool(re.search(r'\b(?:count|counts|number|many|total)\b',lower))
    if lines and counting and not listing:operation='text.count_newlines'
    elif listing and not lines and not counting:operation='files.list'
    else:return {'status':'unsupported','reasons':['operation']}
    if not re.search(r'\bfiles?\b',lower):return {'status':'unsupported','reasons':['object']}
    # Every remaining lexical item must have a declared role or be harmless grammar.
    words=re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)?|[^\sA-Za-z0-9.,?!:'\"*()_-]",text)
    known=set('count counts number total sum lines line newlines list show display files file all the of in directory directories folder folders recursively recursive subfolders subdirectories tree please under within and how many are there is visible regular non-recursive nonrecursive top-level directly prints print'.split())
    unknown=[w for w in words if w.lower() not in known]
    # Unparsed digits are never silently discarded.
    if unknown or re.search(r'\d',text):return {'status':'unsupported','reasons':['unexplained'],'unexplained':unknown}
    defaults=[]
    if not roots:defaults.append('root=/testbed')
    if not recursive and not negative:defaults.append('recursive=false')
    return {'status':'parsed','task':{'operation':operation,'args':{'root':root,'recursive':recursive,'extension':extension or '', 'exclude_dirs':excludes}},'evidence':{'original':original,'spans':[{'field':'operation,args','start':0,'end':len(original.encode('utf-16-le'))//2,'text':original}],'defaults':defaults,'unexplained':[]}}
