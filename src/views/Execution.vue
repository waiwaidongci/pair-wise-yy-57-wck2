<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')
const lastRequestId = ref('')

const openHandoff = computed(() => (store.selectedCase ? store.openHandoff(store.selectedCase.id) : undefined))
const targetStep = computed(() => store.selectedCase?.steps.find((entry) => entry.result === '未执行'))
const pendingReviews = computed(() => store.reports.filter((entry) => entry.disposition === '旧结果待复核'))
const recentReports = computed(() => store.reports.slice(0, 6))

function report(result: '通过' | '失败') {
  const item = store.selectedCase
  const step = targetStep.value
  if (!item || !step) return
  if (result === '失败' && !failureReason.value.trim()) return
  const requestId = `RQ-${Date.now().toString(36)}`
  lastRequestId.value = requestId
  store.reportResult({
    caseId: item.id, stepId: step.id, result,
    actual: result === '失败' ? failureReason.value : '预期结果一致，证据已归档',
    evidence: evidence.value, requestId,
  })
}
function duplicateLast() {
  const item = store.selectedCase
  const step = targetStep.value
  if (!item || !step || !lastRequestId.value) return
  store.reportResult({ caseId: item.id, stepId: step.id, result: '通过', actual: '重复上报', evidence: evidence.value, requestId: lastRequestId.value })
}
function simulateDisconnect() { store.simulateDisconnect() }
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">实时执行与证据</p><h1>回归执行记录</h1><p>每次执行关联执行号、持证人与凭证；交班后未完成步骤挂起，接手后续跑；晚到旧结果只作复核，不覆盖进度。</p></div><n-space><n-button @click="simulateDisconnect">模拟断线</n-button><n-button @click="store.raiseHandoff(store.selectedCaseId, '当班交班，未完成步骤挂起')">交班</n-button><n-button type="success" @click="report('通过')">记录通过</n-button><n-button type="error" @click="report('失败')">记录失败</n-button></n-space></section>

  <n-alert v-if="openHandoff" type="warning" class="handoff-banner" :title="`交接单 ${openHandoff.id}：${openHandoff.fromOperator} → ${openHandoff.toOperator ?? '待接班'}`" :description="`${openHandoff.note ?? '原执行人已交班，未完成步骤已挂起'}。接班人接手后发放新执行号凭证，方可续跑。`">
    <n-button type="primary" size="small" @click="store.takeOver(store.selectedCaseId)">接班接手</n-button>
  </n-alert>

  <div class="execution-grid"><article class="card"><div class="panel-head"><div><h2>{{store.selectedCase?.id}} 执行面板</h2><p>{{store.selectedCase?.name}}</p></div><n-tag :type="store.connection==='在线'?'success':'warning'">{{store.connection}} · {{store.liveMessage}}</n-tag></div><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="[step.result, { suspended: step.suspended, invalidated: step.invalidated }]"><div><b>{{step.id}} · {{step.action}}</b><small>预期：{{step.expected}}</small><small v-if="step.actual">实测：{{step.actual}}</small><small v-if="step.evidence">证据：{{step.evidence}}</small><small class="cred">执行号：{{step.credential?.executionId ?? '未签发'}} · 持证人：{{step.credential?.holder ?? '—'}}<template v-if="step.credential?.handedOff"> · 已交班</template><template v-if="step.credential && !step.credential.handedOff"> · {{store.stepResumeable(step) ? '可续跑' : '持有中'}}</template></small></div><div class="step-tags"><n-tag v-if="step.suspended" type="warning">挂起</n-tag><n-tag v-if="step.invalidated" type="error">已失效</n-tag><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'info'">{{step.result}}</n-tag><n-button v-if="step.credential && !step.credential.handedOff" text size="small" @click="store.expireStepCredential(store.selectedCaseId, step.id)">凭证过期</n-button></div></div><n-form label-placement="top"><n-form-item label="失败原因与设备快照"><n-input v-model:value="failureReason" type="textarea" :rows="3" /></n-form-item><n-form-item label="证据附件"><n-input v-model:value="evidence" /></n-form-item></n-form><n-space><n-button size="small" @click="duplicateLast" :disabled="!lastRequestId">模拟重复上报（同请求号）</n-button><n-tag v-if="lastRequestId" size="small">最近请求号 {{lastRequestId}}</n-tag></n-space></article>

    <aside class="card"><div class="panel-head"><div><h2>未决复核</h2><p>晚到旧结果留作复核，不覆盖进度</p></div><n-tag type="warning">{{pendingReviews.length}}</n-tag></div><div v-for="item in pendingReviews" :key="item.requestId" class="review-row"><div><b>{{item.requestId}} · {{item.stepId}}</b><small>执行号 {{item.executionId}} · {{item.operator}} · {{new Date(item.reportedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}}</small><small class="reason">{{item.reason}}</small></div><n-space vertical><n-button size="small" type="primary" @click="store.adoptReview(item.requestId)">采纳归档</n-button><n-button size="small" @click="store.dismissReview(item.requestId)">驳回</n-button></n-space></div><n-empty v-if="!pendingReviews.length" description="无未决复核项" /><n-divider /><div class="panel-head"><div><h2>上报记录</h2><p>按请求号幂等，重复只收一次</p></div></div><div v-for="item in recentReports" :key="item.requestId" class="report-row"><div><b>{{item.requestId}}</b><small>{{item.stepId}} · 执行号 {{item.executionId}}</small></div><n-tag :type="item.disposition==='已采纳'?'success':item.disposition==='重复拒收'?'default':item.disposition==='旧结果待复核'?'warning':item.disposition==='已归档'?'info':'error'" size="small">{{item.disposition}}</n-tag></div></aside></div>
</template>
