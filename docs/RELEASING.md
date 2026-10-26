# 发布流程

沿用公会助手受保护流程：dry-run 检查 main、仓库身份、空暂存区、上游状态、文件白名单；release 运行完整检查，生成不可变历史包，显式暂存、提交、推送并核验 GitHub 与 GF。

```sh
npm run release:dry-run
npm run release -- --notes "本次变更说明"
npm run release:verify
```

首次发布允许空 Git 仓库（main），沿用 package.json 版本。后续自动递增补丁，或沿用已提高的版本。普通 build 和 dev 服务均不写 releases/；历史包不允许改写。暂存时绝不使用 git add .。

GF 正式脚本 ID 为 602254，GitHub 为 LaYuDr/mwi-combat-loadout-archive。GF 从 main/deliverables/mwi_combat_loadout_archive.user.js 同步；release.config.json 统一控制更新元数据。GitHub push 不等于 GF 已同步；使用 release:verify 核验 commit、安装包、版本、正文和更新元数据，不为缓存延迟重复发布。

开发加载器、正式安装包、元数据由同一 source/build.cjs 生成；加载器请求 127.0.0.1:4178/runtime.js，每次重新构建，响应 no-store，构建失败 503。源码更新刷新模拟器生效，服务代码更新须重启 loadout 服务。

浏览器合成数据验证与个人浏览器安装验收分别记录，不公开玩家存档、预览截图和本地临时文件。
