<template>
    <div class="editor-container" v-loaing="loading" element-loading-text="Loading...">
        <div id="iframe"></div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, ref, watchEffect, watch } from 'vue'
import { getDocumentType, DocmentType } from '@/utils/util'
import { g_sEmpty_bin } from '@/utils/empty_bin'
// @ts-ignore
import {
    initX2TScript,
    initX2T,
    convertDocument,
    convertBinToDocumentAndDownload,
    convertBinOnly,
    c_oAscFileType2,
} from '@/utils/x2t'
const X2T = ref(null)
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
        if (!original || replacement == null) return
        replaceTextInEditor(original, replacement)
    }
}

onMounted(async () => {
    window.addEventListener('message', handleExternalMessage)
    loading.value = true
    try {
        await initX2TScript()
        // 加载编辑器API
        await loadEditorApi()
        await initX2T()
        console.log('app has loading')
        loading.value = false
        // 页面初始化后，使用 watchEffect 监听 props.file 并执行 openFile
        // 添加props.file监听

        const stopWatch = watch(
            () => props.file.fileName,
            async () => {
                try {
                    await openFile()
                } catch (error) {
                    console.error('Error opening file:', error)
                    alert('文件打开失败，请检查文件格式')
                }
            },
            { immediate: true }, // 立即执行一次以处理初始值
        )

        // 组件卸载时停止监听
        onBeforeUnmount(stopWatch)
    } catch (error) {
        console.error('Failed to initialize editor:', error)
        // 错误已在各函数中处理
    }
})
// 合并后的文件操作方法
async function handleDocumentOperation(options: { isNew: boolean; fileName: string; file?: File }) {
    try {
        const { isNew, fileName, file } = options
        const fileType = fileName.split('.').pop() || ''
        const docType = getDocumentType(fileType)

        // 获取文档内容
        let documentData: {
            bin: ArrayBuffer
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

        // 创建编辑器实例
        createEditorInstance({
            fileName,
            fileType,
            binData: documentData.bin,
            media: documentData.media,
        })
    } catch (error: any) {
        console.error('文档操作失败:', error)
        alert(`文档操作失败: ${error.message}`)
        throw error
    }
}

// 公共编辑器创建方法
function createEditorInstance(config: {
    fileName: string
    fileType: string
    binData: ArrayBuffer
    media?: any
}) {
    // 清理旧编辑器实例
    if (editor.value) {
        editor.value.destroyEditor()
        editor.value = null
    }

    const { fileName, fileType, binData, media } = config

    // PPT 文件默认隐藏左侧缩略图面板（仅首次，之后尊重用户偏好）
    const pptTypes = ['ppt', 'pptx', 'odp', 'pot', 'potx', 'pptm', 'ppsx', 'pps']
    if (pptTypes.includes(fileType.toLowerCase()) && localStorage.getItem('pe-hidden-leftmenu') === null) {
        localStorage.setItem('pe-hidden-leftmenu', 'true')
    }

    editor.value = new window.DocsAPI.DocEditor('iframe', {
        document: {
            title: fileName,
            url: fileName, // 使用文件名作为标识
            fileType: fileType,
            permissions: {
                edit: true,
                chat: false,
                protect: false,
            },
        },
        editorConfig: {
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
                console.log('文档加载完成:', fileName)
            },
            onSave: handleSaveDocument,
            // writeFile
            // todo writeFile 当外部粘贴图片时候处理
            writeFile: handleWriteFile,
        },
    })
}

// 修改后的openFile方法
async function openFile() {
    const { fileName, file } = props.file

    await handleDocumentOperation({
        isNew: !file, // 根据是否存在file判断是否新建
        fileName,
        file,
    })
}

onBeforeUnmount(() => {
    // 清理资源
    if (editor.value) {
        // 如果编辑器有销毁方法，调用它
        if (typeof editor.value.destroyEditor === 'function') {
            editor.value.destroyEditor()
        }
    }
})

function loadEditorApi(): Promise<void> {
    return new Promise((resolve, reject) => {
        // 检查是否已加载
        if (window.DocsAPI) {
            resolve()
            return
        }

        // 加载编辑器API
        const script = document.createElement('script')
        script.src = './web-apps/apps/api/documents/api.js'
        script.onload = () => resolve()
        script.onerror = (error) => {
            console.error('Failed to load OnlyOffice API:', error)
            alert('无法加载编辑器组件。请确保已正确安装 OnlyOffice API。')
            reject(error)
        }
        document.head.appendChild(script)
    })
}

interface SaveEvent {
    data: {
        data: string
        option: any
    }
}

async function handleSaveDocument(event: SaveEvent) {
    if (!event.data?.data) {
        editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 0 } })
        return
    }

    const { data, option } = event.data
    const targetExt: string = c_oAscFileType2[option.outputformat] ?? 'DOCX'
    const saveUrl: string | undefined = props.file.saveUrl

    try {
        if (saveUrl) {
            // ── 有 saveUrl：转换后回写服务器，不触发浏览器下载 ──
            const { fileName, data: fileBytes } = await convertBinOnly(data.data, props.file.fileName, targetExt)
            const blob = new Blob([fileBytes], { type: 'application/octet-stream' })
            const formData = new FormData()
            formData.append('file', new File([blob], fileName), fileName)

            const res = await fetch(saveUrl, { method: 'POST', body: formData })
            if (!res.ok) throw new Error(`服务器响应 ${res.status}`)

            console.log('[Save] 已回写服务器:', saveUrl)
        } else {
            // ── 无 saveUrl：原有本地下载逻辑 ──
            await convertBinToDocumentAndDownload(data.data, props.file.fileName, targetExt)
        }
    } catch (err: any) {
        console.error('[Save] 保存失败:', err?.message ?? err)
        // 即使出错也告知编辑器"已处理"，避免编辑器卡在等待状态
    }

    editor.value.sendCommand({ command: 'asc_onSaveCallback', data: { err_code: 0 } })
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
                    error: error.message,
                },
            })
        }

        if (event.callback && typeof event.callback === 'function') {
            event.callback({
                success: false,
                error: error.message,
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
        }
    }
})
</script>

<style scoped>
.editor-container {
    width: 100%;
    height: 100vh;
}

#iframe {
    width: 100%;
    height: 100%;
}
</style>

