<template>
    <div class="editor-container">
        <div id="iframe"></div>
        <div v-if="loading" class="editor-loading" role="status" aria-live="polite">
            <div class="loading-spinner" aria-hidden="true"></div>
            <p>{{ loadingText }}</p>
        </div>
        <div v-if="loadError" class="editor-error" role="alert">
            <p>文档打开失败，请重试。</p>
            <el-button type="primary" @click="loadDocument">重新加载</el-button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { getDocumentType, DocmentType } from '@/utils/util'
import { g_sEmpty_bin } from '@/utils/empty_bin'
import { OFFICE_SCRIPT_TIMEOUT_MS, OFFICE_DOCUMENT_TIMEOUT_MS, OFFICE_INITIALIZING_TEXT } from '@/utils/office-loading'
import { setupPptPreview } from '@/utils/ppt-preview'
declare global {
    interface Window {
        DocsAPI?: { DocEditor: new (id: string, config: Record<string, any>) => any }
    }
}
// @ts-ignore
import {
    initX2T,
    convertDocument,
    convertBinToDocumentAndDownload,
    convertBinOnly,
    c_oAscFileType2,
} from '@/utils/x2t'
const emit = defineEmits<{
    loading: [message: string]
    ready: []
    error: [error: Error]
}>()
const loadError = ref(false)
const loadingText = ref(OFFICE_INITIALIZING_TEXT)
function setLoadingText(message: string) {
    loadingText.value = message
    emit('loading', message)
}
let disposed = false
let generation = 0
let readyTimer: ReturnType<typeof setTimeout> | undefined
let stopWatch: (() => void) | undefined
let cleanupPptPreview: (() => void) | undefined
function failOpen(error: unknown) {
    clearTimeout(readyTimer)
    generation++ // Ignore late ready/error callbacks from this failed editor.
    loading.value = false
    loadError.value = true
    console.error('Failed to open editor:', error)
    emit('error', error instanceof Error ? error : new Error(String(error)))
}
// 设置prop
const props = defineProps<{
    file: DocmentType
}>()

const editor = ref<any>(null)
const loading = ref(false)

// 全局 media 映射对象
const media: { [key: string]: string } = {}

// ── 父窗口 postMessage 通信：定位文档内文字 ──────────────

function navigateToText(text: string) {
    // DocsAPI 会把 div#iframe 直接替换为 <iframe name="frameEditor">（不是嵌套关系）
    const innerFrame = document.querySelector('iframe[name="frameEditor"]') as HTMLIFrameElement | null
    if (!innerFrame?.contentDocument || !innerFrame?.contentWindow) return

    const innerDoc = innerFrame.contentDocument
    const win = innerFrame.contentWindow as any

    // 判断左侧搜索面板是否已打开
    const leftPanel = innerDoc.querySelector('#left-panel-search') as HTMLElement | null
    const isPanelVisible = leftPanel ? leftPanel.offsetParent !== null : false

    const doSearch = () => {
        const input = innerDoc.querySelector('#search-adv-text input') as HTMLInputElement | null
        if (!input) return
        input.focus()
        // 用 native setter 绕过 Backbone 的 value 拦截，确保 input 事件能触发搜索
        const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set
        nativeSetter?.call(input, text)
        input.dispatchEvent(new win.Event('input', { bubbles: true }))
    }

    if (isPanelVisible) {
        doSearch()
    } else {
        // 点击左侧搜索按钮打开面板，再执行搜索
        const searchBtn = innerDoc.querySelector('#left-btn-searchbar') as HTMLElement | null
        if (searchBtn) {
            searchBtn.click()
            setTimeout(doSearch, 350)
        } else {
            doSearch()
        }
    }
}

