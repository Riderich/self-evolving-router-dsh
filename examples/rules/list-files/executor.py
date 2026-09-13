import os

def execute(request, args, context):
    if request.strip().lower() != "list visible files" or args:
        return {"status": "fallback", "reason_code": "request_mismatch"}
    entries = sorted(os.listdir(context["root"]))
    return {"status": "completed", "result": {"text": "".join(name + "\n" for name in entries)}}
