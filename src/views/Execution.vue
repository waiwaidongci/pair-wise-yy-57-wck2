<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import type { StepResult, TestStep } from '../types'

const store = useTestStore()
const failureReason = ref('模拟 3G 占用后，S2 信号未立即关闭，联锁日志出现 126ms 延迟')
const evidence = ref('录屏 VID-021、联锁日志 LG-144、CS-LEU-09 设备快照')

const activeExec = computed(() => store.selectedActiveExecution)
const selectableSteps = computed(() => store.selectedCase?.steps ?? [])
const dupStep = ref<TestStep>()
const staleStep = ref<TestStep>()

function passStep(step: TestStep) {
  store.reportStepResult({
    caseId: store.selectedCase!.id, stepId: step.id, result: '通过',
    actual: '预期结果一致，证据已归档', evidence: `RT-${step.id}-PASS`,
  })
}
function failStep(step: TestStep) {
  if (!failureReason.value.trim()) return
  store.reportStepResult({
    caseId: store.selectedCase!.id, stepId: step.id, result: '失败',
    actual: failureReason.value, evidence: evidence.value,
  })
}
function sendDuplicate() {
  if (!dupStep.value) return
  const current = store.selectedCase?.steps.find((s) => s.id === dupStep.value!.id)
  if (current && (current.state === '通过' || current.state === '失败')) {
    store.rerunStep(store.selectedCase!.id, current.id)
  }
  store.injectDuplicateReport(store.selectedCase!.steps.find((s) => s.id === dupStep.value!.id)!, '失败')
}
function sendStale() {
  if (staleStep.value) store.injectStaleReport(staleStep.value, '通过')
}