function replaceTextInEditor(original: string, replacement: string) {
    const innerFrame = document.querySelector('iframe[name="frameEditor"]') as HTMLIFrameElement | null
    if (!innerFrame?.contentDocument || !innerFrame?.contentWindow) return

    const innerDoc = innerFrame.contentDocument
    const win = innerFrame.contentWindow as any
    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set

    /** 把值写入替换输入框（用两种方式确保写入） */
    const writeReplaceValue = () => {
        const replaceInput = innerDoc.querySelector<HTMLInputElement>('#search-adv-replace-text input')
        if (!replaceInput) return
        nativeSetter?.call(replaceInput, replacement)
        // 备用：直接赋属性（以防 native setter 被重写）
        if (replaceInput.value !== replacement) replaceInput.value = replacement
    }

    /** 强制显示替换区域 */
    const showReplaceSection = () => {
        innerDoc.querySelectorAll<HTMLElement>('.edit-setting').forEach(el => {
            el.style.removeProperty('display')
        })
    }

    /**
     * 等搜索防抖完成后点击「全部替换」，最多重试 maxTry 次（每次 200ms）
     * 每次点击前都重写替换值，以防值被清空
     */
    const attemptClick = (triesLeft: number) => {
        showReplaceSection()
        writeReplaceValue()

        const btn = innerDoc.querySelector<HTMLElement>('#search-adv-replace-all')
        if (!btn) return

        const isDisabled = btn.hasAttribute('disabled') || btn.classList.contains('disabled')
        if (!isDisabled) {
            btn.click()
        } else if (triesLeft > 0) {
            setTimeout(() => attemptClick(triesLeft - 1), 200)
        }
    }

    const doReplace = () => {
        showReplaceSection()

        // 同时写入搜索值和替换值，再触发搜索
        const searchInput = innerDoc.querySelector<HTMLInputElement>('#search-adv-text input')
        if (!searchInput) return
        searchInput.focus()
        nativeSetter?.call(searchInput, original)

        // 先写替换值（在搜索防抖期间写入，防止后续被覆盖）
        writeReplaceValue()

        // 触发搜索（onInputSearchChange 有 400ms 防抖）
        searchInput.dispatchEvent(new win.Event('input', { bubbles: true }))

        // 等待防抖 400ms + 100ms 余量后开始尝试点击（最多重试 4 次）
        setTimeout(() => attemptClick(4), 520)
    }

    const leftPanel = innerDoc.querySelector<HTMLElement>('#left-panel-search')
    const isPanelVisible = leftPanel ? leftPanel.offsetParent !== null : false

    if (isPanelVisible) {
        doReplace()
    } else {
        const searchBtn = innerDoc.querySelector<HTMLElement>('#left-btn-searchbar')
        if (searchBtn) {
            searchBtn.click()
            setTimeout(doReplace, 400)
        }
    }
}

function handleExternalMessage(event: MessageEvent) {
    const { type, text, original, replacement } = (event.data ?? {}) as Record<string, string>
    if (type === 'EDITOR_NAVIGATE_TEXT') {
        if (!text?.trim()) return
        navigateToText(text.trim())
    } else if (type === 'EDITOR_REPLACE_TEXT') {
        if (props.file.mode === 'view') return
        if (!original || replacement == null) return
        replaceTextInEditor(original, replacement)
    }
}

