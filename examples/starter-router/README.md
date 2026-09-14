# Working starter router

Three handwritten executable rules provide useful initial behavior and few-shot examples.
They are installed into the same registry that is later evolved; no separate demonstration router.

Supported requests:
- `list visible files`: sorted top-level regular filenames, one per line.
- `count visible files`: top-level regular file count.
- `count lines in all c files in /testbed recursively`: newline-byte count; extension is a bounded ASCII parameter.

Other wording and unsupported scope modifiers fall back. Matching ignores casing and outer whitespace.
Validation has 8 positive cases and 10 boundary cases on synthetic file fixtures; this is not a general correctness proof.
The final negative phrase is an example of currently unsupported wording, not an authorization to expand scope.
An operator must update trusted admission when authorizing new behavior, then revalidate the collection.
Use `node scripts/setup-starter.mjs ROOT` to validate and install; it makes no model calls.
