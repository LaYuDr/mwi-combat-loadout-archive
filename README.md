# MWI 战斗模拟器配装档案助手

独立的 Tampermonkey 用户脚本，只在 MWI Combat Simulator 网站运行，与强化助手无关。

- 安装包：[deliverables/mwi_combat_loadout_archive.user.js](deliverables/mwi_combat_loadout_archive.user.js)
- [使用说明](deliverables/配装档案助手_使用说明_20261026_v01.md)
- [验证记录](deliverables/配装档案助手_验证记录_20261026_v01.md)
- [真实网站合成数据截图](preview/archive_live_site.png)

## 使用

正式版：[从 Greasy Fork 安装](https://greasyfork.org/zh-CN/scripts/602254)。源码：[GitHub](https://github.com/LaYuDr/mwi-combat-loadout-archive)。也可在 Tampermonkey 中导入安装包并刷新模拟器。
右下角出现“配装档案”按钮。主站一键导入成功后自动归档；也可导入网站导出的现代单人 JSON。

自动采集需要另外安装网站原有的
[主站一键导入脚本](https://github.com/azhu949/MWICombatSimulator/blob/main/scripts/mwi-main-site-import.user.js)。
本助手不替代游戏端采集，不访问游戏页面。恢复已保存的档案不需要游戏在线。

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

## 结构与接口

- `source/archive_core.js`：三种载荷白名单、SHA-256 内容标识、备份格式、恢复消息。
- `source/archive_store.js`：独立 IndexedDB `mwi-loadout-archive`，原子事务、跨标签页旧快照保护。
- `source/archive_bridge.js`：同源消息关联，只在成功回执后归档，拒绝超时、错误来源和未关联回执。
- `source/archive_app.js`、`archive.css`：Shadow DOM 面板，原生表单及状态播报。
- `source/build.cjs`：生成安装包与 SHA-256，无在线依赖。
- `source/tests/`：合成夹具、单元测试与隔离浏览器验收。

只使用网站公开消息接口，不使用 Vue 私有状态。网站更改接口后，需要适配；失败不会被误报为保存成功。

## 上游依据

2026-10-26 核对网站 V3.2.1 及配套导入脚本 0.1.49。
项目独立实现，不打包上游源码、图像或游戏数据。

- [HomePage 消息接口](https://github.com/azhu949/MWICombatSimulator/blob/main/src/ui/pages/HomePage.vue)
- [导入协议应用逻辑](https://github.com/azhu949/MWICombatSimulator/blob/main/src/services/tampermonkeyImportBridge.js)
- [兼容格式参考](https://github.com/azhu949/MWICombatSimulator/blob/main/src/services/importExportMapper.js)

发布与同步状态以 `npm run release:verify` 的当次结果为准。开发版已于 2026-10-26 在个人 Chrome 中安装，并验证模拟器入口及空档案面板；这不代表已验证真实游戏取数。

## 本地开发加载器

```sh
node ../银河奶牛本地开发服务/source/control.mjs start loadout
```

安装 `http://127.0.0.1:4178/mwi_combat_loadout_archive.dev.user.js`，刷新模拟器即可读取最新源码。服务由 launchd 登录启动并在进程退出后重启，只监听本机。正式版与开发版请选择一个启用。

源码由 `source/build.cjs` 同时构建正式包、更新元数据、开发加载器和 runtime；请求入口时重新构建，无缓存，构建失败返回 503。`npm run dev` 可用于前台调试，须先停止后台同名服务。服务脚本改动后运行 `node ../银河奶牛本地开发服务/source/control.mjs restart loadout`。

[发布流程](docs/RELEASING.md)与公会助手一致：演练、完整检查、不可变归档、显式白名单提交推送、GitHub 与 Greasy Fork 核验。开发加载器仅从本机读取代码，正式运行时不发出网络请求。