async function loadDocument() {
    cleanupPptPreview?.()
    cleanupPptPreview = undefined
    const request = ++generation
    clearTimeout(readyTimer)
    loading.value = true
    loadError.value = false
    setLoadingText(OFFICE_INITIALIZING_TEXT)
    try {
        // Start listening for WASM readiness immediately, independently of the API request.
        await Promise.all([initX2T(), loadEditorApi()])
        if (disposed || request !== generation) return
        setLoadingText('正在解析文件…')
        await openFile(request)
    } catch (error) {
        if (!disposed && request === generation) failOpen(error)
    }
}
onMounted(() => {
    window.addEventListener('message', handleExternalMessage)
    stopWatch = watch(() => props.file, loadDocument, { immediate: true })
})
onBeforeUnmount(() => {
    cleanupPptPreview?.()
    disposed = true
    generation++
    clearTimeout(readyTimer)
    stopWatch?.()
})
// 合并后的文件操作方法
async function handleDocumentOperation(options: { isNew: boolean; fileName: string; file?: File | null }, request: number) {
    try {
        const { isNew, fileName, file } = options
        const fileType = fileName.split('.').pop() || ''
        const docType = getDocumentType(fileType)

        // 获取文档内容
        let documentData: {
            bin: string | Uint8Array | ArrayBuffer
            media?: any
        }

        if (isNew) {
            // 新建文档使用空模板
            const emptyBin = g_sEmpty_bin[`.${fileType}`]
            if (!emptyBin) {
                throw new Error(`不支持的文件类型: ${fileType}`)
            }
            documentData = { bin: emptyBin }
        } else {
            // 打开现有文档需要转换
            if (!file) throw new Error('无效的文件对象')
            documentData = await convertDocument(file)
        }

        if (disposed || request !== generation) return
        // 创建编辑器实例
        createEditorInstance({
            fileName,
            fileType,
            binData: documentData.bin,
            media: documentData.media,
        }, request)
    } catch (error: any) {
        console.error('文档操作失败:', error)
        throw error
    }
}

// 公共编辑器创建方法
function createEditorInstance(config: {
    fileName: string
    fileType: string
    binData: string | Uint8Array | ArrayBuffer
    media?: any
}, request: number) {
    // 清理旧编辑器实例
    if (editor.value) {
        editor.value.destroyEditor()
        editor.value = null
    }

    const { fileName, fileType, binData, media } = config
    const editable = props.file.mode !== 'view'

    // 首次采用紧凑布局，后续尊重用户主动调整的工具栏与右侧面板偏好。
    const pptTypes = ['ppt', 'pptx', 'odp', 'pot', 'potx', 'pptm', 'ppsx', 'pps']
    if (pptTypes.includes(fileType.toLowerCase()) && !localStorage.getItem('mantis-ppt-layout-defaults-v1')) {
        localStorage.setItem('pe-hidden-leftmenu', 'false')
        localStorage.setItem('pe-hidden-rightmenu', 'true')
        localStorage.setItem('pe-compact-toolbar', 'true')
        localStorage.setItem('mantis-ppt-layout-defaults-v1', 'true')
    }

    setLoadingText('正在打开文档…')
    readyTimer = setTimeout(() => {
        if (!disposed && request === generation) failOpen(new Error('文档加载超时'))
    }, OFFICE_DOCUMENT_TIMEOUT_MS)
    editor.value = new window.DocsAPI!.DocEditor('iframe', {
        document: {
            title: fileName,
            url: fileName, // 使用文件名作为标识
            fileType: fileType,
            permissions: {
                edit: editable,
                chat: false,
                protect: false,
            },
        },
        editorConfig: {
            assetVersion: import.meta.env.VITE_OFFICE_ASSET_VERSION,
            mode: editable ? 'edit' : 'view',
            lang: 'zh',
            customization: {
                help: false,
                about: false,
                hideRightMenu: true,
                zoom: -2, // -2 = fit page width (自适应宽度)
                autosave: false,  // 禁用自动保存，避免反复触发 onSave 重置修改状态
                forcesave: false,
                features: {
                    spellcheck: {
                        change: false,
                    },
                },
                anonymous: {
                    request: false,
                    label: 'Guest',
                },
            },
        },
        events: {
            onAppReady: () => {
                if (disposed || request !== generation) return
                // 设置媒体资源
                if (media) {
                    editor.value.sendCommand({
                        command: 'asc_setImageUrls',
                        data: { urls: media },
                    })
                }

                // 加载文档内容
                editor.value.sendCommand({
                    command: 'asc_openDocument',
                    data: { buf: binData },
                })
            },
            onDocumentReady: () => {
                if (disposed || request !== generation) return
                clearTimeout(readyTimer)
                if (pptTypes.includes(fileType.toLowerCase())) {
                    const frame = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]')
                    if (frame) {
                        try { cleanupPptPreview = setupPptPreview(frame, editable) }
                        catch (error) { console.warn('连续预览不可用，保留单页编辑器:', error) }
                    }
                }
                loading.value = false
                emit('ready')
                console.log('文档加载完成:', fileName)
            },
            onError: () => {
                if (!disposed && request === generation) failOpen(new Error('编辑器加载失败'))
            },
            onSave: handleSaveDocument,
            // writeFile
            // todo writeFile 当外部粘贴图片时候处理
            writeFile: handleWriteFile,
        },
    })
}

