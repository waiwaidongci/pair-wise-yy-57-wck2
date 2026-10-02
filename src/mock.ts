import type { ExecutionRecord, HandoffRecord, ReportRecord, StationDevice, TestCase, TestStep } from './types'

export const devices: StationDevice[] = [
  { id:'P-01',name:'1# 道岔',kind:'道岔',x:18,y:58,routeIds:['R-01','R-02'] },
  { id:'P-02',name:'2# 道岔',kind:'道岔',x:42,y:58,routeIds:['R-01','R-03'] },
  { id:'P-03',name:'3# 道岔',kind:'道岔',x:67,y:58,routeIds:['R-02','R-04'] },
  { id:'X-01',name:'X 进站信号机',kind:'信号机',x:9,y:35,routeIds:['R-01','R-03'] },
  { id:'S-01',name:'S 出站信号机',kind:'信号机',x:88,y:35,routeIds:['R-01','R-02','R-04'] },
  { id:'S-02',name:'S2 出站信号机',kind:'信号机',x:74,y:78,routeIds:['R-02','R-04'] },
  { id:'T-01',name:'1G 轨道区段',kind:'轨道区段',x:29,y:45,routeIds:['R-01','R-02'] },
  { id:'T-02',name:'2G 轨道区段',kind:'轨道区段',x:55,y:45,routeIds:['R-01','R-03','R-04'] },
  { id:'T-03',name:'3G 轨道区段',kind:'轨道区段',x:77,y:65,routeIds:['R-02','R-04'] },
]

