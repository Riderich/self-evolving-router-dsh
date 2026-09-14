Count regular files directly in the public workspace root.

This is an executable example and an active starter rule, not proof of generic correctness.
Scope is the public snapshot only; hidden entries and links are outside that view.
Use full-string matching. Extra path, exclusion, filtering or action clauses must fall back.
trigger receives a string. Return no_match for unrelated requests so other rules may run.
Any directory/read error returns fallback; never return a partial answer.
For an incremental change, retain this implementation unless that part needs to change.