// 修改后的openFile方法
async function openFile(request: number) {
    const { fileName, file } = props.file

    await handleDocumentOperation({
        isNew: !file, // 根据是否存在file判断是否新建
        fileName,
        file,
    }, request)
}

let editorApiPromise: Promise<void> | null = null
function loadEditorApi(): Promise<void> {
    if (window.DocsAPI) return Promise.resolve()
    if (editorApiPromise) return editorApiPromise
    editorApiPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = `./web-apps/apps/api/documents/api.js?v=${import.meta.env.VITE_OFFICE_ASSET_VERSION}`
        const fail = () => {
            clearTimeout(timer)
            script.onload = script.onerror = null
            script.remove()
            reject(new Error('无法加载编辑器组件，请重试'))
        }
        const timer = setTimeout(fail, OFFICE_SCRIPT_TIMEOUT_MS)
        script.onload = () => {
            clearTimeout(timer)
            if (window.DocsAPI) resolve()
            else fail()
        }
        script.onerror = fail
        document.head.appendChild(script)
    }).finally(() => { editorApiPromise = null })
    return editorApiPromise
}

interface SaveEvent {
    data: {
        data: { data: Uint8Array }
        option: any
    }
}

async function handleSaveDocument(event: SaveEvent) {
    if (props.file.mode === 'view') {
        ElMessage({ type: 'warning', message: '当前为只读预览，请先点击编辑文件', duration: 3000 })
        editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 1 } })
        return
    }
    if (!event.data?.data) {
        editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 0 } })
        return
    }

    const { data, option } = event.data
    const targetExt: string = c_oAscFileType2[option.outputformat] ?? 'DOCX'
    const saveUrl: string | undefined = props.file.saveUrl

    const notifySave = (status: 'saving' | 'saved' | 'error') => {
        if (saveUrl && window.parent !== window) {
            window.parent.postMessage({ type: 'mantis-office-save-status', status }, '*')
        }
    }
    notifySave('saving')
    try {
        if (saveUrl) {
            // ── 有 saveUrl：转换后回写服务器，不触发浏览器下载 ──
            const { fileName, data: fileBytes } = await convertBinOnly(data.data, props.file.fileName, targetExt)
            const blob = new Blob([fileBytes], { type: 'application/octet-stream' })
            const formData = new FormData()
            formData.append('file', new File([blob], fileName), fileName)

            const res = await fetch(saveUrl, { method: 'POST', body: formData })
            if (!res.ok) throw new Error(`服务器响应 ${res.status}`)

            console.log('[Save] 已回写服务器')
            ElMessage({ type: 'success', message: '文件已保存', duration: 2000 })
        } else {
            // ── 无 saveUrl：原有本地下载逻辑 ──
            await convertBinToDocumentAndDownload(data.data, props.file.fileName, targetExt)
            ElMessage({ type: 'info', message: '文件已导出到本地，未回写服务器', duration: 3000 })
        }
        editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 0 } })
        notifySave('saved')
    } catch (err: any) {
        notifySave('error')
        const msg = err?.message ?? String(err)
        console.error('[Save] 保存失败:', msg)
        ElMessage({ type: 'error', message: `保存失败：${msg}`, duration: 4000 })
        editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 1 } })
    }
}

