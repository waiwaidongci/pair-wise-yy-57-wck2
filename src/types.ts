export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

export interface StationDevice {
  id: string
  name: string
  kind: '道岔' | '信号机' | '轨道区段'
  x: number
  y: number
  routeIds: string[]
}

export interface RouteRelation {
  id: string
  name: string
  color: string
  points: [number, number][]
  devices: string[]
  affectedBy: string[]
}

/** 步骤执行状态：未执行 / 挂起（交接前）/ 续跑中 / 通过 / 失败 / 失效（依赖改动） */
export type StepState = '未执行' | '挂起' | '续跑中' | '通过' | '失败' | '失效'
export type StepResult = '未执行' | '通过' | '失败'

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: StepResult
  /** 当前交接状态，是步骤、执行记录、发布基线三方共用的视图 */
  state: StepState
  actual?: string
  evidence?: string
  /** 该步骤最近一次有效结果所属的执行号 */
  executionId?: string
  /** 产生当前结果的执行人（交班链上的当前持有人） */
  operator?: string
  /** 结果所依据的依赖版本（依赖改动后用于判定失效） */
  depVersion: number
  /** 依赖改动后失效，但证据完整时保留旧结果供追溯 */
  retainedResult?: StepResult
  retainedEvidence?: string
  retainedExecutionId?: string
}

export interface TestCase {
  id: string
  name: string
  routeIds: string[]
  precondition: string
  version: string
  status: TestStatus
  steps: TestStep[]
  failureReason?: string
}

export type ExecutionResult = '执行中' | '通过' | '失败'

export interface ExecutionRecord {
  id: string
  caseId: string
  /** 交班链：白班原执行人 → 夜班接手人，顺序即交接顺序 */
  operators: string[]
  startedAt: string
  finishedAt?: string
  snapshot: string
  result: ExecutionResult
  evidence: string[]
}

export type ReviewReason = '晚到旧结果' | '重复上报' | '失效留证'
export type ReviewStatus = '待复核' | '已作废'

/** 未决复核项：晚到的旧结果、重复上报、失效留证都要发布前闭环 */
export interface ReviewItem {
  id: string
  stepId: string
  caseId: string
  executionId: string
  requestId: string
  reason: ReviewReason
  operator: string
  payload: StepResult
  actual?: string
  evidence?: string
  receivedAt: string
  status: ReviewStatus
  note?: string
}

export type ReportOutcome = '已接收' | '重复拒收' | '留作复核'
export type ReportChannel = '现场上报' | '回网补传'

/** 上报流水：同一执行号 + 请求号只收一次，全部留痕 */
export interface ReportLog {
  requestId: string
  executionId: string
  stepId: string
  channel: ReportChannel
  outcome: ReportOutcome
  result: StepResult
  operator: string
  at: string
  detail: string
}

/** 凭证状态：原执行人持有 → 交班挂起 / 过期 → 接手人续跑 */
export type CredentialStatus = '有效' | '已交班' | '已过期' | '续跑中'

/**
 * 交接记录（步骤、执行记录、发布基线共用的唯一事实来源）。
 * 一个执行号在某步骤上有且仅有一条。
 */
export interface HandoffEntry {
  executionId: string
  caseId: string
  stepId: string
  state: StepState
  operator: string
  successor?: string
  handedOverAt?: string
  credentialToken: string
  credentialStatus: CredentialStatus
  credentialExpiresAt: string
  /** 该执行号已收过的请求号，保证幂等 */
  seenRequestIds: string[]
  updatedAt: string
}
