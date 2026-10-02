import { createPinia, setActivePinia } from 'pinia'
import { useTestStore } from '../src/store'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log('  PASS', name) }
  else { fail += 1; console.log('  FAIL', name, extra) }
}

setActivePinia(createPinia())
const store = useTestStore()

/* ---------- 规则一：断网挂起 → 交班/过期前不能续跑 ---------- */
console.log('\n[规则一] 挂起与凭证交接')
store.selectCase('TC-102')
check('种子 TS-4 初始挂起', store.selectedCase!.steps[1]!.state === '挂起')
store.switchOperator('方瑜')
store.reportStepResult({ caseId: 'TC-102', stepId: 'TS-4', result: '通过' })
check('步骤挂起期间凭证持有人也不能上报', store.selectedCase!.steps[1]!.state === '挂起', store.liveMessage)

store.switchOperator('李峥')
store.takeOver('EX-260929-02')
check('未交班且凭证未过期，李峥接手被拒', store.selectedCase!.steps[1]!.state === '挂起', store.liveMessage)

store.switchOperator('方瑜')
store.handOver('EX-260929-02', '李峥')
store.switchOperator('李峥')
store.takeOver('EX-260929-02')
check('交班后李峥接手，TS-4 续跑中', store.selectedCase!.steps[1]!.state === '续跑中', store.liveMessage)
store.reportStepResult({ caseId: 'TC-102', stepId: 'TS-4', result: '通过', evidence: 'VID-077', actual: '信号即时关闭' })
check('TS-4 由接手人在同一执行号续跑通过', store.selectedCase!.steps[1]!.state === '通过')
check('执行号保持 EX-260929-02（不新开号）', store.selectedCase!.steps[1]!.executionId === 'EX-260929-02')
check('执行记录交接链 方瑜 → 李峥', store.executions.find((e) => e.id === 'EX-260929-02')!.operators.join('→') === '方瑜→李峥')
check('证据清单并入 VID-077', store.executions.find((e) => e.id === 'EX-260929-02')!.evidence.includes('VID-077'))

store.selectCase('TC-104')
store.startExecution()
const newExec = store.selectedActiveExecution!.id
store.simulateDisconnect()
check('断网后 TS-6 挂起', store.selectedCase!.steps[0]!.state === '挂起')
store.retry()
check('回网同步不解除挂起', store.selectedCase!.steps[0]!.state === '挂起', store.liveMessage)
store.expireCredential(newExec)
store.takeOver(newExec)
check('凭证过期后李峥可不经交班直接续跑', store.selectedCase!.steps[0]!.state === '续跑中', store.liveMessage)

/* ---------- 规则二：请求号幂等 + 晚到旧结果留复核 ---------- */
console.log('\n[规则二] 幂等与晚到旧结果')
// TS-4 用新执行号重测，旧号 EX-260929-02 仍在台账
store.selectCase('TC-102')
store.switchOperator('李峥')
store.rerunStep('TC-102', 'TS-4')
const tc102New = store.selectedCase!.steps[1]!.executionId!
check('重测为 TS-4 开新执行号', tc102New !== 'EX-260929-02')
check('旧执行号台账仍保留', store.ledger.some((l) => l.executionId === 'EX-260929-02' && l.stepId === 'TS-4'))

store.reportStepResult({ caseId: 'TC-102', stepId: 'TS-4', result: '失败', requestId: 'REQ-R2-DUP', actual: '新执行失败', evidence: 'E-1' })
check('新执行号 TS-4 = 失败', store.selectedCase!.steps[1]!.state === '失败')
store.reportStepResult({ caseId: 'TC-102', stepId: 'TS-4', result: '通过', requestId: 'REQ-R2-DUP', evidence: 'E-1' })
check('同请求号第二次重复拒收，失败不被通过覆盖', store.selectedCase!.steps[1]!.state === '失败', store.liveMessage)
check('流水：已接收 + 重复拒收', (() => { const set = new Set(store.reports.filter((r) => r.requestId === 'REQ-R2-DUP').map((r) => r.outcome)); return set.size === 2 && set.has('已接收') && set.has('重复拒收') })())
check('台账 seenRequestIds 只记一次 REQ-R2-DUP', store.ledger.find((l) => l.executionId === tc102New && l.stepId === 'TS-4')!.seenRequestIds.filter((r) => r === 'REQ-R2-DUP').length === 1)

store.injectStaleReport(store.selectedCase!.steps[1]!, '通过')
check('旧执行号晚到结果不覆盖新进度（仍失败）', store.selectedCase!.steps[1]!.state === '失败', store.liveMessage)
const staleReview = store.openReviews.find((r) => r.reason === '晚到旧结果')
check('晚到旧结果生成待复核项并指向旧执行号', !!staleReview && staleReview!.executionId === 'EX-260929-02')

