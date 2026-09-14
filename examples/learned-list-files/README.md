# list-files

Deterministic read-only rule for the verified request family `list-files`.

## Supported scope
The trigger matches plain requests asking to list/show/display/get/print the
visible files (e.g. "list visible files"). Anything else is abstained.

## Behavior
The executor lists the entries in the execution root (`context["root"]`) in
sorted order, one file name per line, matching the verified outputs (a
newline-terminated listing of the visible files). No files are modified.
