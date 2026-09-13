def trigger(request, context):
    if request.strip().lower() == "list visible files":
        return {"decision": "match", "args": {}, "reason_code": "visible_entries"}
    return {"decision": "no_match", "reason_code": "unsupported_request"}
