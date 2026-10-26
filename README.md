# MWI 战斗模拟器配装档案助手

独立的 Tampermonkey 用户脚本，只在 MWI Combat Simulator 网站运行，与强化助手无关。

- 安装包：[deliverables/mwi_combat_loadout_archive.user.js](deliverables/mwi_combat_loadout_archive.user.js)
- [从 Greasy Fork 安装正式版](https://greasyfork.org/zh-CN/scripts/602254)
- 本地验证结果与截图位于 `preview/`，不随公开仓库分发；旧流程交付记录保留作历史参考。

v0.2.0 整合原生配置存档与主页内嵌布局。[Greasy Fork 602254](https://greasyfork.org/zh-CN/scripts/602254) 提供正式安装及自动更新，[GitHub](https://github.com/LaYuDr/mwi-combat-loadout-archive) 保存源码与不可变历史包。

## 使用

正式版从 Greasy Fork 安装，也可在 Tampermonkey 中导入本地安装包。开发时使用下方本地加载器。刷新前先保存网页中的未保存调整。
打开模拟器主页，在原有配置区下方直接使用“配装档案”完整内容区：

1. 选择“单人”或“整队”；单人另选来源玩家，按需填写名称，点击“保存网页当前配置”。助手调用网页原生导出，保存包含 `simulationSettings` 的完整 JSON。保存新建快照，不覆盖旧配装；同名同内容不重复添加。
2. 从列表选择档案。单人选择目标玩家后点击“导入到网页”，会替换指定玩家并按原生规则恢复包内模拟设置，保留其他玩家配装。整队点击“导入整队配置”，核对玩家及模拟设置的替换范围，再明确确认。
3. “导入档案文件”支持网页现代单人、整队 JSON 及本助手新旧备份。校验后还需点击“添加到档案库”；添加本身不修改网页配置，整队文件保存为一份档案。
4. 可改名、下载单份原生 JSON、备份全部有效档案、移入回收站并恢复；“备份全部”不包含回收站。清除网站数据或跨镜像迁移前先备份。

旧库及 schema 1 档案仍可读取，不自动改写；旧档案通过网页原生单人入口恢复，但只包含当时导入的内容，不包含其后的手动修改，缺失字段须在网页中核对。

超时、手动打断或网页出现额外弹窗时，助手停止后续步骤并提供“下载网页原有输入备份”。网页的异步操作可能仍在运行，请先下载备份并核对网页状态，避免重复导入；助手不会把备份文本写回仍可能运行的原生表单。

本助手不再监听主站一键导入消息，不访问游戏页面或读取 Vue 私有状态。游戏取数仍由网站配套工具负责；恢复已保存档案不需要游戏在线。

## 开发

Node.js 20 及以上，无构建和运行时依赖，无需 npm install。

```sh
npm run check
```

浏览器验收另外需要 Playwright 和 Chrome：

```sh
MWI_ARCHIVE_PLAYWRIGHT=/绝对路径/node_modules/playwright npm run test:browser
# 加上真实网站验证（仍然只用合成数据）：
MWI_ARCHIVE_LIVE=1 MWI_ARCHIVE_PLAYWRIGHT=/绝对路径/node_modules/playwright npm run test:browser
```

macOS 从 Codex 启动浏览器时须通过工具批准沙箱外执行。使用独立临时配置并正常关闭；不连接个人 Chrome。
可通过 `MWI_ARCHIVE_CHROME` 指定 Chrome 可执行文件，默认使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。
浏览器验证脚本仅以页面注入方式测试安装包，不等于已经在用户的 Tampermonkey 中安装验收。
本地原生流程验证结果见 `preview/native_browser_results.json`，覆盖范围以当次生成的记录为准。真实网站测试使用独立临时配置与合成数据，不代表用户个人配置或真实游戏验收。

## 结构与接口

- `source/archive_core.js`：旧版载荷白名单、内容标识与兼容处理。
- `source/native_document.js`：现代单人/整队原生 JSON 结构校验、原文保留、新旧备份兼容。
- `source/native_adapter.js`：通过可见原生控件导出与导入、单人槽位选择、整队确认约束及异常输入备份。
- `source/archive_store.js`：独立 IndexedDB `mwi-loadout-archive`，原子事务与同名同内容去重；沿用数据库版本，保留旧记录。
- `source/archive_app.js`、`archive.css`：Shadow DOM 内嵌内容区，原生表单及状态播报；随主页一起滚动，路由切换时重新挂载。
- `source/build.cjs`：生成安装包与 SHA-256，无在线依赖。
- `source/tests/`：合成夹具、单元测试与隔离浏览器验收。

运行包不再包含 `source/archive_bridge.js` 的消息自动归档链路；旧模块及测试保留作兼容参考。
只操作网页可见原生导入/导出控件；控件缺失、歧义或网页结构变化时停止并报告，需要适配后再试。正式脚本不调用游戏接口或新增网络请求；网页原生导出自己的异步刷新遵循网页行为。

## 上游依据

2026-10-26 核对网站 V3.2.1 的原生导入/导出；旧流程曾核对配套导入脚本 0.1.49。
项目独立实现，不打包上游源码、图像或游戏数据。

- [HomePage 原生导入/导出入口](https://github.com/azhu949/MWICombatSimulator/blob/main/src/ui/pages/HomePage.vue)
- [兼容格式参考](https://github.com/azhu949/MWICombatSimulator/blob/main/src/services/importExportMapper.js)

发布与同步状态以 `npm run release:verify` 的当次结果为准。开发加载器曾于 2026-10-26 在个人 Chrome 中安装并验证入口及空档案面板；重做与发布过程中不刷新用户个人模拟器，不能视作新流程已在个人配置中验收。

## 本地开发加载器

```sh
node ../银河奶牛本地开发服务/source/control.mjs start loadout
```

安装 `http://127.0.0.1:4178/mwi_combat_loadout_archive.dev.user.js`，刷新模拟器即可读取最新源码。服务由 launchd 登录启动并在进程退出后重启，只监听本机。正式版与开发版请选择一个启用。

源码由 `source/build.cjs` 同时构建正式包、更新元数据、开发加载器和 runtime；请求入口时重新构建，无缓存，构建失败返回 503。`npm run dev` 可用于前台调试，须先停止后台同名服务。服务脚本改动后运行 `node ../银河奶牛本地开发服务/source/control.mjs restart loadout`。

[发布流程](docs/RELEASING.md)与公会助手一致：演练、完整检查、不可变归档、显式白名单提交推送、GitHub 与 Greasy Fork 核验。开发加载器仅从本机读取代码，正式运行时不发出网络请求。

## 自动更新

正式包的 `@updateURL` 指向 GF `.meta.js`，`@downloadURL` 指向 GF `.user.js`。Tampermonkey 根据设备上的更新检查和自动安装设置更新；已有网页需刷新才执行新代码。此脚本不设置自己的定时检查器。

开发加载器不走 GF 更新渠道；本地服务运行时，每次刷新模拟器都重新构建并读取当前源码。
