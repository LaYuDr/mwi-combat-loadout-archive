# 项目边界

- 独立的网站用户脚本，和强化助手无关。只匹配模拟器的两个正式地址，不匹配游戏。
- 只改 source/，通过 npm run build 生成 deliverables/ 的安装包。
- 通过公开的 mwi-tm-bridge 消息协议导入，不读取 Vue 私有状态、不调用游戏接口、正式运行时不发出网络请求；开发加载器仅从 127.0.0.1:4178 读取本地代码。
- IndexedDB 独立存档；不写网站原生存档，不自动清理、永久删除或覆盖命名配装。
- 载入只替换指定槽位，禁止 clearOtherPlayers、clearPlayerIds 和 resetTeamSelection。
- 保存的数据必须通过字段白名单；保留空槽、显式零、缺失与空映射的差异。
- 验证：npm run check；涉及存储、桥接或交互时运行 npm run test:browser（本机 Chrome 需沙箱外批准）。
- 浏览器测试采用独立临时配置及合成数据，不得宣称已验证用户真实游戏。
- 新生成文件后，从工作区根目录运行布局检查器；只修复本次新增的问题。

- 发布采用 `npm run release:dry-run` → `npm run release` → `npm run release:verify`；只显式暂存白名单。普通 build/dev 不写历史归档，历史包不可覆盖。
