# 字体资源维护

本项目使用浏览器内的单机 SDK。服务器 `fc-cache` 或挂载 DocumentServer 系统字体目录不会补齐这里的 `/fonts/<编号>` 请求。

`public/sdkjs/common/AllFonts.js` 是当前 SDK 的固定字体索引，`public/fonts/` 保存按三位编号命名的网络字体。SDK 会对网络字体的前 32 字节执行固定 XOR，还原 TTF/TTC；原始字体不能直接重命名放入此目录。`scripts/fonts.mjs` 实现相同的可逆编码，并验证字体头、集合和表目录边界。它只导入索引中已有、目标尚不存在的文件，按文件名忽略大小写匹配，不覆盖已有字体或修改 SDK 索引。

## 已补齐的资源

在原有 16 个资源基础上，补入本机 `microsoft-cjk` 目录中 20 个匹配字体，以及网上固定版本的 14 个英文字体，共 50 个资源。包括微软雅黑三种字重、宋体、黑体、楷体、仿宋、等线三种字重、隶书、幼圆、多种华文字体和方正舒体/姚体，以及 Arial、Calibri 六种字形、Cambria 四个文件（含 Math 集合）和 Times New Roman 四种字形。并非完整覆盖 SDK 登记的 341 个文件。

网上补充的 14 个原件来自 `taveevut/Windows-10-Fonts-Default`，固定 commit `33c53b34c725dbaf3d85c047456268c458a1df80`；URL、原件大小、SHA-256、实际字体族保存在 `config/font-downloads.json`。本地补充的原件来自维护者已有字体目录。下载来源、编码或摘要校验不构成字体授权；这些商业字体的 Web 分发权限须按实际授权核实，不能当作开源字体。

## 常用命令

```sh
# 在项目根目录运行；源目录使用可用于部署的原始 TTF/TTC 文件。
pnpm fonts:import --source /path/to/fonts

# 从固定的 HTTPS 来源重新下载并校验 14 个英文字体；仅导入缺失项。
pnpm fonts:download

# 离线校验已入库资源与必需字体。
pnpm fonts:check

# 校验通过后构建；Docker 的 pnpm build 沿用同一检查。
pnpm build
```

导入后更新 `config/font-resources.json`，记录所有已打包编号、文件名、编码后的大小和摘要，不记录本机绝对路径。`config/fonts.json` 定义必需字体；缺失的 Calibri/Cambria/Times 也会阻止正式构建。下载脚本限定固定 GitHub commit、大小和摘要，超时或校验失败拒绝导入，临时原件随后清理；不执行下载内容，也不在构建或运行时联网补字体。

导入检查验证结构与完整性，不自动证明字体版本与 SDK 字宽、字形覆盖、TTC face 索引完全一致。新增或替换版本还应核对原件的字体族/字形、SDK 的集合索引及真实文档排版。未知字体不应强行占用已有编号；需使用配套工具重新生成索引和资源，并验证三个编辑器。

## 部署验证

Vite 自动将 `public/fonts/` 复制到 `html/fonts/`，Docker 再打包全部静态产物；无需额外 Nginx 字体接口。字体索引与资源内容已参与编辑器资产版本计算。字体路径仍保留 SDK 的固定编号，因此发布时须清理 CDN 的 `/fonts/*` 缓存，尤其是此前缓存的 404；索引发生变更还需清理 `/sdkjs/common/AllFonts.js` 及其 gzip 变体。不能仅靠 iframe 的版本参数消除字体 URL 的旧缓存。

先验证 `/fonts/287`、`/fonts/288`、`/fonts/229`、`/fonts/235`、`/fonts/327` 返回 HTTP 200，且响应字节与资源清单相符；随后重新打开原 PPT，检查第 11 页等白页及字体换行，并确认控制台不再出现这些字体请求失败。补字体不等于已验证白页修复，原文件兼容性和连续预览重绘问题仍须在真实部署中回归。
