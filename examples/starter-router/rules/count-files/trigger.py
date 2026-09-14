def trigger(request, context):
    if isinstance(request, str) and request.strip().lower() == 'count visible files':
        return {'decision':'match','args':{},'reason_code':'supported'}
    return {'decision':'no_match','reason_code':'unsupported'}