export const routes = [
  { id:'R-01',name:'X → 1G → S',color:'#2563eb',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-01','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-02',name:'X → 2G → S2',color:'#059669',points:[[9,35],[18,35],[18,58],[42,58],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['X-01','P-01','P-02','P-03','T-01','T-03','S-02'],affectedBy:['P-02 转辙机更换','T-03 绝缘节调整'] },
  { id:'R-03',name:'X → 2G → S',color:'#d97706',points:[[9,35],[18,35],[18,58],[42,58],[42,45],[88,45],[88,35]] as [number,number][],devices:['X-01','P-01','P-02','T-02','S-01'],affectedBy:['P-02 转辙机更换'] },
  { id:'R-04',name:'2G → 3G → S2',color:'#7c3aed',points:[[42,45],[67,45],[67,58],[67,65],[74,65],[74,78],[88,78]] as [number,number][],devices:['P-03','T-02','T-03','S-02'],affectedBy:['T-03 绝缘节调整'] },
]

const ISO = (value: string) => new Date(value).toISOString()

/** 构造一张步骤执行凭证 */
function credential(executionId: string, holder: string, issuedAt: string, hours = 12, handedOff = false) {
  const issued = new Date(issuedAt).getTime()
  return {
    executionId,
    holder,
    issuedAt: ISO(issuedAt),
    expiresAt: new Date(issued + hours * 3600 * 1000).toISOString(),
    handedOff,
  }
}

export const seedCases: TestCase[] = [
  { id:'TC-101',name:'X 至 S 正线接车进路建立',routeIds:['R-01'],precondition:'1G、2G 空闲，道岔在定位，无敌对进路',version:'v26.09',status:'通过',steps:[
    { id:'TS-1',action:'排列 X → S 接车进路',expected:'X 信号开放，P-01/P-02 锁闭',result:'通过',actual:'信号开放，联锁状态一致',evidence:'截图 XS-026',credential:credential('EX-260929-03','陆晨','2026-10-02T09:00:00+08:00') },
    { id:'TS-2',action:'人工扳动 P-02',expected:'道岔锁闭，操作被拒绝',dependency:'TS-1',result:'通过',actual:'拒绝并记录操作',evidence:'日志 LG-108',credential:credential('EX-260929-03','陆晨','2026-10-02T09:05:00+08:00'),evidenceHistory:[
      { id:'EV-OLD-01',executionId:'EX-260929-01',result:'通过',actual:'初测扳动被拒',evidence:'截图 XS-010',recordedAt:ISO('2026-09-28T10:00:00+08:00'),reason:'v26.09 依赖调整后下游结果作废，证据保留归档' },
    ] },
  ] },
  { id:'TC-102',name:'X 至 S2 侧线接车与3G占用',routeIds:['R-02'],precondition:'3G 空闲，P-03 反位',version:'v26.09',status:'执行中',steps:[
    { id:'TS-3',action:'排列 X → S2 侧线进路',expected:'X、S2 信号开放，P-03 锁闭反位',result:'通过',actual:'进路建立正常',evidence:'截图 XS-031',credential:credential('EX-260929-02','方瑜','2026-10-02T08:00:00+08:00',12,true) },
    { id:'TS-4',action:'模拟 3G 轨道区段占用',expected:'立即关闭 S2 信号，保持进路锁闭',result:'未执行',suspended:true },
  ] },
  { id:'TC-103',name:'敌对进路 R-01 / R-02 互锁',routeIds:['R-01','R-02'],precondition:'1G 空闲，P-01/P-02 可转换',version:'v26.09',status:'失败',failureReason:'实测可短暂同时开放 X 信号，疑似软件版本差异',steps:[
    { id:'TS-5',action:'建立 R-01 后尝试排列 R-02',expected:'拒绝排列并保持 R-01 锁闭',result:'失败',actual:'R-02 请求进入等待态，X 信号未保持',evidence:'录屏 VID-014、日志 LG-119',credential:credential('EX-260929-04','陆晨','2026-10-02T09:20:00+08:00') },
  ] },
  { id:'TC-104',name:'2G 至3G 调车进路和绝缘节',routeIds:['R-04'],precondition:'T-02、T-03 空闲',version:'v26.10',status:'阻塞',failureReason:'等待 T-03 绝缘节调整完成',steps:[
    { id:'TS-6',action:'排列 2G → 3G 调车进路',expected:'D 信号开放，P-03 反位锁闭',result:'未执行' },
  ] },
]

export const seedExecutions: ExecutionRecord[] = [
  { id:'EX-260929-04',caseId:'TC-103',operator:'陆晨',startedAt:'16:10',finishedAt:'16:38',snapshot:'v26.09 / CS-LEU-08',result:'失败',evidence:['VID-014','LG-119'] },
  { id:'EX-260929-03',caseId:'TC-101',operator:'陆晨',startedAt:'15:20',finishedAt:'15:44',snapshot:'v26.09 / CS-LEU-08',result:'通过',evidence:['XS-026','LG-108'] },
  { id:'EX-260929-02',caseId:'TC-102',operator:'方瑜',startedAt:'14:52',snapshot:'v26.09 / CS-LEU-08',result:'执行中',evidence:['XS-031'] },
]

/** 种子交接单：白班方瑜交班 → 夜班陆晨接手，TS-4 挂起待接手 */
export const seedHandoffs: HandoffRecord[] = [
  {
    id:'HO-261002-01',
    caseId:'TC-102',
    executionId:'EX-260929-02',
    fromOperator:'方瑜',
    toOperator:'陆晨',
    state:'待接手',
    suspendedStepIds:['TS-4'],
    createdAt:ISO('2026-10-02T16:30:00+08:00'),
    note:'白班交班：TS-3 已完成，TS-4 模拟占用未做，夜班接手后续跑',
  },
]

/**
 * 种子上报请求。
 * RQ-TS3-01 / RQ-TS5-01 为已采纳；
 * RQ-LATE-01 为交班后晚到的旧执行号结果（留待复核，不覆盖 TS-4）；
 * RQ-TS5-01 重复请求号演示幂等拒收。
 */
export const seedReports: ReportRecord[] = [
  { requestId:'RQ-TS3-01',executionId:'EX-260929-02',caseId:'TC-102',stepId:'TS-3',result:'通过',actual:'进路建立正常',evidence:'截图 XS-031',operator:'方瑜',reportedAt:ISO('2026-10-02T15:10:00+08:00'),disposition:'已采纳' },
  { requestId:'RQ-LATE-01',executionId:'EX-260929-02',caseId:'TC-102',stepId:'TS-4',result:'通过',actual:'模拟 3G 占用后 S2 立即关闭，进路锁闭',evidence:'录屏 VID-099、日志 LG-140',operator:'方瑜',reportedAt:ISO('2026-10-02T17:05:00+08:00'),disposition:'旧结果待复核',reason:'交班后晚到的旧执行号结果，执行号 EX-260929-02 已失效，不覆盖当前进度' },
  { requestId:'RQ-TS5-01',executionId:'EX-260929-04',caseId:'TC-103',stepId:'TS-5',result:'失败',actual:'R-02 请求进入等待态，X 信号未保持',evidence:'录屏 VID-014、日志 LG-119',operator:'陆晨',reportedAt:ISO('2026-10-02T16:38:00+08:00'),disposition:'已采纳' },
  { requestId:'RQ-TS5-01',executionId:'EX-260929-04',caseId:'TC-103',stepId:'TS-5',result:'失败',operator:'陆晨',reportedAt:ISO('2026-10-02T16:38:30+08:00'),disposition:'重复拒收',reason:'请求号 RQ-TS5-01 已处理，重复上报只收一次' },
]
