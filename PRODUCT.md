# 配装档案助手

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

使用 MWI Combat Simulator 及其一键导入脚本的玩家，需要保存并反复载入战斗配装。

## Product Purpose

已获用户批准：独立网站插件，复用既有导入链路，在成功导入后归档；支持具名配装、定向载入、JSON 备份。

## Stack

原生 JavaScript 用户脚本；技术实现按已批准的独立网站插件方案选择，无运行时依赖。

## Operating Context

只运行于 Cloudflare Pages 与 GitHub Pages 的模拟器正式地址。一键导入脚本负责游戏取数。
原生 JSON 文件也可导入。已有网站的灰阶工具界面作为视觉依据。

## Capabilities and Constraints

- 归档原始导入的白名单角色字段，而不是反向读取网站内部状态。
- 最近导入按角色去重更新；命名配装只有用户显式修改才更新。
- 刷新后存档仍可用，恢复档案不依赖游戏在线。
- 本地存储按域隔离，无云同步；JSON 支持跨镜像迁移。
- 不自动保存网站手动编辑，手动方案通过网站原生单人 JSON 导出后导入。
- 不恢复地图、时长、市场估值及全局迷宫升级；缺少的角色加成由网站现有导入语义处理，需提示。
- 删除放入回收站，可撤销，不提供永久清空。

## Evidence on Hand

2026-10-26 已核对在线 HomePage 导入消息、上游脚本 0.1.49 和网站 V3.2.1；验证范围见交付记录。

## Accessibility & Inclusion

原生按钮与表单、键盘操作、可见焦点、状态播报。浮层不锁定页面焦点。