/* ---------- 规则三：依赖改动 → 后续失效，证据完整保留 ---------- */
console.log('\n[规则三] 依赖改动失效与留证')
store.selectCase('TC-101')
store.changeDependency('TC-101', 'TS-1', 'TS-1')
check('自依赖拒绝', store.selectedCase!.steps[0]!.depVersion === 1, store.liveMessage)
store.changeDependency('TC-101', 'TS-2', 'TS-1')
check('依赖未变化不触发失效', store.selectedCase!.steps[1]!.state === '通过', store.liveMessage)
// 去掉 TS-1 的前置依赖语义即改动 TS-1：直接改 TS-2 的依赖为无依赖，会失效 TS-2 与 TS-7（传递下游）
store.changeDependency('TC-101', 'TS-2', undefined)
check('改动步骤 TS-2 立即失效', store.selectedCase!.steps[1]!.state === '失效')
check('传递下游 TS-7 立即失效', store.selectedCase!.steps[2]!.state === '失效')
check('TS-1 不在影响面，仍通过', store.selectedCase!.steps[0]!.state === '通过')
check('TS-2 完整证据保留', store.selectedCase!.steps[1]!.retainedEvidence === 'LG-108')
check('TS-7 完整证据保留', store.selectedCase!.steps[2]!.retainedEvidence === 'XS-040')
check('保留原执行号 EX-260929-03', store.selectedCase!.steps[2]!.retainedExecutionId === 'EX-260929-03')
check('生成失效留证复核项', store.openReviews.some((r) => r.reason === '失效留证' && r.stepId === 'TS-7'))

/* ---------- 规则五：发布门禁 ---------- */
console.log('\n[规则五] 发布门禁')
check('初始存在阻断项', store.releaseReady === false && store.gateBlockCount > 0, `阻断 ${store.gateBlockCount}`)
store.lockBaseline()
check('有阻断时锁定被拒', store.baselineLocked === false, store.liveMessage)
const ts4Row = store.releaseRows.find((r) => r.step.id === 'TS-4')!
check('门禁表展示 TS-4 当前执行号', ts4Row.executionId === tc102New)
check('门禁表展示交接人链 方瑜 → 李峥', ts4Row.handoffChain === '方瑜 → 李峥')
check('门禁表列出未决复核阻断', ts4Row.problems.some((p) => p.includes('未决复核')))
const ts2Row = store.releaseRows.find((r) => r.step.id === 'TS-2')!
check('TS-2 提示依赖改动需重跑', ts2Row.problems.some((p) => p.includes('失效')))

// 证据不一致
const ts1 = store.selectedCase!.steps[0]!
ts1.evidence = 'FAKE-999'
const ts1Row = store.releaseRows.find((r) => r.step.id === 'TS-1')!
check('证据不一致被检出（步骤证据执行记录里没有）', ts1Row.problems.some((p) => p.includes('证据不一致')))
// 缺记录
const ts6 = store.cases.find((c) => c.id === 'TC-104')!.steps[0]!
ts6.executionId = 'EX-GHOST'; ts6.state = '通过'; ts6.result = '通过'; ts6.evidence = 'VID-088'
const ts6Row = store.releaseRows.find((r) => r.step.id === 'TS-6')!
check('缺执行记录被检出', ts6Row.problems.includes('缺执行记录'))

/* ---------- 闭环全部阻断后才能锁定 ---------- */
console.log('\n[规则五-闭环] 关闭全部阻断项')
// 复原证据与记录
ts1.evidence = 'XS-026'
ts6.executionId = newExec
const exec04 = store.executions.find((e) => e.id === newExec)!
if (!exec04.evidence.includes('VID-088')) exec04.evidence.push('VID-088')
// TS-6 已通过（前面 report 过？前面没报，补一条）
if (ts6.state !== '通过') {
  // 该执行号凭证当前是“续跑中”且持李峥，直接改状态模拟已完成上报
  store.reportStepResult({ caseId: 'TC-104', stepId: 'TS-6', result: '通过', evidence: 'VID-088' })
}
// TS-2 / TS-7 重跑通过
store.rerunStep('TC-101', 'TS-2')
store.reportStepResult({ caseId: 'TC-101', stepId: 'TS-2', result: '通过', evidence: 'LG-108' })
store.rerunStep('TC-101', 'TS-7')
store.reportStepResult({ caseId: 'TC-101', stepId: 'TS-7', result: '通过', evidence: 'XS-040' })
// TS-4 重跑通过（新执行号）
store.selectCase('TC-102')
store.rerunStep('TC-102', 'TS-4')
store.reportStepResult({ caseId: 'TC-102', stepId: 'TS-4', result: '通过', evidence: 'VID-077' })
// TC-103 的 TS-5 原本失败，必须重测通过（门禁逐步骤核对）
store.rerunStep('TC-103', 'TS-5')
store.reportStepResult({ caseId: 'TC-103', stepId: 'TS-5', result: '通过', evidence: 'VID-014、LG-119' })
// 关闭所有复核项（含失效留证）
for (const review of [...store.openReviews]) store.dismissReview(review.id)
check('复核项全部闭环', store.openReviews.length === 0)
check('全部闭环后门禁通过', store.releaseReady, `仍阻断 ${store.gateBlockCount}: ` + store.releaseRows.filter((r) => r.problems.length).map((r) => `${r.caseId}-${r.step.id}[${r.problems.join(',')}]`).join(' '))
store.lockBaseline()
check('基线成功锁定', store.baselineLocked === true)
// 锁定后只读
store.selectCase('TC-101')
store.reportStepResult({ caseId: 'TC-101', stepId: 'TS-2', result: '失败', requestId: 'REQ-AFTER-LOCK' })
check('锁定后上报被拒（只读）', store.selectedCase!.steps.find((s) => s.id === 'TS-2')!.state === '通过', store.liveMessage)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
