# office-web-local

基于only-office的纯本地项目，支持本地`打开、编辑`office文档

[live-demo🪄](https://sweetwisdom.github.io/onlyoffice-web-local/)


[English](README.md) | [中文](readme.zh.md)


基于 OnlyOffice 的本地网页文档编辑器，让您直接在浏览器中编辑文档，无需服务器端处理，保护您的隐私安全。

## ✨ 主要特性

- 🔒 **隐私优先**: 所有文档处理都在浏览器本地进行，不上传到任何服务器
- 📝 **多格式支持**: 支持 DOCX、XLSX、PPTX 等多种文档格式
- ⚡ **实时编辑**: 提供流畅的实时文档编辑体验
- 🚀 **无需部署**: 纯前端实现，无需服务器端处理
- 🎯 **即开即用**: 打开网页即可开始编辑文档



## 📄 打开远程文件

### 功能说明

通过路由参数自动下载并打开远程 Office 文件（如 `.docx`、`.pptx` 等），并将其转换为 `File` 对象供后续使用（如预览或编辑）。

### 使用方法

页面地址需包含以下参数：

* `url`（必填）：远程文件地址
* `filename`（可选）：文件名，如果未提供将尝试自动解析

示例：
[00.xlsx](https://sweetwisdom.github.io/onlyoffice-web-local/#/?url=https://sweetwisdom.github.io/react-filePreview/filePreview/00.xlsx)

```
?filename=00.pptx&url=https://example.com/files/00.pptx
```

### 文件名获取优先级

1. 路由参数 `filename`
2. 从 `url` 中解析
3. 从响应头 `Content-Disposition` 提取

若无法获取文件名，将终止操作并提示错误。



## word

![recording](./.imgs/recording.gif)

## excel

![image-20250524104950359](./.imgs/image-20250524104950359.png)

## ppt

![image-20250524105044644](./.imgs/image-20250524105044644.png)



## 导出文档

![image-20250524104854846](./.imgs/image-20250524104854846.png)

## 开发支持

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

## Docker 支持

自定义镜像名为 vue-local-office 的镜像（请注意下面命令末尾有一个点 . 表示使用当前路径下的 Dockerfile 文件，可根据实际情况指定路径）

docker build -t vue-local-office .

端口映射并启动 docker 容器（8080:80：表示在容器中使用 80 端口，并将该端口转发到主机的 8080 端口；local-office：表示自定义容器名；vue-local-office：表示自定义镜像名）

docker run -dp 8080:80 --name local-office vue-local-office

操作完上面两个命令后，在浏览器打开 http://localhost:8080 即可预览

## 技术原理

使用x2t-wam替代onlyofice服务

使用only-office websdk  实现编辑(来自se-office)

## 参考

[Qihoo360/se-office: se-office扩展，提供基于开放标准的全功能办公生产力套件，基于浏览器预览和编辑office。](https://github.com/Qihoo360/se-office)

[cryptpad/onlyoffice-x2t-wasm: CryptPad WebAssembly file conversion tool](https://github.com/cryptpad/onlyoffice-x2t-wasm)



## MantisBot PPT 自动批注定位

由 MantisBot 在 URL hash 传入 reviewId、reviewKey、reviewOrigin 后，本服务启用只读选区桥。它只接受来自绑定顶层 origin/窗口的固定读取与订阅消息，不接收任意脚本或写入操作，不改变 mode/saveurl 的权限语义。

连续预览中单击页面会同步页码，双击或按回车进入原生单页后可选择具体组件。SDK 回报对象类型、选中文字及可用的几何位置，坐标明确使用 mm；多选降级到整页。读取通过公开 SDK getter 与 asc_onCurrentPage/asc_onFocusObject 事件完成，不依赖混淆字段。取消订阅或卸载后停止上报。

该能力需重新构建并更新单机服务镜像；旧镜像不支持自动桥时，MantisBot 仍提供手动定位。回归检查：`node --test tests/office-review.test.cjs tests/x2t-initialization.test.cjs`；构建：`npm run build`。

批注浮窗可使用原生编辑器 pointerup 提供的有界视口百分比 anchor 就近展示；该值只供宿主 UI 使用，不进入文档定位或 Agent 修改指令。监听只在订阅期间上报，并在销毁时移除。宿主继续验证来源、随机实例 ID、文档 key 和消息顺序。未提供 anchor 的旧服务仍使用角落浮窗。

单机选区桥对同一定位快照去重，读取期间同步触发的焦点回调不会重入；140ms 使用固定截止时间，不被连续 SDK 布局通知无限推迟。连续预览与原生单页通过显式模式通知切换，预览页不受后台 SDK 焦点噪声覆盖，进入单页后恢复组件读取。
