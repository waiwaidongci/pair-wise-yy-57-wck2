import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ExecutionRecord, HandoffRecord, ReportRecord, StepGateInfo, TestCase, TestStep } from './types'
import { seedCases, seedExecutions, seedHandoffs, seedReports } from './mock'

const STORAGE_KEY = 'yy57-interlocking-draft-v2'
const CREDENTIAL_TTL_MS = 12 * 3600 * 1000

function nowIso() { return new Date().toISOString() }
function nowTime() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }
function genId(prefix: string) { return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}` }
function isExpired(credential?: TestStep['credential']) { return !!credential && new Date(credential.expiresAt).getTime() <= Date.now() }

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const handoffs = ref<HandoffRecord[]>(structuredClone(seedHandoffs))
  const reports = ref<ReportRecord[]>(structuredClone(seedReports))
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')
  /** 当前操作人（夜班）；接班接手后新执行号挂在该操作人名下 */
  const currentOperator = ref('陆晨')

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })
  const changedDevices = ['P-02 转辙机更换', 'T-03 绝缘节调整']
  const affectedCases = computed(() => cases.value.filter((item) => item.routeIds.some((routeId) => ['R-02', 'R-04'].includes(routeId))))

  /** 某用例当前待接手的交接单（交班或凭证过期路径） */
  function openHandoff(caseId: string) { return handoffs.value.find((item) => item.caseId === caseId && item.state === '待接手') }
  /** 步骤是否已可续跑：无凭证 / 原执行人已交班 / 凭证已过期 */
  function stepResumeable(step: TestStep) { return !step.credential || step.credential.handedOff || isExpired(step.credential) }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cases: cases.value, executions: executions.value, handoffs: handoffs.value, reports: reports.value,
    }))
  }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw)
    cases.value = draft.cases
    executions.value = draft.executions
    handoffs.value = draft.handoffs?.length ? draft.handoffs : structuredClone(seedHandoffs)
    reports.value = draft.reports?.length ? draft.reports : structuredClone(seedReports)
  }
  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = cases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  function refreshCaseStatus(item: TestCase) {
    item.status = item.steps.some((step) => step.result === '失败') ? '失败'
      : item.steps.every((step) => step.result === '通过') ? '通过'
      : '执行中'
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，禁止开始执行'; return }
    item.status = '执行中'
    const id = genId('EX')
    executions.value.unshift({ id, caseId: item.id, operator: currentOperator.value, startedAt: nowTime(), snapshot: 'v26.10 / CS-LEU-09', result: '执行中', evidence: [] })
    for (const step of item.steps) {
      if (step.result === '未执行' && !step.credential) {
        step.credential = { executionId: id, holder: currentOperator.value, issuedAt: nowIso(), expiresAt: new Date(Date.now() + CREDENTIAL_TTL_MS).toISOString(), handedOff: false }
      }
    }
    liveMessage.value = `已开始执行，执行号 ${id}`
    persist()
  }

  /** 交班：未完成步骤先挂起，全部凭证置为已交班，生成同一份交接单 */
  function raiseHandoff(caseId: string, note?: string) {
    const item = cases.value.find((entry) => entry.id === caseId)
    if (!item) return
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，禁止交班'; return }
    const unfinished = item.steps.filter((step) => step.result !== '通过')
    const executionId = executions.value.find((entry) => entry.caseId === caseId && entry.result === '执行中')?.id
      ?? item.steps.find((step) => step.credential)?.credential?.executionId
      ?? genId('EX')
    for (const step of item.steps) {
      if (unfinished.includes(step)) step.suspended = true
      if (step.credential) step.credential.handedOff = true
    }
    handoffs.value.unshift({
      id: genId('HO'), caseId, executionId, fromOperator: currentOperator.value,
      state: '待接手', suspendedStepIds: unfinished.map((step) => step.id),
      createdAt: nowIso(), note,
    })
    liveMessage.value = `已交班：${unfinished.length} 项未完成步骤已挂起，接班人接手后续跑`
    persist()
  }

  /**
   * 接班接手。续跑前提：原执行人已交班，或其持有凭证已过期。
   * 接手后发放新执行号凭证，恢复挂起步骤，核销交接单。
   */
  function takeOver(caseId: string) {
    const item = cases.value.find((entry) => entry.id === caseId)
    if (!item) return
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，禁止接手'; return }
    const open = openHandoff(caseId)
    const targets = item.steps.filter((step) => step.result !== '通过')
    const blocked = targets.some((step) => step.credential && !step.credential.handedOff && !isExpired(step.credential))
    if (blocked) { liveMessage.value = '原执行人未交班且持有凭证未过期，暂不能接手续跑'; return }
    const newExecId = genId('EX')
    executions.value.unshift({ id: newExecId, caseId: item.id, operator: currentOperator.value, startedAt: nowTime(), snapshot: 'v26.10 / CS-LEU-09', result: '执行中', evidence: [] })
    for (const step of targets) {
      step.suspended = false
      step.invalidated = false
      step.credential = { executionId: newExecId, holder: currentOperator.value, issuedAt: nowIso(), expiresAt: new Date(Date.now() + CREDENTIAL_TTL_MS).toISOString(), handedOff: false, handoffId: open?.id }
    }
    if (open) {
      open.state = '已接手'
      open.toOperator = currentOperator.value
      open.resumedAt = nowIso()
    } else {
      handoffs.value.unshift({
        id: genId('HO'), caseId, executionId: newExecId, fromOperator: '凭证过期（系统）',
        toOperator: currentOperator.value, state: '凭证过期', suspendedStepIds: targets.map((step) => step.id),
        createdAt: nowIso(), resumedAt: nowIso(), note: '原执行人持有凭证已过期，接班人接手续跑',
      })
    }
    liveMessage.value = `已接手：${targets.length} 项步骤恢复续跑，新执行号 ${newExecId}`
    persist()
  }

  /** 模拟凭证过期：把指定步骤凭证置为过期（交班/过期两条续跑路径之一） */
  function expireStepCredential(caseId: string, stepId: string) {
    const item = cases.value.find((entry) => entry.id === caseId)
    const step = item?.steps.find((entry) => entry.id === stepId)
    if (!step?.credential) return
    step.credential.expiresAt = new Date(Date.now() - 1000).toISOString()
    liveMessage.value = `凭证已过期：${stepId} 现可由接班人接手续跑`
    persist()
  }

  /** 依赖改动后，下游结果立即失效，证据完整保留归档 */
  function invalidateDependents(caseId: string, changedStepId: string) {
    const item = cases.value.find((entry) => entry.id === caseId)
    if (!item) return
    const downstream = new Set<string>()
    const queue = [changedStepId]
    while (queue.length) {
      const cur = queue.shift()!
      for (const step of item.steps) {
        if (step.dependency === cur && !downstream.has(step.id)) {
          downstream.add(step.id)
          queue.push(step.id)
        }
      }
    }
    for (const id of downstream) {
      const step = item.steps.find((entry) => entry.id === id)!
      if (step.result === '未执行') continue
      step.evidenceHistory = step.evidenceHistory ?? []
      step.evidenceHistory.unshift({
        id: genId('EV'),
        executionId: step.credential?.executionId ?? '无',
        result: step.result,
        actual: step.actual,
        evidence: step.evidence,
        recordedAt: nowIso(),
        reason: `依赖步骤 ${changedStepId} 结果变更，下游结果立即失效，证据保留归档`,
      })
      step.result = '未执行'
      step.actual = undefined
      step.evidence = undefined
      step.invalidated = true
    }
  }

  function staleReason(step: TestStep, reportedExecId?: string) {
    if (step.suspended) return '步骤处于挂起（交接未完成）状态，结果留待复核'
    if (!step.credential) return '该步骤无有效执行凭证，结果留待复核'
    if (step.credential.handedOff) return '原执行人已交班，执行凭证已失效，结果留待复核'
    if (isExpired(step.credential)) return '执行凭证已过期，结果留待复核'
    if (reportedExecId && reportedExecId !== step.credential.executionId) return `上报执行号 ${reportedExecId} 与当前执行号 ${step.credential.executionId} 不符，晚到结果留待复核`
    return '执行凭证与持证人不符，结果留待复核'
  }

  /**
   * 上报结果（唯一写入口）。
   * 1) 请求号幂等：同一 requestId 只收一次，重复拒收；
   * 2) 挂起 / 无凭证 / 已交班 / 凭证过期 / 执行号不符 → 晚到旧结果留待复核，不覆盖进度；
   * 3) 正常采纳后，依赖改动立即作废下游结果（证据保留）。
   */
  function reportResult(payload: { caseId: string; stepId: string; result: '通过' | '失败'; actual?: string; evidence?: string; requestId?: string; executionId?: string }) {
    const item = cases.value.find((entry) => entry.id === payload.caseId)
    const step = item?.steps.find((entry) => entry.id === payload.stepId)
    if (!item || !step) return
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，禁止写入'; return }
    const requestId = payload.requestId || genId('RQ')
    const operator = currentOperator.value

    // 1) 幂等：同一请求号只收一次
    if (reports.value.some((entry) => entry.requestId === requestId)) {
      reports.value.unshift({
        requestId, executionId: payload.executionId ?? step.credential?.executionId ?? '无',
        caseId: payload.caseId, stepId: payload.stepId, result: payload.result,
        actual: payload.actual, evidence: payload.evidence, operator, reportedAt: nowIso(),
        disposition: '重复拒收', reason: `请求号 ${requestId} 已处理，重复上报只收一次`,
      })
      liveMessage.value = `重复请求 ${requestId} 已拒收（按请求号只收一次）`
      persist()
      return
    }

    const currentExecId = step.credential?.executionId
    const credValid = !!step.credential && !step.credential.handedOff && !isExpired(step.credential) && step.credential.holder === operator
    const stale = step.suspended || !credValid || (payload.executionId != null && payload.executionId !== currentExecId)
    if (stale) {
      reports.value.unshift({
        requestId, executionId: payload.executionId ?? currentExecId ?? '无',
        caseId: payload.caseId, stepId: payload.stepId, result: payload.result,
        actual: payload.actual, evidence: payload.evidence, operator, reportedAt: nowIso(),
        disposition: '旧结果待复核', reason: staleReason(step, payload.executionId),
      })
      liveMessage.value = `晚到的旧执行号结果已留作复核，未覆盖当前进度（${step.id}）`
      persist()
      return
    }

    // 3) 依赖顺序：前置步骤未通过，禁止跳过
    if (step.dependency) {
      const dependency = item.steps.find((entry) => entry.id === step.dependency)
      if (dependency && dependency.result !== '通过') {
        liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过（${step.id}）`
        persist()
        return
      }
    }

    // 4) 采纳写入
    step.result = payload.result
    if (payload.actual !== undefined) step.actual = payload.actual
    if (payload.evidence !== undefined) step.evidence = payload.evidence
    step.invalidated = false
    reports.value.unshift({
      requestId, executionId: currentExecId!, caseId: payload.caseId, stepId: payload.stepId,
      result: payload.result, actual: payload.actual, evidence: payload.evidence, operator, reportedAt: nowIso(),
      disposition: '已采纳',
    })
    invalidateDependents(payload.caseId, payload.stepId)
    refreshCaseStatus(item)
    liveMessage.value = `已采纳上报 ${requestId}（执行号 ${currentExecId}）`
    persist()
  }

  function setStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string) {
    if (result === '未执行') return
    reportResult({ caseId, stepId, result, actual })
  }

  /** 复核采纳：晚到证据归档保留，但不覆盖当前步骤进度 */
  function adoptReview(requestId: string) {
    const record = reports.value.find((entry) => entry.requestId === requestId && entry.disposition === '旧结果待复核')
    if (!record) return
    const item = cases.value.find((entry) => entry.id === record.caseId)
    const step = item?.steps.find((entry) => entry.id === record.stepId)
    if (step) {
      step.evidenceHistory = step.evidenceHistory ?? []
      step.evidenceHistory.unshift({
        id: genId('EV'), executionId: record.executionId, result: record.result,
        actual: record.actual, evidence: record.evidence, recordedAt: nowIso(),
        reason: '晚到旧结果经复核后归档保留，不覆盖当前进度',
      })
    }
    record.disposition = '已归档'
    liveMessage.value = `复核完成：${requestId} 已归档为证据，当前进度未改动`
    persist()
  }

  function dismissReview(requestId: string) {
    const record = reports.value.find((entry) => entry.requestId === requestId && entry.disposition === '旧结果待复核')
    if (!record) return
    record.disposition = '已驳回'
    liveMessage.value = `复核完成：${requestId} 已驳回`
    persist()
  }

  /** 发布门禁：逐步给出执行号、交接人、未决复核项与阻塞原因 */
  const releaseSteps = computed<StepGateInfo[]>(() => {
    const list: StepGateInfo[] = []
    for (const item of cases.value) {
      for (const step of item.steps) {
        const issues: string[] = []
        const cred = step.credential
        const executionId = cred?.executionId ?? '无'
        const holder = cred?.holder ?? '无'
        const handoff = handoffs.value.find((entry) => entry.caseId === item.id && (entry.stepId === step.id || !entry.stepId) && entry.state === '待接手')
        const handoffLabel = handoff ? `${handoff.fromOperator} → ${handoff.toOperator ?? '待接班'}（${handoff.state}）` : '—'
        const pendingReviews = reports.value.filter((entry) => entry.caseId === item.id && entry.stepId === step.id && entry.disposition === '旧结果待复核').length
        if (step.suspended) issues.push('步骤挂起中，交接未完成')
        if (step.invalidated) issues.push('依赖改动后结果已失效，需重测')
        if (step.result === '失败') issues.push('失败未闭环')
        if (step.result === '未执行' && !step.suspended && !step.invalidated) issues.push('步骤未执行')
        if (step.result === '通过' && !step.evidence) issues.push('通过但证据缺失')
        if (step.result !== '未执行' && !cred) issues.push('缺执行凭证 / 执行号')
        if (cred && !cred.handedOff && isExpired(cred)) issues.push('凭证已过期未交接')
        if (pendingReviews > 0) issues.push(`未决复核 ${pendingReviews} 项`)
        if (step.result !== '未执行' && step.evidence && !reports.value.some((entry) => entry.caseId === item.id && entry.stepId === step.id && entry.disposition === '已采纳')) {
          issues.push('证据与上报记录不一致')
        }
        list.push({ caseId: item.id, stepId: step.id, executionId, holder, handoffLabel, pendingReviews, issues, blocked: issues.length > 0 })
      }
    }
    return list
  })

  const releaseBlocked = computed(() => releaseSteps.value.some((step) => step.blocked))
  const pendingReviewCount = computed(() => reports.value.filter((entry) => entry.disposition === '旧结果待复核').length)

  function lockBaseline() {
    if (releaseBlocked.value) {
      const blockedCount = releaseSteps.value.filter((step) => step.blocked).length
      liveMessage.value = `发布门禁未通过：${blockedCount} 步存在未决项（挂起 / 缺记录 / 证据不一致 / 未决复核），不予放行`
      return false
    }
    baselineLocked.value = true
    liveMessage.value = '发布基线已锁定，报告与证据归档'
    persist()
    return true
  }

  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`
  }
  function simulateDisconnect() { connection.value = '重连中'; pendingRetry.value += 1 }
  function retry() { connection.value = '在线'; pendingRetry.value = 0; liveMessage.value = '断线期间执行记录已补传，晚到结果进入复核队列' }

  watch(cases, persist, { deep: true })
  restore()

  return {
    cases, executions, handoffs, reports, selectedCaseId, selectedRouteIds, selectedCase, progress,
    baselineLocked, connection, pendingRetry, liveMessage, currentOperator, changedDevices, affectedCases,
    openHandoff, stepResumeable, releaseSteps, releaseBlocked, pendingReviewCount,
    selectCase, startExecution, raiseHandoff, takeOver, expireStepCredential, reportResult, setStepResult,
    adoptReview, dismissReview, lockBaseline, updateLiveProgress, simulateDisconnect, retry,
  }
})
