#!/usr/bin/env node
// Attach to the prepared, pinned project runtime. No dependency downloads.
import { access, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { dshRuntime } from './lib/dsh-runtime.js'
const plugin = fileURLToPath(new URL('./', import.meta.url))
try {
  const { anchor, home, require } = await dshRuntime()
  const pkg = JSON.parse(await readFile(anchor, 'utf8'))
  if (pkg.version !== '0.1.0-rc.6') throw Error('Prepared pinned DSH rc.6 required; installer does not download dependencies')
  const profile = join(home, 'profiles/router'), modules = join(profile, 'node_modules')
  await mkdir(modules, { recursive: true })
  for (const dependency of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']) await access(require.resolve(dependency + '/package.json'))
  const link = join(modules, 'dsh-prellm-router')
  try { await symlink(relative(modules, plugin), link) }
  catch (e) { if (e.code !== 'EEXIST') throw e; if (await realpath(link) !== await realpath(plugin)) throw Error('Existing plugin link targets another directory') }
  const file = join(profile, 'package.json')
  let p
  try { p = JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e; p = { name: 'dsh-profile-router', private: true } }
  p.dsh ??= {}; p.dsh.profile ??= {}; p.dsh.profile.bundles = [...new Set([...(p.dsh.profile.bundles ?? []), '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-prellm-router'])]
  await writeFile(file, JSON.stringify(p, null, 2) + '\n')
  try { await writeFile(join(profile, 'cordis.yml'), '[]\n', { flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  console.log(JSON.stringify({ installed: true, profile, modelCalls: 0 }))
} catch (e) { console.error(e.message); process.exitCode = 1 }
