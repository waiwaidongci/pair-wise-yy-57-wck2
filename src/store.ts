import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CredentialStatus, ExecutionRecord, HandoffEntry, ReportChannel, ReportLog,
  ReviewItem, StepResult, StepState, TestCase, TestStep,
} from './types'
import { dayOperator, nightOperator, seedCases, seedExecutions } from './mock'

const STORAGE_KEY = 'yy57-interlocking-handoff-v2'

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}
function minutesFromNow(min: number) {
  return new Date(Date.now() + min * 60_000).toLocaleTimeString('zh-CN', { hour12: false })
}
let seq = 0
function nextId(prefix: string) {
  seq += 1
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${seq}`
}

/** 归一化证据串，便于和执行记录里的证据清单做包含比对 */
function normalize(text: string) {
  return text.replace(/[\s,，、;；]/g, '').toUpperCase()
}

export const useTestStore = defineStore('interlocking', () => {
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('交接台账已载入：白班方瑜持有 EX-260929-02，TS-4 断网挂起')
  /** 当前登录班次操作员（演示白班 / 夜班接力） */
  const currentOperator = ref(dayOperator)
  const operatorOptions = [dayOperator, nightOperator]

  /** 唯一交接记录：步骤、执行记录、发布门禁共用这一份 */
  const ledger = ref<HandoffEntry[]>([])
  const reviews = ref<ReviewItem[]>([])
  const reports = ref<ReportLog[]>([])

  /* ---------------- 交接台账初始化（与种子步骤对齐） ---------------- */
  function seedLedger() {
    for (const item of cases.value) {
      for (const step of item.steps) {
        if (!step.executionId) continue
        const activeExec = executions.value.find((entry) => entry.id === step.executionId)
        const cred: CredentialStatus = activeExec?.result === '执行中' ? '有效' : '已交班'
        ledger.value.push({
          executionId: step.executionId,
          caseId: item.id,
          stepId: step.id,
          state: step.state,
          operator: step.operator ?? activeExec?.operators[0] ?? '未知',
          credentialToken: `CRED-${step.executionId}-${step.id}`,
          credentialStatus: cred,
          credentialExpiresAt: cred === '有效' ? minutesFromNow(10) : '—',
          seenRequestIds: [],
          updatedAt: nowTime(),
        })
      }
    }
  }
  seedLedger()

  const selectedCase = computed(() => cases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = cases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })
  const changedDevices = ['P-02 转辙机更换', 'T-03 绝缘节调整']
  const affectedCases = computed(() => cases.value.filter((item) => item.routeIds.some((routeId) => ['R-02', 'R-04'].includes(routeId))))
  const openReviews = computed(() => reviews.value.filter((item) => item.status === '待复核'))

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cases: cases.value, executions: executions.value, ledger: ledger.value,
      reviews: reviews.value, reports: reports.value, currentOperator: currentOperator.value,
    }))
  }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw) as {
      cases: TestCase[]; executions: ExecutionRecord[]; ledger: HandoffEntry[]
      reviews: ReviewItem[]; reports: ReportLog[]; currentOperator?: string
    }
    cases.value = draft.cases
    executions.value = draft.executions
    ledger.value = draft.ledger ?? []
    reviews.value = draft.reviews ?? []
    reports.value = draft.reports ?? []
    if (draft.currentOperator) currentOperator.value = draft.currentOperator
  }
  restore()

  function findCase(caseId: string) {
    return cases.value.find((item) => item.id === caseId)
  }
  function findStep(item: TestCase, stepId: string) {
    return item.steps.find((entry) => entry.id === stepId)
  }
  function ledgerEntry(executionId: string | undefined, stepId: string) {
    return ledger.value.find((entry) => entry.executionId === executionId && entry.stepId === stepId)
  }
  function activeExecution(caseId: string) {
    return executions.value.find((entry) => entry.caseId === caseId && entry.result === '执行中')
  }
  function stepReviews(stepId: string) {
    return reviews.value.filter((item) => item.stepId === stepId && item.status === '待复核')
  }

  function recomputeCase(item: TestCase) {
    if (item.steps.some((step) => step.state === '失败')) item.status = '失败'
    else if (item.steps.every((step) => step.state === '通过')) item.status = '通过'
    else item.status = item.status === '阻塞' ? '阻塞' : '执行中'
  }

  function logReport(entry: Omit<ReportLog, 'at'>) {
    reports.value.unshift({ ...entry, at: nowTime() })
  }

  /* ---------------- 发布门禁：每步执行号 / 交接人 / 证据 / 复核 ---------------- */
  interface GateRow {
    caseId: string; step: TestStep; executionId?: string
    execution?: ExecutionRecord; handoffChain: string
    problems: string[]
  }
  const releaseRows = computed<GateRow[]>(() => {
    const rows: GateRow[] = []
    for (const item of cases.value) {
      for (const step of item.steps) {
        const problems: string[] = []
        const execution = executions.value.find((entry) => entry.id === step.executionId)
        if (!step.executionId || !execution) {
          problems.push('缺执行记录')
        }
        if (!step.evidence || !normalize(step.evidence)) {
          problems.push('缺证据')
        } else if (execution) {
          // 证据一致性：步骤声称的每一项证据都必须在执行记录的证据清单中
          const tokens = step.evidence.split(/[、,，;；]/).map((token) => normalize(token.trim())).filter(Boolean)
          const missing = tokens.filter((token) => !execution.evidence.some((saved) => normalize(saved).includes(token) || token.includes(normalize(saved))))
          if (missing.length) problems.push(`证据不一致（执行记录中找不到：${missing.join('、')}）`)
        }
        if (step.state === '未执行' || step.state === '挂起' || step.state === '续跑中') problems.push('步骤未完成')
        if (step.state === '失败') problems.push('步骤失败未闭环')
        if (step.state === '失效') problems.push('依赖改动后结果已失效，需重跑')
        const pending = stepReviews(step.id)
        for (const review of pending) problems.push(`未决复核：${review.reason}（${review.requestId}）`)
        const entry = ledgerEntry(step.executionId, step.id)
        const chain = execution
          ? execution.operators.join(' → ') + (entry?.successor ? ` → ${entry.successor}` : '')
          : (entry?.operator ?? '—')
        rows.push({ caseId: item.id, step, executionId: step.executionId, execution, handoffChain: chain, problems })
      }
    }
    return rows
  })
  const gateBlockCount = computed(() => releaseRows.value.reduce((sum, row) => sum + row.problems.length, 0))
  const releaseReady = computed(() => gateBlockCount.value === 0)

  /* ================= 规则一：挂起 / 交班 / 凭证过期 / 接手续跑 ================= */

  /** 现场断网：该执行号下未完成步骤一律挂起，回网也不自动续跑 */
  function suspendOnDisconnect(executionId?: string) {
    const id = executionId ?? activeExecution(selectedCaseId.value)?.id
    if (!id) { liveMessage.value = '当前用例没有进行中的执行号'; return }
    let count = 0
    for (const entry of ledger.value) {
      if (entry.executionId !== id) continue
      if (entry.state === '续跑中' || entry.state === '未执行') {
        entry.state = '挂起'
        entry.updatedAt = nowTime()
        const item = findCase(entry.caseId)
        const step = item && findStep(item, entry.stepId)
        if (step) step.state = '挂起'
        count += 1
      }
    }
    pendingRetry.value += 1
    liveMessage.value = `现场断网：执行号 ${id} 的 ${count} 个未完成步骤已挂起，等待交班或凭证过期`
    persist()
  }

  function simulateDisconnect() {
    connection.value = '重连中'
    suspendOnDisconnect()
  }

  /** 回网只同步状态，挂起步骤不得被旧端自动推回执行中 */
  function retry() {
    connection.value = '在线'
    pendingRetry.value = 0
    liveMessage.value = '回网同步完成：挂起步骤保持挂起，须交班完成或凭证过期后由接手人续跑'
    persist()
  }

  /** 原执行人交班：挂起步骤登记接手人，但在接手前仍不可跑 */
  function handOver(executionId: string | undefined, successor = nightOperator) {
    const id = executionId ?? activeExecution(selectedCaseId.value)?.id
    const owned = ledger.value.filter((entry) => entry.executionId === id && entry.operator === currentOperator.value)
    if (!id || !owned.length) { liveMessage.value = '当前操作员不是该执行号持有人，无法交班'; return }
    for (const entry of owned) {
      if (entry.credentialStatus === '有效') {
        entry.credentialStatus = '已交班'
        entry.successor = successor
        entry.handedOverAt = nowTime()
        if (entry.state !== '通过' && entry.state !== '失败') entry.state = '挂起'
        entry.updatedAt = nowTime()
      }
    }
    liveMessage.value = `${currentOperator.value} 已将执行号 ${id} 交班给 ${successor}，挂起步骤待其接手`
    persist()
  }

  /** 演示用：原执行人凭证立即过期 */
  function expireCredential(executionId?: string) {
    const id = executionId ?? activeExecution(selectedCaseId.value)?.id
    let count = 0
    for (const entry of ledger.value) {
      if (entry.executionId === id && entry.credentialStatus === '有效') {
        entry.credentialStatus = '已过期'
        if (entry.state !== '通过' && entry.state !== '失败') entry.state = '挂起'
        entry.updatedAt = nowTime()
        count += 1
      }
    }
    liveMessage.value = count
      ? `执行号 ${id} 的原执行人凭证已过期，接手人可不经过交班直接续跑`
      : '没有可过期的有效凭证'
    persist()
  }

  /** 接手人续跑：凭交班记录（凭证已交班）或原凭证过期才能把挂起步骤置为续跑中 */
  function takeOver(executionId?: string) {
    const id = executionId ?? activeExecution(selectedCaseId.value)?.id
    const entries = ledger.value.filter((entry) => entry.executionId === id)
    if (!id || !entries.length) { liveMessage.value = '找不到该执行号的交接记录'; return }
    const canTake = entries.filter((entry) =>
      entry.state === '挂起' &&
      (entry.credentialStatus === '已过期' ||
        (entry.credentialStatus === '已交班' && entry.successor === currentOperator.value)))
    if (!canTake.length) {
      liveMessage.value = `接手被拒：${currentOperator.value} 既不是登记接手人，原凭证也未过期`
      return
    }
    for (const entry of canTake) {
      entry.credentialStatus = '续跑中'
      entry.operator = currentOperator.value
      entry.state = '续跑中'
      entry.credentialExpiresAt = minutesFromNow(30)
      entry.updatedAt = nowTime()
      const item = findCase(entry.caseId)
      const step = item && findStep(item, entry.stepId)
      if (step) { step.state = '续跑中'; step.operator = currentOperator.value }
    }
    const execution = executions.value.find((entry) => entry.id === id)
    if (execution && !execution.operators.includes(currentOperator.value)) {
      execution.operators.push(currentOperator.value)
      execution.finishedAt = undefined
    }
    liveMessage.value = `${currentOperator.value} 已接手执行号 ${id}，${canTake.length} 个挂起步骤转为续跑中`
    persist()
  }

  function switchOperator(name: string) {
    currentOperator.value = name
    liveMessage.value = `当前操作员切换为 ${name}（交接台账不随操作员切换而改变）`
    persist()
  }

  /* ================= 规则二：同一执行号 + 请求号幂等，晚到旧结果留复核 ================= */

  interface ReportOptions {
    caseId: string
    stepId: string
    result: StepResult
    actual?: string
    evidence?: string
    channel?: ReportChannel
    requestId?: string
    /** 显式指定上报声称的执行号（用于旧端晚到补传演练） */
    executionId?: string
  }

  function reportStepResult(opts: ReportOptions) {
    if (baselineLocked.value) { liveMessage.value = '发布基线已锁定，只读，拒绝上报'; return }
    const item = findCase(opts.caseId)
    const step = item && findStep(item, opts.stepId)
    if (!item || !step) return
    const requestId = opts.requestId ?? nextId('REQ')
    const claimedExec = opts.executionId ?? step.executionId
    const channel: ReportChannel = opts.channel ?? '现场上报'
    const operator = currentOperator.value

    const entry = ledgerEntry(claimedExec, opts.stepId)
    if (!claimedExec || !entry) {
      liveMessage.value = `拒收：执行号 ${claimedExec ?? '（空）'} 在步骤 ${opts.stepId} 上没有交接凭证记录`
      return
    }

    // 幂等：同一执行号同一请求号只收一次（哪怕是被留作复核的旧结果）
    if (entry.seenRequestIds.includes(requestId)) {
      logReport({ requestId, executionId: claimedExec, stepId: opts.stepId, channel, outcome: '重复拒收', result: opts.result, operator, detail: `请求号 ${requestId} 已收过（第 ${entry.seenRequestIds.filter((id) => id === requestId).length + 1} 次），仅保留首次上报` })
      liveMessage.value = `重复拒收：${requestId} 对执行号 ${claimedExec} 已收过一次，本次结果丢弃`
      persist()
      return
    }

    // 晚到的旧执行号结果：不覆盖新进度，整单留作复核
    if (claimedExec !== step.executionId) {
      entry.seenRequestIds.push(requestId)
      const review: ReviewItem = {
        id: nextId('RV'), stepId: opts.stepId, caseId: opts.caseId,
        executionId: claimedExec, requestId, reason: '晚到旧结果', operator,
        payload: opts.result, actual: opts.actual, evidence: opts.evidence,
        receivedAt: nowTime(), status: '待复核',
        note: `旧执行号 ${claimedExec} 的结果晚到，当前步骤已属执行号 ${step.executionId}，不得覆盖`,
      }
      reviews.value.unshift(review)
      logReport({ requestId, executionId: claimedExec, stepId: opts.stepId, channel, outcome: '留作复核', result: opts.result, operator, detail: '旧执行号晚到结果，挂未决复核' })
      liveMessage.value = `晚到旧结果：${claimedExec} 的 ${opts.result} 未覆盖新进度，已生成复核项 ${review.id}`
      persist()
      return
    }

    // 权限：挂起 / 凭证已交班未接手 / 已过期 / 已有结果 / 已失效，都不能写
    if (step.state === '挂起') {
      liveMessage.value = '步骤处于挂起：须原执行人交班或凭证过期，由接手人续跑后才能上报'
      return
    }
    if (step.state === '失效') {
      liveMessage.value = '该步骤结果已因依赖改动失效，请新开执行号重跑'
      return
    }
    if (step.state === '通过' || step.state === '失败') {
      liveMessage.value = '该步骤在本执行号已有结果；重测请新开执行号，旧结果不可覆盖'
      return
    }
    if (entry.credentialStatus === '已交班' && entry.successor !== operator) {
      liveMessage.value = `凭证已交班给 ${entry.successor}，${operator} 无权续跑`
      return
    }
    if (entry.credentialStatus === '已过期') {
      liveMessage.value = '原执行人凭证已过期，请接手人先办理续跑再上报'
      return
    }
    if (entry.operator !== operator) {
      liveMessage.value = `当前凭证持有人是 ${entry.operator}，${operator} 无权上报`
      return
    }
    if (step.dependency) {
      const dep = findStep(item, step.dependency)
      if (!dep || dep.result !== '通过') {
        liveMessage.value = `前置步骤 ${step.dependency} 未通过，禁止跳过上报`
        return
      }
    }

    // 接收：只在这一处落步骤结果
    entry.seenRequestIds.push(requestId)
    const state: StepState = opts.result
    step.result = opts.result
    step.state = state
    step.actual = opts.actual
    step.executionId = claimedExec
    step.operator = operator
    const evidence = opts.evidence?.trim() || `RT-${Date.now().toString().slice(-5)}`
    step.evidence = evidence
    step.retainedResult = undefined
    step.retainedEvidence = undefined
    step.retainedExecutionId = undefined
    entry.state = state
    entry.updatedAt = nowTime()

    const execution = executions.value.find((record) => record.id === claimedExec)
    if (execution) {
      for (const raw of evidence.split(/[、,，;；]/)) {
        const token = raw.trim()
        if (token && !execution.evidence.some((saved) => normalize(saved).includes(normalize(token)) || normalize(token).includes(normalize(saved)))) {
          execution.evidence.push(token)
        }
      }
      if (item.steps.every((s) => s.state === '通过') || item.steps.some((s) => s.state === '失败')) {
        const failed = item.steps.some((s) => s.state === '失败')
        execution.result = failed ? '失败' : '通过'
        execution.finishedAt = nowTime()
        for (const ledgerItem of ledger.value) {
          if (ledgerItem.executionId === claimedExec && ledgerItem.credentialStatus !== '已交班') {
            ledgerItem.credentialStatus = '已交班'
          }
        }
      }
    }

    recomputeCase(item)
    logReport({ requestId, executionId: claimedExec, stepId: opts.stepId, channel, outcome: '已接收', result: opts.result, operator, detail: '结果写入交接台账' })
    liveMessage.value = `已接收：${opts.stepId} = ${opts.result}（执行号 ${claimedExec}，请求号 ${requestId}）`
    persist()
  }

  /** 演练：同一请求号连续补传两次，第二次必须被幂等拒收 */
  function injectDuplicateReport(step: TestStep, result: StepResult = '失败') {
    const requestId = `REQ-DUP-${step.id}`
    reportStepResult({ caseId: selectedCaseId.value, stepId: step.id, result, requestId, channel: '回网补传', actual: '旧端断网期间缓存结果，回网补传', evidence: `DUP-${step.id}` })
    reportStepResult({ caseId: selectedCaseId.value, stepId: step.id, result, requestId, channel: '回网补传', actual: '旧端重发同一请求号', evidence: `DUP-${step.id}` })
  }

  /** 演练：旧执行号晚到结果留作复核（需要该步骤历史上属于过另一个执行号） */
  function injectStaleReport(step: TestStep, result: StepResult = '通过') {
    const old = ledger.value.find((entry) => entry.stepId === step.id && entry.executionId !== step.executionId)
    if (!old) {
      liveMessage.value = '该步骤还没有旧执行号：请先用顶部“开始执行当前用例”开新执行号并跑出新进度'
      return
    }
    reportStepResult({
      caseId: selectedCaseId.value, stepId: step.id, result,
      executionId: old.executionId, requestId: `REQ-LATE-${step.id}-${Date.now() % 1000}`,
      channel: '回网补传', actual: '白班旧端断网缓存，回网后才到达', evidence: `LATE-${step.id}`,
    })
  }

  function dismissReview(reviewId: string, note = '复核完成：晚到旧结果不覆盖当前进度，留档作废') {
    const review = reviews.value.find((item) => item.id === reviewId)
    if (!review) return
    review.status = '已作废'
    review.note = note
    liveMessage.value = `复核项 ${reviewId} 已闭环`
    persist()
  }

  /* ================= 规则三：步骤依赖改动，后续结果立即失效，证据完整则保留 ================= */

  function changeDependency(caseId: string, stepId: string, dependency: string | undefined) {
    if (baselineLocked.value) { liveMessage.value = '基线已锁定，依赖不可变更'; return }
    const item = findCase(caseId)
    const step = item && findStep(item, stepId)
    if (!item || !step) return
    if (dependency === step.id) { liveMessage.value = '步骤不能依赖自身'; return }
    if (dependency === step.dependency) { liveMessage.value = '依赖未发生变化，不触发失效'; return }
    // 环检测：新依赖的上游链上不能出现本步骤
    let cursor = dependency
    const seen = new Set<string>()
    while (cursor) {
      if (cursor === step.id) { liveMessage.value = '依赖改动会形成环，已拒绝'; return }
      if (seen.has(cursor)) break
      seen.add(cursor)
      cursor = findStep(item, cursor)?.dependency
    }
    step.dependency = dependency

    // 沿依赖边向下收集受影响步骤（含改动步骤本身）
    const affected = new Set<string>([stepId])
    let frontier = [stepId]
    while (frontier.length) {
      const next: string[] = []
      for (const id of frontier) {
        for (const candidate of item.steps) {
          if (candidate.dependency === id && !affected.has(candidate.id)) { affected.add(candidate.id); next.push(candidate.id) }
        }
      }
      frontier = next
    }
    for (const target of item.steps) {
      if (!affected.has(target.id)) continue
      target.depVersion += 1
      if (target.state === '通过' || target.state === '失败') {
        const complete = !!target.evidence?.trim()
        if (complete) {
          // 证据完整：结果立即失效但证据保留，等待重跑；同时挂一条复核留痕
          target.retainedResult = target.result
          target.retainedEvidence = target.evidence
          target.retainedExecutionId = target.executionId
          reviews.value.unshift({
            id: nextId('RV'), stepId: target.id, caseId: item.id,
            executionId: target.executionId ?? '—', requestId: nextId('REQ-DEP'),
            reason: '失效留证', operator: currentOperator.value, payload: target.result,
            evidence: target.evidence, receivedAt: nowTime(), status: '待复核',
            note: '步骤依赖改动，旧结果立即失效；证据完整予以保留，重跑通过后可关闭',
          })
        }
        target.result = '未执行'
        target.state = '失效'
        target.actual = undefined
        target.evidence = undefined
        const entry = ledgerEntry(target.executionId, target.id)
        if (entry) { entry.state = '失效'; entry.updatedAt = nowTime() }
      }
    }
    recomputeCase(item)
    liveMessage.value = `依赖已改动：${[...affected].join('、')} 的既有结果立即失效，证据完整者保留备查`
    persist()
  }

  /* ================= 执行号生命周期 ================= */

  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = findCase(id)?.routeIds ?? []
  }

  /** 新开执行号：未完成 / 失效步骤归到新执行号，旧执行号的台账与结果原样保留 */
  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    const id = `EX-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`
    item.status = '执行中'
    executions.value.unshift({
      id, caseId: item.id, operators: [currentOperator.value],
      startedAt: nowTime(), snapshot: 'v26.10 / CS-LEU-09',
      result: '执行中', evidence: [],
    })
    for (const step of item.steps) {
      const unfinished = step.state !== '通过' && step.state !== '失败'
      if (unfinished) {
        step.executionId = id
        step.operator = currentOperator.value
        step.result = '未执行'
        step.state = '续跑中'
        step.actual = undefined
        step.evidence = undefined
        ledger.value.push({
          executionId: id, caseId: item.id, stepId: step.id, state: '续跑中',
          operator: currentOperator.value, credentialToken: `CRED-${id}-${step.id}`,
          credentialStatus: '有效', credentialExpiresAt: minutesFromNow(30),
          seenRequestIds: [], updatedAt: nowTime(),
        })
      }
    }
    liveMessage.value = `已开新执行号 ${id}，持有人 ${currentOperator.value}，未完成步骤续跑中`
    persist()
  }

  /** 当前选中用例的进行中执行号 */
  const selectedActiveExecution = computed(() => activeExecution(selectedCaseId.value))

  /** 对某一步用新执行号重测：旧执行号的台账与结果原样保留，供晚到结果对照 */
  function rerunStep(caseId: string, stepId: string) {
    const item = findCase(caseId)
    const step = item && findStep(item, stepId)
    if (!item || !step) return
    let execution = activeExecution(caseId)
    if (!execution) {
      const id = `EX-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`
      // 重测是同一交接任务的延续：新执行号继承原执行号的交接链，避免链断点
      const previous = executions.value.find((record) => record.id === step.executionId)
      const operators = previous ? [...previous.operators] : [currentOperator.value]
      if (!operators.includes(currentOperator.value)) operators.push(currentOperator.value)
      execution = { id, caseId: item.id, operators, startedAt: nowTime(), snapshot: 'v26.10 / CS-LEU-09', result: '执行中', evidence: [] }
      executions.value.unshift(execution)
    }
    if (step.state === '通过' || step.state === '失败') {
      if (!execution.operators.includes(currentOperator.value)) execution.operators.push(currentOperator.value)
    }
    step.executionId = execution.id
    step.operator = currentOperator.value
    step.result = '未执行'
    step.state = '续跑中'
    step.actual = undefined
    step.evidence = undefined
    step.retainedResult = undefined
    step.retainedEvidence = undefined
    step.retainedExecutionId = undefined
    if (!ledgerEntry(execution.id, stepId)) {
      ledger.value.push({
        executionId: execution.id, caseId: item.id, stepId, state: '续跑中',
        operator: currentOperator.value, credentialToken: `CRED-${execution.id}-${stepId}`,
        credentialStatus: '有效', credentialExpiresAt: minutesFromNow(30),
        seenRequestIds: [], updatedAt: nowTime(),
      })
    }
    item.status = '执行中'
    liveMessage.value = `${stepId} 已在执行号 ${execution.id} 下重测；旧执行号台账保留，旧端晚到结果只能留复核`
    persist()
  }

  function setStepResult(caseId: string, stepId: string, result: StepResult, actual?: string) {
    reportStepResult({ caseId, stepId, result, actual })
  }

  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '同步通道提示：全部步骤上报完毕，以交接台账为准' : `实时同步：台账进度约 ${value}%`
  }

  function lockBaseline() {
    if (!releaseReady.value) {
      liveMessage.value = `门禁阻断：仍有 ${gateBlockCount.value} 项缺记录 / 证据不一致 / 未决复核`
      return
    }
    baselineLocked.value = true
    liveMessage.value = '发布基线已锁定：每步执行号、交接人、证据与复核项全部一致'
    persist()
  }

  return {
    cases, executions, selectedCaseId, selectedRouteIds, selectedCase, progress,
    baselineLocked, connection, pendingRetry, liveMessage, currentOperator, operatorOptions,
    ledger, reviews, reports, openReviews, releaseRows, gateBlockCount, releaseReady,
    selectedActiveExecution, changedDevices, affectedCases,
    selectCase, switchOperator, startExecution, rerunStep, setStepResult, reportStepResult,
    simulateDisconnect, retry, handOver, expireCredential, takeOver,
    injectDuplicateReport, injectStaleReport, dismissReview, changeDependency,
    updateLiveProgress, lockBaseline,
  }
})
