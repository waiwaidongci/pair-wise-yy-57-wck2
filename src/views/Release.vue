<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const ready = computed(() => !store.releaseBlocked)

function lock() { store.lockBaseline() }
function exportPackage() {
  const report = {
    station: '海州站 CS', version: 'v26.10', locked: store.baselineLocked,
    operator: store.currentOperator,
    cases: store.cases.map((item) => ({
      id: item.id, name: item.name, status: item.status, steps: item.steps.length, failureReason: item.failureReason,
      stepGate: store.releaseSteps.filter((gate) => gate.caseId === item.id),
    })),
    executions: store.executions,
    handoffs: store.handoffs,
    reports: store.reports,
    pendingReviewCount: store.pendingReviewCount,
    generatedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '联锁测试报告-v26.10.json'
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>每步执行号、交接人、未决复核项逐项核验；缺记录、挂起未接手或证据不一致，一律不放行。</p></div><n-space><n-button @click="exportPackage">导出测试报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="lock">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '门禁逐项通过，可锁定' : '发布门禁未通过，不予放行'" :description="store.liveMessage" style="margin-bottom:16px" />
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>逐步核验执行号、交接人与复核项</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.cases" :key="item.id" class="gate-case"><div class="gate-case-head"><b>{{item.id}} · {{item.name}}</b><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':'warning'">{{item.status}}</n-tag></div><div v-for="gate in store.releaseSteps.filter((g)=>g.caseId===item.id)" :key="gate.stepId" class="gate-step" :class="{blocked:gate.blocked}"><div class="gate-step-main"><b>{{gate.stepId}}</b><small>执行号：{{gate.executionId}} · 交接人：{{gate.holder}}<template v-if="gate.handoffLabel!=='—'"> · 交接单：{{gate.handoffLabel}}</template></small><small v-if="gate.pendingReviews">未决复核：{{gate.pendingReviews}} 项</small><small v-if="!gate.blocked" class="ok">记录与证据一致</small></div><n-tag v-if="gate.blocked" type="error" size="small">阻断</n-tag><n-tag v-else type="success" size="small">通过</n-tag></div><ul v-if="store.releaseSteps.filter((g)=>g.caseId===item.id && g.blocked).length" class="gate-issues"><li v-for="issue in store.releaseSteps.filter((g)=>g.caseId===item.id && g.blocked).flatMap((g)=>g.issues)" :key="issue">{{issue}}</li></ul></div></article>
    <article class="card"><div class="panel-head"><div><h2>差异与影响范围</h2><p>v26.09 → v26.10</p></div><n-tag>2 项设备变更</n-tag></div><div class="diff"><b>P-02 转辙机更换</b><p>影响 R-01、R-02、R-03；新增转辙机动作时序与锁闭反馈差异。</p></div><div class="diff"><b>T-03 绝缘节调整</b><p>影响 R-02、R-04；轨道区段占用边界和信号关闭时机需重测。</p></div><n-divider /><h3>交接与复核</h3><div class="diff"><p>进行中交接单 {{store.handoffs.filter((h)=>h.state==='待接手').length}} 张 · 未决复核 {{store.pendingReviewCount}} 项 · 重复拒收 {{store.reports.filter((r)=>r.disposition==='重复拒收').length}} 次</p></div><n-divider /><h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? 'v26.10 已锁定' : '等待门禁通过'" :description="store.baselineLocked ? '报告、交接单与证据已签章归档。' : '锁定后生成只读版本快照。'" /></article></div>
</template>