// 辅助函数：将base64转为Blob
function dataURItoBlob(dataURI: string): Blob {
    // 从base64字符串中提取数据部分
    const byteString = atob(dataURI.split(',')[1])

    // 创建ArrayBuffer
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)

    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
    }

    return new Blob([ab])
}

/**
 * 处理文件写入请求（主要用于处理粘贴的图片）
 * @param event - OnlyOffice 编辑器的文件写入事件
 */
function handleWriteFile(event: any) {
    try {
        console.log('Write file event:', event)

        const { data: eventData } = event
        if (!eventData) {
            console.warn('No data provided in writeFile event')
            return
        }

        const {
            data: imageData, // Uint8Array 图片数据
            file: fileName, // 文件名，如 "display8image-174799443357-0.png"
            target, // 目标对象，包含 frameOrigin 等信息
        } = eventData

        // 验证数据
        if (!imageData || !(imageData instanceof Uint8Array)) {
            throw new Error('Invalid image data: expected Uint8Array')
        }

        if (!fileName || typeof fileName !== 'string') {
            throw new Error('Invalid file name')
        }

        // 从文件名中提取扩展名
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'png'
        const mimeType = getMimeTypeFromExtension(fileExtension)

        // 创建 Blob 对象
        const blob = new Blob([imageData], { type: mimeType })

        // 创建对象 URL
        const objectUrl = URL.createObjectURL(blob)
        // 将图片设置为base64url
        //  const base64Url = `data:${mimeType};base64,${btoa(String.fromCharCode(...imageData))}`;
        // 将图片URL添加到媒体映射中，使用原始文件名作为key
        media[`media/${fileName}`] = objectUrl
        editor.value.sendCommand({
            command: 'asc_setImageUrls',
            data: {
                urls: media,
            },
        })

        editor.value.sendCommand({
            command: 'asc_writeFileCallback',
            data: {
                // 图片base64
                path: objectUrl,
                imgName: fileName,
            },
        })
        console.log(`Successfully processed image: ${fileName}, URL: ${media}`)
    } catch (error) {
        console.error('Error handling writeFile:', error)

        // 通知编辑器文件处理失败
        if (editor.value && typeof editor.value.sendCommand === 'function') {
            editor.value.sendCommand({
                command: 'asc_writeFileCallback',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                },
            })
        }

        if (event.callback && typeof event.callback === 'function') {
            event.callback({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

/**
 * 根据文件扩展名获取 MIME 类型
 * @param extension - 文件扩展名
 * @returns string - MIME 类型
 */
function getMimeTypeFromExtension(extension: string): string {
    const mimeMap: { [key: string]: string } = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        tiff: 'image/tiff',
        tif: 'image/tiff',
    }

    return mimeMap[extension?.toLowerCase()] || 'image/png'
}

// 组件卸载时清理对象 URL
onBeforeUnmount(() => {
    window.removeEventListener('message', handleExternalMessage)
    // 清理媒体资源的对象 URL
    Object.values(media).forEach((url) => {
        if (typeof url === 'string' && url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
        }
    })

    // 清理编辑器资源
    if (editor.value) {
        if (typeof editor.value.destroyEditor === 'function') {
            editor.value.destroyEditor()
            editor.value = null
        }
    }
})
</script>

<style scoped>
.editor-container {
    width: 100%;
    height: 100vh;
    position: relative;
}

#iframe {
    width: 100%;
    height: 100%;
}
</style>

<style scoped>
.editor-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; background: #f8fafc; color: #334155; text-align: center; z-index: 10; }
.loading-spinner { width: 36px; height: 36px; border: 4px solid #dbeafe; border-top-color: #2563eb; border-radius: 50%; animation: preview-spin 1s linear infinite; }
@keyframes preview-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading-spinner { animation: none; } }
.editor-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: white; z-index: 10; }
</style>
