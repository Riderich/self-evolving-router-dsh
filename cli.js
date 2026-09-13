#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { RuleStore } from './lib/rule-store.js'
import { RuleRegistry } from './lib/rule-registry.js'
import { ObjectRouter } from './lib/rule-router.js'
import { readPackage } from './lib/rule-package.js'
import { preflight } from './lib/rule-preflight.js'
import { configureMaintenance, observeVerified, maintenanceState } from './lib/maintenance-state.js'
import { MaintenanceController } from './lib/maintenance-controller.js'
import { dshMaintenanceRunner } from './lib/maintenance-runner.js'
const args = process.argv.slice(2)
const usage = `dsh-router [--root DIR] COMMAND
  status | preflight [--no-docker]
  configure CONFIG.json                 固定工程配置（不调用模型）
  check-package DIR                     只校验包，不运行代码
  source ID EVIDENCE.json                操作者登记可信来源
  submit DIR                            提交不可变版本
  validate REVISION                      独立验证拟发布集合
  activate VALIDATION_ID GENERATION      原子发布
  route REQUEST                         确定性运行或返回 fallback
  disable RULE_ID GENERATION [--revoke]   停用；可永久撤销版本
  rollback RULE_ID REVISION GENERATION   当前环境重新验证后回滚
  maintenance-config CONFIG.json        开启自进化并设置全局模型预算
  observe EVIDENCE.json                  导入可信任务验证结果
  evolve [CHAIN_ID]                      自动选择历史族并运行模型维护
  recover CHAIN_ID                       恢复中断状态；不重放不确定调用
  maintenance-status                    查看维护链和模型用量
  events                                导出原始对象事件
准入集由可信操作者存放于 ROOT/.dsh/executable-rules/admission.json。
CLI 的 source/configure/准入集写入不是模型维护权限。`
try {
  let root = process.cwd(), idx = args.indexOf('--root')
  if (idx >= 0) { if (!args[idx + 1]) throw Error('Missing --root'); root = resolve(args[idx + 1]); args.splice(idx, 2) }
  const [command, ...rest] = args
  if (!command || ['--help', 'help', '-h'].includes(command)) { console.log(usage) }
  else {
    const store = new RuleStore(await realpath(root)), registry = new RuleRegistry(store)
    const json = async p => JSON.parse(await readFile(resolve(p), 'utf8'))
    let result
    switch (command) {
      case 'maintenance-config': result = await configureMaintenance(store, await json(rest[0])); break
      case 'observe': result = await observeVerified(store, await json(rest[0])); break
      case 'maintenance-status': result = maintenanceState(await store.read()); break
      case 'recover': result = await new MaintenanceController(store).recover(rest[0]); break
      case 'evolve': {
        const controller = new MaintenanceController(store, dshMaintenanceRunner(store));
        const chainId = rest[0] ?? (await controller.next())?.id;
        result = chainId ? await controller.run(chainId) : { status: 'idle', reason: 'No eligible verified history or maintenance disabled' };
        if (chainId && result.status !== 'complete') process.exitCode = 2;
        break
      }
      case 'configure': result = await store.configure(await json(rest[0])); break
      case 'preflight': result = await preflight((await store.read()).config, { docker: !rest.includes('--no-docker') }); if (!result.ready) process.exitCode = 1; break
      case 'check-package': { const p = await readPackage(resolve(rest[0])); result = { revision: p.revision, manifest: p.manifest }; break }
      case 'source': result = await registry.addSource(rest[0], await json(rest[1])); break
      case 'submit': result = await registry.submit(resolve(rest[0])); break
      case 'validate': result = await registry.validate(rest[0]); if (!result.passed) process.exitCode = 2; break
      case 'activate': result = await registry.activate(rest[0], Number(rest[1])); break
      case 'route': result = await new ObjectRouter(store.root).route(rest.join(' ')); break
      case 'disable': result = await registry.disable(rest[0], Number(rest[1]), { revoke: rest.includes('--revoke') }); break
      case 'rollback': result = await registry.rollback(rest[0], rest[1], Number(rest[2])); break
      case 'events': result = (await store.read()).events; break
      case 'status': { const s = await store.read(); result = { backend: s.backend, generation: s.generation, config: s.config, active: s.active, revisions: Object.keys(s.packages), validations: Object.keys(s.proofs) }; break }
      default: throw Error(`Unknown command: ${command}\n${usage}`)
    }
    console.log(JSON.stringify(result, null, 2))
  }
} catch (e) { console.error(e.message); process.exitCode = 1 }
