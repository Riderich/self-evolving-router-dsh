# Third-party notices

This is an independent companion plugin, not an official DeepSeek product.

DeepSeek Harness is installed as an npm dependency, not vendored. Its top-level
package is pinned to `@deepseek-ai/dsh@0.1.0-rc.6`; the dependency lock also pins
the resolved DSH component versions (including rc.8 components). DeepSeek Harness
is MIT licensed, copyright (c) 2026 DeepSeek. Its license remains in the installed
package. See https://github.com/deepseek-ai/DeepSeek-Harness.

The Docker recipe references the Docker Official Python image by digest. The
image is downloaded separately and is not included in the source archive.
Python, Debian and their bundled components retain their own licenses.

The optional InterCode adapter includes integration code only, not the InterCode
dataset or container images. Users obtain these separately under their original
terms. Research claims require the dataset version and evaluation protocol to be
recorded independently.
