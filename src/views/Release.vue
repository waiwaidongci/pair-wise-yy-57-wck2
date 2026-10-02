<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const ready = computed(() => store.releaseReady)

function exportPackage() {
  const report = {
    station: '海州站 CS', version: 'v26.10', locked: store.baselineLocked,
    gateRows: store.releaseRows.map((row) => ({
      caseId: row.caseId, stepId: row.step.id, state: row.step.state,
      executionId: row.executionId ?? null, handoffChain: row.handoffChain,
      evidence: row.step.evidence ?? null, problems: row.problems,
    })),
    executions: store.executions,
    reviews: store.reviews,
    reports: store.reports,
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
  <section class="page-head">
    <div>
      <p class="eyebrow">发布门禁与交接核验</p>
      <h1>基线锁定与测试报告</h1>
      <p>锁定前逐行核对每个步骤的当前执行号、交接人、证据一致性和未决复核项；缺记录或证据不一致一律不放行。</p>
    </div>
    <n-space>
      <n-button @click="exportPackage">导出测试报告</n-button>
      <n-button type="primary" :disabled="!ready || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button>
    </n-space>
  </section>

  <n-alert
    :type="ready ? 'success' : 'error'"
    :title="ready ? '全部步骤交接、证据、复核闭环，可锁定' : `发布门禁未通过（${store.gateBlockCount} 项阻断）`"
    :description="ready ? '每步执行号唯一、交接链连续、证据与执行记录一致、无未决复核。' : '存在缺执行记录、证据不一致、步骤未完成 / 失效或未决复核，任何人员不得绕过。'"
    style="margin-bottom:16px"
  />

  <article class="card" style="margin-bottom:16px">
    <div class="panel-head">
      <div><h2>逐步骤交接核验表</h2><p>与步骤、执行记录共用同一份交接记录</p></div>
      <n-tag :type="ready ? 'success' : 'error'">{{ ready ? '可发布' : '阻断' }}</n-tag>
    </div>
    <n-table :single-line="false" size="small">
      <thead>
        <tr>
          <th>用例 / 步骤</th><th>状态</th><th>当前执行号</th><th>交接人链</th>
          <th>证据核对</th><th>未决复核</th><th>阻断项</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.releaseRows" :key="row.caseId + row.step.id" :class="{ blocked: row.problems.length }">
          <td><b>{{ row.caseId }} · {{ row.step.id }}</b><small class="meta">{{ row.step.action }}</small></td>
          <td><n-tag size="small" :type="row.step.state === '通过' ? 'success' : row.step.state === '失败' ? 'error' : 'warning'">{{ row.step.state }}</n-tag></td>
          <td>{{ row.executionId ?? '—' }}</td>
          <td>{{ row.handoffChain }}</td>
          <td>
            <small class="meta">步骤：{{ row.step.evidence ?? '（无）' }}</small>
            <small class="meta">执行记录：{{ row.execution?.evidence.join('、') || '（无记录）' }}</small>
          </td>
          <td>
            <n-tag v-for="review in store.reviews.filter((r) => r.stepId === row.step.id && r.status === '待复核')" :key="review.id" size="small" type="warning" style="margin:2px">
              {{ review.reason }} {{ review.requestId }}
            </n-tag>
            <span v-if="!store.reviews.some((r) => r.stepId === row.step.id && r.status === '待复核')" class="meta">无</span>
          </td>
          <td>
            <n-tag v-for="problem in row.problems" :key="problem" size="small" type="error" style="margin:2px">{{ problem }}</n-tag>
            <n-text v-if="!row.problems.length" type="success">通过</n-text>
          </td>
        </tr>
      </tbody>
    </n-table>
  </article>

  <div class="grid-2">
    <article class="card">
      <div class="panel-head"><div><h2>执行号汇总</h2><p>交接班在同执行号内完成，重测另开新号</p></div></div>
      <div v-for="record in store.executions" :key="record.id" class="gate">
        <div>
          <b>{{ record.id }} · {{ record.caseId }}</b>
          <small class="meta">交接链：{{ record.operators.join(' → ') }} · {{ record.startedAt }}{{ record.finishedAt ? ' → ' + record.finishedAt : '' }}</small>
          <small class="meta">证据：{{ record.evidence.join('、') || '采集中' }}</small>
        </div>
        <n-tag :type="record.result === '通过' ? 'success' : record.result === '失败' ? 'error' : 'warning'">{{ record.result }}</n-tag>
      </div>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>差异与基线状态</h2><p>v26.09 → v26.10</p></div><n-tag>2 项设备变更</n-tag></div>
      <div class="diff"><b>P-02 转辙机更换</b><p>影响 R-01、R-02、R-03；转辙机动作时序与锁闭反馈差异需重测。</p></div>
      <div class="diff"><b>T-03 绝缘节调整</b><p>影响 R-02、R-04；轨道区段占用边界和信号关闭时机需重测。</p></div>
      <n-divider />
      <n-result
        :status="store.baselineLocked ? 'success' : ready ? 'info' : 'error'"
        :title="store.baselineLocked ? 'v26.10 已锁定（只读）' : ready ? '可锁定' : '等待阻断项闭环'"
        :description="store.baselineLocked ? '交接台账、证据哈希与复核结论已签章。' : `${store.gateBlockCount} 项缺记录 / 证据不一致 / 未决复核未关闭。`"
      />
    </article>
  </div>
</template>