const credTagType: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  '有效': 'success', '续跑中': 'success', '已交班': 'warning', '已过期': 'error',
}
const stateTagType: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
  '通过': 'success', '失败': 'error', '未执行': 'info', '挂起': 'warning',
  '续跑中': 'info', '失效': 'warning',
}
function canReport(step: TestStep) {
  return step.state === '续跑中' || step.state === '未执行'
}
function ledgerOf(step: TestStep) {
  return store.ledger.find((entry) => entry.executionId === step.executionId && entry.stepId === step.id)
}
</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">交接台账 · 幂等上报 · 证据</p>
      <h1>回归执行与交接班</h1>
      <p>步骤、执行记录、发布基线共用同一份交接记录；挂起步骤交班或凭证过期后才能续跑，同一请求号只收一次。</p>
    </div>
    <n-space>
      <n-radio-group :value="store.currentOperator" size="small" @update:value="store.switchOperator">
        <n-radio-button v-for="name in store.operatorOptions" :key="name" :value="name">{{ name }}</n-radio-button>
      </n-radio-group>
    </n-space>
  </section>

  <n-alert :type="store.connection === '在线' ? 'success' : 'warning'" :title="store.liveMessage" style="margin-bottom:16px" />

  <div class="execution-grid">
    <article class="card">
      <div class="panel-head">
        <div>
          <h2>{{ store.selectedCase?.id }} 执行面板</h2>
          <p>{{ store.selectedCase?.name }} · 进行中执行号：{{ activeExec?.id ?? '无（点顶部“开始执行”）' }}</p>
        </div>
        <n-space>
          <n-tag :type="store.connection === '在线' ? 'success' : 'warning'">{{ store.connection }}</n-tag>
          <n-tag v-if="activeExec" type="info">交接链 {{ activeExec.operators.join(' → ') }}</n-tag>
        </n-space>
      </div>

      <div class="handoff-actions">
        <n-button size="small" @click="store.simulateDisconnect">① 现场断网（挂起未完成步骤）</n-button>
        <n-button size="small" type="warning" :disabled="!activeExec" @click="store.handOver(activeExec?.id)">② 原执行人交班给李峥</n-button>
        <n-button size="small" type="error" :disabled="!activeExec" @click="store.expireCredential(activeExec?.id)">③ 原凭证过期</n-button>
        <n-button size="small" type="primary" :disabled="!activeExec" @click="store.takeOver(activeExec?.id)">④ 当前操作员接手续跑</n-button>
        <n-button size="small" @click="store.retry">回网同步（不解除挂起）</n-button>
      </div>

      <n-progress type="line" :percentage="store.progress" :height="10" style="margin:12px 0" />

      <div v-for="step in store.selectedCase?.steps" :key="step.id" class="execute-step" :class="step.state">
        <div class="step-line">
          <b>{{ step.id }} · {{ step.action }}</b>
          <small>预期：{{ step.expected }}</small>
          <small v-if="step.dependency">依赖步骤：{{ step.dependency }}</small>
          <small v-if="step.actual">实测：{{ step.actual }}</small>
          <small v-if="step.retainedResult" class="retained">
            依赖改动后失效留证：{{ step.retainedResult }} · {{ step.retainedEvidence }}（原 {{ step.retainedExecutionId }}）
          </small>
        </div>
        <div class="step-side">
          <n-tag :type="stateTagType[step.state]">{{ step.state }}</n-tag>
          <small class="meta">执行号 {{ step.executionId ?? '—' }}</small>
          <small class="meta">交接人 {{ step.operator ?? '—' }}</small>
          <n-tag v-if="ledgerOf(step)" size="small" :type="credTagType[ledgerOf(step)!.credentialStatus]">
            凭证{{ ledgerOf(step)!.credentialStatus }}
          </n-tag>
          <small v-if="ledgerOf(step)?.seenRequestIds.length" class="meta">
            已收请求 {{ ledgerOf(step)!.seenRequestIds.length }} 次
          </small>
          <n-space v-if="canReport(step)" size="small">
            <n-button size="tiny" type="success" @click="passStep(step)">记录通过</n-button>
            <n-button size="tiny" type="error" @click="failStep(step)">记录失败</n-button>
          </n-space>
          <n-button v-else-if="step.state === '通过' || step.state === '失败' || step.state === '失效'" size="tiny" @click="store.rerunStep(store.selectedCase!.id, step.id)">
            新执行号重测
          </n-button>
        </div>
      </div>

      <n-form label-placement="top" style="margin-top:12px">
        <n-form-item label="失败原因与设备快照"><n-input v-model:value="failureReason" type="textarea" :rows="2" /></n-form-item>
        <n-form-item label="证据附件（多个用顿号分隔，须与执行记录证据清单一致）"><n-input v-model:value="evidence" /></n-form-item>
      </n-form>
    </article>

    <aside class="card">
      <div class="panel-head"><div><h2>上报演练（同执行号幂等）</h2><p>旧端断网缓存回网补传</p></div></div>
      <div class="rehearse">
        <div class="rehearse-row">
          <n-select v-model:value="dupStep" size="small" :options="selectableSteps.map((s) => ({ label:`${s.id} 重复请求号`, value:s }))" placeholder="选择步骤" />
          <n-button size="small" type="warning" :disabled="!dupStep" @click="sendDuplicate">同一请求号连发两次</n-button>
        </div>
        <small class="meta">首次落台账，第二次按请求号幂等拒收（步骤须处于可上报状态）。</small>
        <div class="rehearse-row">
          <n-select v-model:value="staleStep" size="small" :options="selectableSteps.map((s) => ({ label:`${s.id} 旧执行号晚到`, value:s }))" placeholder="选择步骤" />
          <n-button size="small" type="error" :disabled="!staleStep" @click="sendStale">旧执行号晚到结果</n-button>
        </div>
        <small class="meta">需先用顶部“开始执行当前用例”开新执行号跑出进度；旧结果不覆盖，只留复核。</small>
      </div>

      <n-divider />
      <div class="panel-head"><div><h2>未决复核（{{ store.openReviews.length }}）</h2><p>晚到旧结果 / 重复上报 / 失效留证，发布前必须闭环</p></div></div>
      <div v-for="review in store.openReviews" :key="review.id" class="review-item">
        <div>
          <b>{{ review.reason }} · {{ review.stepId }}</b>
          <small class="meta">{{ review.requestId }} · 执行号 {{ review.executionId }} · {{ review.operator }} · {{ review.receivedAt }}</small>
          <small class="meta">{{ review.note ?? `上报结果：${review.payload}${review.evidence ? ' · ' + review.evidence : ''}` }}</small>
        </div>
        <n-button size="tiny" @click="store.dismissReview(review.id)">复核作废关闭</n-button>
      </div>
      <n-empty v-if="!store.openReviews.length" description="无未决复核项" size="small" style="padding:10px 0" />

      <n-divider />
      <div class="panel-head"><div><h2>上报流水</h2><p>同一执行号 + 请求号全程留痕</p></div></div>
      <n-timeline>
        <n-timeline-item
          v-for="log in store.reports" :key="log.requestId + log.at"
          :type="log.outcome === '已接收' ? 'success' : log.outcome === '重复拒收' ? 'default' : 'warning'"
          :title="`${log.outcome} · ${log.stepId} · ${log.result}`"
          :content="`${log.executionId} / ${log.requestId} / ${log.channel} / ${log.operator}\n${log.detail}`"
          :time="log.at"
        />
      </n-timeline>
      <n-empty v-if="!store.reports.length" description="暂无上报流水" size="small" />
    </aside>

    <aside class="card">
      <div class="panel-head"><div><h2>执行历史（交接链不可覆盖）</h2><p>失败与重测保留原执行号</p></div></div>
      <n-timeline>
        <n-timeline-item
          v-for="record in store.executions" :key="record.id"
          :type="record.result === '通过' ? 'success' : record.result === '失败' ? 'error' : 'info'"
          :title="`${record.caseId} · ${record.result}`"
          :content="`${record.id} · ${record.operators.join(' → ')} ${record.startedAt}${record.finishedAt ? ' → ' + record.finishedAt : ''}\n${record.snapshot}\n证据：${record.evidence.join('、') || '采集中'}`"
        />
      </n-timeline>
    </aside>
  </div>
</template>
