# 模拟器导入导出适配

核对日期：2026-11-24。适配是配装助手内的 JSON 转换，不在模拟器页面安装额外脚本，不自动向网站传送角色数据。

| 网站 | 可导入助手的文件 | 从助手导出后的入口 |
| --- | --- | --- |
| [Shykai](https://shykai.github.io/MWICombatSimulatorTest/dist/) | Solo 对象；1–5 编号角色对象，值为 JSON 字符串或对象 | Import/Export → Solo，粘贴导出文本 |
| [mwisim](https://mwisim.org/combat/setup) | `combat-party-builds` v1（方案内选角色）；现代单人/整队；含 players、rows、targets、simulationSettings 的完整模拟 JSON | 数据与基准 → 导入整队方案，选择下载的文件；生成一份包含当前导出角色的方案 |
| [MWI Combat Simulator](https://mwi-combatsi-mulator.pages.dev/#/home) | `mwi-vue-solo` v2；`mwi-vue-group` v2；单独现代角色对象 | 导入/导出 → 单人，粘贴或载入 JSON，再导入到选定玩家 |

在助手的战斗配装子方案区点击“导入”，格式自动识别。多人、多方案文件先匹配当前游戏角色昵称：唯一同名时自动选中，并提供“更换角色”；缺少昵称、没有匹配或多个同名候选时，显示角色选择。匹配去除首尾空白并规范 Unicode，区分大小写，不猜测相似昵称。每次保存一个新子方案。没有默认批量覆盖。现代组队使用数组顺序建立候选键，避免外部角色 ID 重复造成错选。

在菜单点击“导出到模拟器”，在直接展开的列表中勾选当前配装或某个子方案，再点击目标网站按钮生成内容，可复制或下载。网站按钮展示名称和域名，不使用下拉菜单或格式代号。原有“导出全部”仍是助手备份，不等于模拟器文件。

## 转换范围

- 装备、具体强化等级、五个技能槽、食物饮料、被选中技能与消耗品的触发条件。
- Shykai 四槽历史技能格式在最前补空特殊槽；兼容数组以及连续的 0/1 起始数字键对象。未提供装备视为空槽。
- 导入不保存对方等级、身份、房屋、增益、模拟结果或模拟设置，不改变助手的站点/角色/父配装作用域。
- 导出角色等级读取当前游戏角色，不能完整读取时停止导出。技能等级取当前角色已学等级，未读取到的技能按 1 级并显示提示；这不是来源玩家完整档案。
- 模拟器不能表达“使用最高强化”，导出为快照中的具体等级并提示。超过 +20 时拒绝导出，避免目标站静默截断。目标站不支持的徽章槽可能被忽略，导出时提示。
- 房屋、公会增益、成就、战斗卷轴不属于子方案快照，此次导出不还原这些状态；部分网站导入会清空或替换相关值，必须在模拟器核对后再计算。模拟设置不从助手伪造；mwisim 的 gameDataVersion 标为 `loadout-assistant`，不是声称匹配目标站游戏版本。

## 实现与依据

`source/scene_core.js`：`importChoices`、`importSolo`、`exportSimulator`。`source/app.js`：导入角色选择、导出源/目标选择、复制和下载。新功能复用现有存储和身份校验，不修改数据库或云同步协议。

格式依据：

- [Shykai 当前部署脚本](https://shykai.github.io/MWICombatSimulatorTest/dist/bundle.js)：`doSoloExport`、`doGroupExport`、`doSoloImport`、`updateNextPlayer`。
- [mwisim 当前部署脚本](https://mwisim.org/assets/index-BSRNVLzx.js)：整队方案 `schemaVersion: 1`、`kind: combat-party-builds`、builds/players/settings/gameDataVersion 的读取校验，以及完整模拟结果读取入口。该资源名会随部署变化。
- [Pages 上游格式实现](https://github.com/azhu949/MWICombatSimulator/blob/main/src/services/importExportMapper.js)：`exportGroupConfig`、`exportSoloConfig`、`importGroupConfig`、`importSoloConfig`。网页导出窗口确认现代单人和组队入口。

本次核对公开实现及网站入口，不等于生成文件已在三个网站逐一导入验收。依用户此前要求，未运行自动化或浏览器测试；未操作用户真实游戏或发布新版本。
