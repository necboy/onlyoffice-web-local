<template>
  <Transition name="fade">
    <div v-if="visible" class="loading-overlay">
      <div class="loading-card">
        <!-- 文件图标 -->
        <div class="file-icon" :class="fileIconClass">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <polyline points="10 9 9 9 8 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>

        <!-- 文件名 -->
        <div v-if="fileName" class="file-name">{{ fileName }}</div>

        <!-- 进度条容器 -->
        <div class="progress-wrapper">
          <div class="progress-bar-bg">
            <div
              class="progress-bar-fill"
              :style="{ width: progress + '%' }"
              :class="{ 'indeterminate': isIndeterminate }"
            ></div>
          </div>
          <div class="progress-percent">{{ isIndeterminate ? '' : Math.round(progress) + '%' }}</div>
        </div>

        <!-- 阶段文字 -->
        <div class="stage-text">
          <span class="stage-dot"></span>
          {{ currentStageText }}
        </div>

        <!-- 阶段步骤指示器 -->
        <div class="steps">
          <div
            v-for="(step, index) in stages"
            :key="index"
            class="step"
            :class="{
              'step-done': index < currentStageIndex,
              'step-active': index === currentStageIndex,
              'step-pending': index > currentStageIndex
            }"
          >
            <div class="step-dot">
              <svg v-if="index < currentStageIndex" viewBox="0 0 10 10">
                <polyline points="2,5 4.5,7.5 8,3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="step-label">{{ step.label }}</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { computed } from 'vue'

export interface LoadingStage {
  label: string
  weight: number // 占总进度的权重（0~1，所有阶段之和为1）
}

const props = defineProps<{
  visible: boolean
  stages: LoadingStage[]
  currentStageIndex: number
  stageProgress: number // 当前阶段内的进度 0~100
  fileName?: string
  fileType?: string
}>()

// 是否显示不确定进度（某些阶段无法精确感知进度）
const isIndeterminate = computed(() => props.stageProgress < 0)

// 当前阶段文字
const currentStageText = computed(() => {
  if (props.currentStageIndex < 0 || props.currentStageIndex >= props.stages.length) return '准备中...'
  return props.stages[props.currentStageIndex]?.label ?? '处理中...'
})

// 计算总进度：已完成阶段权重 + 当前阶段部分权重
const progress = computed(() => {
  if (isIndeterminate.value) return 0
  const completedWeight = props.stages
    .slice(0, props.currentStageIndex)
    .reduce((sum, s) => sum + s.weight, 0)
  const currentWeight = (props.stages[props.currentStageIndex]?.weight ?? 0) * (props.stageProgress / 100)
  return Math.min((completedWeight + currentWeight) * 100, 99) // 最多显示99%，完成后再跳100
})

// 文件图标颜色类
const fileIconClass = computed(() => {
  const ext = props.fileType?.toLowerCase()
  if (ext === 'docx' || ext === 'doc') return 'icon-word'
  if (ext === 'xlsx' || ext === 'xls') return 'icon-excel'
  if (ext === 'pptx' || ext === 'ppt') return 'icon-ppt'
  return 'icon-default'
})
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.loading-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 36px 40px 32px;
  width: 360px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

/* 文件图标 */
.file-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.file-icon svg {
  width: 32px;
  height: 32px;
}
.icon-word   { background: #e8f0fe; color: #1a73e8; }
.icon-excel  { background: #e6f4ea; color: #1e8e3e; }
.icon-ppt    { background: #fce8e6; color: #d93025; }
.icon-default{ background: #f1f3f4; color: #5f6368; }

/* 文件名 */
.file-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a2e;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 20px;
  text-align: center;
}

/* 进度条 */
.progress-wrapper {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.progress-bar-bg {
  flex: 1;
  height: 6px;
  background: #e8eaed;
  border-radius: 100px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  border-radius: 100px;
  background: linear-gradient(90deg, #4285f4, #34a853);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.progress-bar-fill.indeterminate {
  width: 40% !important;
  animation: indeterminate-slide 1.4s ease-in-out infinite;
  background: linear-gradient(90deg, #4285f4, #34a853);
}
@keyframes indeterminate-slide {
  0%   { transform: translateX(-150%); }
  100% { transform: translateX(350%); }
}
.progress-percent {
  font-size: 12px;
  color: #80868b;
  width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 阶段文字 */
.stage-text {
  font-size: 13px;
  color: #5f6368;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 24px;
  min-height: 20px;
}
.stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4285f4;
  animation: pulse-dot 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}

/* 步骤指示器 */
.steps {
  display: flex;
  gap: 0;
  width: 100%;
  justify-content: space-between;
  position: relative;
}
.steps::before {
  content: '';
  position: absolute;
  top: 9px;
  left: 9px;
  right: 9px;
  height: 1px;
  background: #e8eaed;
  z-index: 0;
}
.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 1;
  flex: 1;
}
.step-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #e8eaed;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}
.step-dot svg {
  width: 10px;
  height: 10px;
}
.step-done .step-dot  { border-color: #34a853; background: #34a853; color: #fff; }
.step-active .step-dot { border-color: #4285f4; background: #4285f4; animation: ring-pulse 1.2s ease-in-out infinite; }
.step-pending .step-dot { border-color: #dadce0; background: #fff; }
@keyframes ring-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.4); }
  50%       { box-shadow: 0 0 0 4px rgba(66, 133, 244, 0); }
}
.step-label {
  font-size: 10px;
  color: #80868b;
  text-align: center;
  white-space: nowrap;
}
.step-done .step-label   { color: #34a853; }
.step-active .step-label { color: #4285f4; font-weight: 600; }

/* 淡入淡出动画 */
.fade-enter-active { transition: opacity 0.3s ease; }
.fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
