<template>
  <div class="home">
    <!-- URL 参数加载进度条 -->
    <LoadingProgress
      :visible="urlLoading.visible"
      :stages="urlLoading.stages"
      :current-stage-index="urlLoading.stageIndex"
      :stage-progress="urlLoading.stageProgress"
      :file-name="urlLoading.fileName"
      :file-type="urlLoading.fileType"
    />

    <!-- 顶部操作区域 -->
    <div class="top-operation-bar" v-if="!docmentObj?.fileName">
      <el-button type="primary" @click="showCreateDialog = true">新建/打开文件</el-button>
    </div>
    <div class="editor-content">
      <DocumentHandler
        v-if="docmentObj?.fileName"
        style="height: 100%; width: 100%"
        :file="docmentObj"
        ref="documentHandler"
      />
      <!-- 主要内容区域 -->
      <div class="main-content" v-else>
        <section v-if="loadError.visible" class="load-error-panel" role="alert" aria-live="assertive">
          <div class="load-error-icon">!</div>
          <div class="load-error-content">
            <h1>{{ loadError.title }}</h1>
            <p>{{ loadError.message }}</p>
            <p class="load-error-detail">{{ loadError.detail }}</p>
            <el-button type="primary" @click="openCurrentPageInNewWindow">在新窗口打开</el-button>
          </div>
        </section>
        <template v-else>
          <h1>欢迎使用文档编辑器</h1>
          <p>点击顶部按钮开始创建或打开文档</p>
        </template>
      </div>
    </div>

    <!-- 使用DocumentHandler组件，通过prop传递文件 -->

    <!-- 面板转换为对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建/打开文件" width="450px" center>
      <div id="panel-createnew">
        <div class="header">新建</div>
        <div class="thumb-list">
          <div class="thumb-wrap" template="WORD" @click="onCreateNew('.docx')">
            <div class="thumb" style="background-image: url('./img/doc-formats/docx.png')"></div>
            <div class="title">文档</div>
          </div>
          <div class="thumb-wrap" template="EXCEL" @click="onCreateNew('.xlsx')">
            <div class="thumb" style="background-image: url('./img/doc-formats/xlsx.png')"></div>
            <div class="title">表格</div>
          </div>
          <div class="thumb-wrap" template="PPT" @click="onCreateNew('.pptx')">
            <div class="thumb" style="background-image: url('./img/doc-formats/pptx.png')"></div>
            <div class="title">演示文稿</div>
          </div>
        </div>
        <div class="header">打开</div>
        <div class="open-container">
          <el-button type="info" size="large" :icon="FolderOpened" @click="onOpenDocument" plain>
            打开本地文件
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { FolderOpened } from '@element-plus/icons-vue'
import { onMounted, reactive, ref } from 'vue'
import { DocmentType } from '@/utils/util'
import DocumentHandler from '../components/DocumentHandler.vue'
import LoadingProgress, { type LoadingStage } from '../components/LoadingProgress.vue'
import { useRoute } from 'vue-router'

const showCreateDialog = ref(false)
const docmentObj = ref<DocmentType | null>(null)
const loadError = reactive({
  visible: false,
  title: '',
  message: '',
  detail: '',
})

// URL 加载进度状态
const urlLoading = reactive({
  visible: false,
  stageIndex: 0,
  stageProgress: 0,
  fileName: '',
  fileType: '',
  stages: [
    { label: '下载文件', weight: 0.5 },
    { label: '解析文件', weight: 0.3 },
    { label: '打开文档', weight: 0.2 },
  ] as LoadingStage[],
})

function setStage(index: number, progress = -1) {
  urlLoading.stageIndex = index
  urlLoading.stageProgress = progress
}

function clearLoadError() {
  loadError.visible = false
  loadError.title = ''
  loadError.message = ''
  loadError.detail = ''
}

function showLoadError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  loadError.visible = true
  loadError.title = '文件加载失败'
  loadError.message = '请点击右上角在新窗口打开的按钮。'
  loadError.detail = message === 'Failed to fetch'
    ? '当前页面嵌入在 iframe 中时，浏览器可能会阻止访问本机文件服务。'
    : message
}

function openCurrentPageInNewWindow() {
  window.open(window.location.href, '_blank', 'noopener,noreferrer')
}

const onCreateNew = (ext: string) => {
  docmentObj.value = {
    fileName: '新建文档' + ext,
    file: null,
  }
  showCreateDialog.value = false
}

