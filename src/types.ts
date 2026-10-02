export type TestStatus = '未执行' | '执行中' | '通过' | '失败' | '阻塞'

export type StepResult = '未执行' | '通过' | '失败'

/** 交接单状态：待接手（已交班/凭证失效）、已接手、凭证过期 */
export type HandoffState = '待接手' | '已接手' | '凭证过期'

/** 上报请求处置：已采纳、重复拒收（按请求号幂等）、旧结果留待复核 */
export type ReportDisposition = '已采纳' | '重复拒收' | '旧结果待复核' | '已归档' | '已驳回'

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

/**
 * 步骤执行凭证（租约）。
 * 一步一证，记录当前执行号、持证人、签发与过期时间、是否已交班。
 * 只有「原执行人已交班」或「凭证已过期」后，接班人才可续跑。
 */
export interface StepCredential {
  executionId: string
  holder: string
  issuedAt: string
  expiresAt: string
  handedOff: boolean
  handoffId?: string
}

/** 失效但保留的证据记录：依赖改动后下游结果作废，证据不丢。 */
export interface EvidenceRecord {
  id: string
  executionId: string
  result: Exclude<StepResult, '未执行'>
  actual?: string
  evidence?: string
  recordedAt: string
  reason?: string
}

export interface TestStep {
  id: string
  action: string
  expected: string
  dependency?: string
  result: StepResult
  actual?: string
  evidence?: string
  /** 交班后、接手前的挂起标记 */
  suspended?: boolean
  /** 依赖改动后下游结果作废标记（证据仍在 evidenceHistory 保留） */
  invalidated?: boolean
  /** 当前执行凭证 */
  credential?: StepCredential
  /** 作废但保留的证据 */
  evidenceHistory?: EvidenceRecord[]
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

export interface ExecutionRecord {
  id: string
  caseId: string
  operator: string
  startedAt: string
  finishedAt?: string
  snapshot: string
  result: TestStatus
  evidence: string[]
}

/**
 * 交接记录 —— 用例步骤、执行记录、发布基线共用的同一份交接单。
 * 交班时生成，接手时核销；步骤凭证与执行号都挂在交接单上。
 */
export interface HandoffRecord {
  id: string
  caseId: string
  /** 针对单步；为空表示整班交接（覆盖 suspendedStepIds） */
  stepId?: string
  executionId: string
  fromOperator: string
  toOperator?: string
  state: HandoffState
  suspendedStepIds: string[]
  createdAt: string
  resumedAt?: string
  note?: string
}

/**
 * 上报请求。按 requestId 幂等（同一请求号只收一次）；
 * 执行号已失效的晚到结果不覆盖进度，转待复核。
 */
export interface ReportRecord {
  requestId: string
  executionId: string
  caseId: string
  stepId: string
  result: Exclude<StepResult, '未执行'>
  actual?: string
  evidence?: string
  operator: string
  reportedAt: string
  disposition: ReportDisposition
  reason?: string
}

/** 发布门禁的逐步核查信息 */
export interface StepGateInfo {
  caseId: string
  stepId: string
  executionId: string
  holder: string
  handoffLabel: string
  pendingReviews: number
  issues: string[]
  blocked: boolean
}
