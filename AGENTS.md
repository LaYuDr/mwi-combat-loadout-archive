# 项目边界

- 当前功能是游戏原生配装下的场景子方案、手动切换指引及生活/战斗项目的配装选择记忆；不恢复旧模拟器业务。
- 独立游戏网页用户脚本，和强化助手无关；匹配 milkywayidle.com 与 milkywayidlecn.com 的 /game 路径（含 www），不再匹配模拟器。
- 业务代码与构建工具放在 source/，通过 npm run build 生成 deliverables/ 安装包；不要手改生成包。
- source/app.js 为入口；子方案只读原生配装 React 状态，不调用游戏操作函数、不自动点击、不发送游戏请求。行动配装记忆允许观察行动详情的选择更新，并仅通过 setState 恢复 selectedCharacterLoadoutId，不调用开始、排队或装备函数。子方案保存到独立 IndexedDB，切换仅展示差异和高亮，玩家手动修改原生配装。
- 开发加载器仅从 127.0.0.1:4178 读取本地代码，保留现有安装路径与本地服务协议。
- 清空业务实现不意味着清除浏览器里的旧数据；没有单独授权时不得清理、迁移或覆盖已有存档。
- 验证：npm run check；涉及加载器、存储、桥接或交互时运行 npm run test:browser（本机 Chrome 需沙箱外批准）。
- 浏览器测试采用独立临时配置及合成数据，不得宣称已验证用户真实游戏。
- 新生成文件后，从工作区根目录运行布局检查器；只修复本次新增的问题。
- 发布采用 npm run release:dry-run → npm run release → npm run release:verify；只显式暂存白名单。普通 build/dev 不写历史归档，releases/ 历史包不可覆盖。
- 本地重建不自动授权对外发布；版本号及历史项目标识暂时沿用，正式发布时由发布流程递增版本。