const onOpenDocument = async () => {
  // 创建文件选择器，选择Office文档
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.docx,.xlsx,.pptx,.doc,.xls,.ppt'

  input.onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) {
      showCreateDialog.value = false
      docmentObj.value = {
        fileName: file.name,
        file: file,
      }
    }
  }

  input.click()
}
// 页面初始化后根据路由地址获取文件 并自动打开
async function initFileUrl() {
  const route = useRoute()
  // Hash 模式下 route.query 读不到 # 之前的参数，用 window.location.search 兜底
  const searchParams = new URLSearchParams(window.location.search)
  const url = (route.query.url as string | undefined) ?? searchParams.get('url') ?? undefined
  const filenameParam = (route.query.filename as string | undefined) ?? searchParams.get('filename') ?? undefined
  const saveUrl = (route.query.saveurl as string | undefined) ?? searchParams.get('saveurl') ?? undefined
  if (!url) {
    console.warn('未提供文件 URL')
    return
  }
  clearLoadError()

  // 解析文件名和类型（提前用于显示图标）
  let earlyFileName = filenameParam || ''
  if (!earlyFileName) {
    try {
      const urlObj = new URL(url)
      const lastPart = urlObj.pathname.split('/').pop() || ''
      if (lastPart.includes('.')) earlyFileName = decodeURIComponent(lastPart)
    } catch { /* ignore */ }
  }
  const earlyExt = earlyFileName.split('.').pop() || ''
  urlLoading.fileName = earlyFileName
  urlLoading.fileType = earlyExt
  urlLoading.visible = true
  setStage(0, 0)

  try {
    // ── 阶段 0：下载文件（流式感知真实进度）──
    const res = await fetch(url)
    if (!res.ok) throw new Error('文件请求失败')

    const contentLength = res.headers.get('Content-Length')
    let blob: Blob

    if (contentLength && res.body) {
      // 有 Content-Length，使用流式读取计算真实进度
      const total = parseInt(contentLength, 10)
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        setStage(0, Math.min((received / total) * 100, 99))
      }
      blob = new Blob(chunks)
    } else {
      // 无法感知进度，用不确定动画
      setStage(0, -1)
      blob = await res.blob()
    }
    setStage(0, 100)

    // ── 解析文件名 ──
    let fileName = filenameParam || ''
    if (!fileName) {
      try {
        const urlObj = new URL(url)
        const pathParts = urlObj.pathname.split('/')
        const lastPart = pathParts[pathParts.length - 1]
        if (lastPart && lastPart.includes('.')) {
          fileName = decodeURIComponent(lastPart)
        }
        if (!fileName) {
          const pathParam =
            urlObj.searchParams.get('path') ||
            urlObj.searchParams.get('file') ||
            urlObj.searchParams.get('filename')
          if (pathParam) {
            const paramParts = pathParam.split('/')
            const paramLastPart = paramParts[paramParts.length - 1]
            if (paramLastPart && paramLastPart.includes('.')) {
              fileName = decodeURIComponent(paramLastPart)
            }
          }
        }
      } catch { /* ignore */ }
    }
    if (!fileName) {
      const disposition = res.headers.get('Content-Disposition')
      if (disposition) {
        const match = disposition.match(/filename\*=UTF-8''(.+)|filename="?([^"]+)"?/)
        if (match) fileName = decodeURIComponent(match[1] || match[2])
      }
    }
    if (!fileName) {
      console.error('无法确定文件名，拒绝打开')
      urlLoading.visible = false
      return
    }

    urlLoading.fileName = fileName
    urlLoading.fileType = fileName.split('.').pop() || ''

    // ── 阶段 1：解析文件 ──
    setStage(1, -1)
    const file = new File([blob], fileName, { type: blob.type })

    // ── 阶段 2：打开文档 ──
    setStage(2, -1)
    docmentObj.value = { fileName, file, saveUrl }
    showCreateDialog.value = false

    // 短暂延迟后关闭，让用户看到"完成"状态
    setTimeout(() => {
      urlLoading.stageProgress = 100
      setTimeout(() => { urlLoading.visible = false }, 400)
    }, 300)
  } catch (err) {
    console.error('加载文件失败:', err)
    urlLoading.visible = false
    showLoadError(err)
  }
}
onMounted(() => {
  initFileUrl()
})
</script>

<style lang="less" scoped>
.home {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f5f5;
}

.top-operation-bar {
  background-color: white;
  padding: 12px 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  z-index: 10;
}

.editor-content {
  flex-grow: 1;
}

.main-content {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;

  h1 {
    margin-bottom: 20px;
  }
}

.load-error-panel {
  width: min(680px, calc(100% - 40px));
  display: flex;
  gap: 18px;
  align-items: flex-start;
  text-align: left;
  padding: 24px;
  border: 1px solid #f3b2a5;
  border-radius: 8px;
  background: #fff7f5;
  box-shadow: 0 12px 32px rgba(154, 52, 18, 0.14);
}

.load-error-icon {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #ffffff;
  background: #d0442e;
  font-size: 22px;
  font-weight: 700;
}

.load-error-content {
  min-width: 0;

  h1 {
    margin: 0 0 10px;
    color: #8f2417;
    font-size: 24px;
    line-height: 1.3;
  }

  p {
    margin: 0 0 12px;
    color: #4d2a24;
    line-height: 1.7;
  }

  .load-error-detail {
    color: #7c5148;
    font-size: 14px;
  }
}

#panel-createnew {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  padding: 20px;
  .header {
    font-size: 18px;
    padding: 0 0 0 25px;
    white-space: nowrap;
    margin-top: 20px;
    margin-bottom: 20px;
  }

  .thumb-list {
    display: flex;
    justify-content: space-around;

    .thumb-wrap {
      display: inline-block;
      text-align: center;
      width: auto;
      cursor: pointer;
      vertical-align: top;
      border-radius: 4px;

      .thumb {
        width: 96px;
        height: 96px;
        background-repeat: no-repeat;
        background-position: center;
        margin: 12px 12px 0px 12px;
        background-size: contain;
      }

      .title {
        width: 104px;
        font-size: 14px;
        line-height: 14px;
        height: 28px;
        margin: 8px 8px 12px 8px;
        word-break: break-word;
        word-wrap: break-word;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      &:hover {
        background-color: #e0e0e0;
      }

      &:active {
        color: rgba(0, 0, 0, 0.8);
        background-color: #cbcbcb;
      }
    }
  }
}
.open-container {
  text-align: center;
  padding-bottom: 25px;
  margin-top: 20px;
}
</style>
