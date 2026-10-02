<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const editMode = ref(false)
const selectedCase = computed(() => store.selectedCase)
const pendingDependency = ref<Record<string, string | undefined>>({})

function ledgerOf(stepId: string, executionId?: string) {
  return store.ledger.find((entry) => entry.executionId === executionId && entry.stepId === stepId)
}
function applyDependency(stepId: string) {
  if (!selectedCase.value) return
  store.changeDependency(selectedCase.value.id, stepId, pendingDependency.value[stepId])
}
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">步骤、预期与依赖</p>
      <h1>测试用例编排</h1>
      <p>步骤依赖改动后，沿依赖链后续结果立即失效；证据完整的旧结果保留备查并重跑。</p>
    </div>
    <n-space><n-switch v-model:value="editMode">批量编辑模式</n-switch></n-space>
  </section>
  <div class="case-grid">
    <aside class="card case-list">
      <n-input placeholder="搜索用例、进路或设备" clearable />
      <button v-for="item in store.cases" :key="item.id" :class="{ active: item.id === store.selectedCaseId }" @click="store.selectCase(item.id)">
        <div><b>{{ item.id }}</b><small>{{ item.name }}</small></div>
        <n-tag :type="item.status === '通过' ? 'success' : item.status === '失败' ? 'error' : item.status === '阻塞' ? 'warning' : 'info'">{{ item.status }}</n-tag>
      </button>
    </aside>
    <article class="card detail" v-if="selectedCase">
      <div class="panel-head">
        <div><h2>{{ selectedCase.id }} · {{ selectedCase.name }}</h2><p>{{ selectedCase.precondition }}</p></div>
        <n-tag type="info">{{ selectedCase.version }}</n-tag>
      </div>
      <n-alert v-if="selectedCase.failureReason" type="error" title="当前阻塞 / 失败原因" :description="selectedCase.failureReason" style="margin-bottom:10px" />
      <h3>执行步骤、执行号与交接人</h3>
      <div v-for="(step, index) in selectedCase.steps" :key="step.id" class="step" :class="step.state">
        <div class="step-index">{{ index + 1 }}</div>
        <div class="step-main">
          <div class="step-head">
            <b>{{ step.action }}</b>
            <n-space size="small">
              <n-tag size="small" :type="step.state === '通过' ? 'success' : step.state === '失败' ? 'error' : step.state === '失效' ? 'warning' : 'info'">{{ step.state }}</n-tag>
              <n-tag size="small" :type="ledgerOf(step.id, step.executionId)?.credentialStatus === '有效' || ledgerOf(step.id, step.executionId)?.credentialStatus === '续跑中' ? 'success' : ledgerOf(step.id, step.executionId)?.credentialStatus === '已过期' ? 'error' : 'default'">
                {{ ledgerOf(step.id, step.executionId)?.credentialStatus ?? '无凭证' }}
              </n-tag>
            </n-space>
          </div>
          <p>预期：{{ step.expected }}</p>
          <small v-if="step.dependency">依赖步骤：{{ step.dependency }} · 依赖版本 v{{ step.depVersion }}</small>
          <small v-else>无前置依赖 · 依赖版本 v{{ step.depVersion }}</small>
          <small v-if="step.actual">实测：{{ step.actual }}</small>
          <small v-if="step.evidence">证据：{{ step.evidence }}</small>
          <small v-if="step.retainedResult" class="retained">
            失效留证：{{ step.retainedResult }} · {{ step.retainedEvidence }}（原执行号 {{ step.retainedExecutionId }}，需重跑）
          </small>
          <small class="meta">执行号 {{ step.executionId ?? '—' }} · 交接人 {{ step.operator ?? '—' }}</small>
          <div v-if="editMode" class="dep-edit">
            <n-select
              size="small" style="width:220px" clearable
              placeholder="改为依赖（空 = 无依赖）"
              :value="pendingDependency[step.id] ?? step.dependency"
              :options="selectedCase.steps.filter((s) => s.id !== step.id).map((s) => ({ label:`${s.id} ${s.action}`, value:s.id }))"
              @update:value="(value: string | null) => (pendingDependency[step.id] = value ?? undefined)"
            />
            <n-button size="small" type="warning" @click="applyDependency(step.id)">应用依赖改动</n-button>
          </div>
        </div>
      </div>
      <n-divider />
      <div class="dependency">
        <b>依赖图与交接链</b>
        <div class="nodes">
          <span v-for="step in selectedCase.steps" :key="step.id">
            {{ step.id }}<template v-if="step.dependency"> ← {{ step.dependency }}</template>
          </span>
        </div>
        <div class="lines">前一步挂起或未通过时不得跳过；凭证过期或交班完成后由接手人沿同执行号续跑。</div>
      </div>
    </article>
  </div>
</template>
