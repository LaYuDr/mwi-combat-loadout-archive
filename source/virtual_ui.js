(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPanel = function (React) {
    const h = React.createElement;
    class Entry extends React.Component {
      state = { selected: "", target: "", title: "", notice: "", busy: false, removing: false, expanded: false };
      async run(work) {
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "" });
        try { await work(); }
        catch (error) { if (this.alive) this.setState({ notice: error.message }); }
        finally { if (this.alive) this.setState({ busy: false }); }
      }
      componentDidMount() { this.alive = true; }
      componentWillUnmount() { this.alive = false; }
      render() {
        const { entry, owner, nativeProps, reload } = this.props;
        const { scenes, board } = entry;
        const scene = scenes.find(row => row.id === this.state.selected) || scenes[0];
        const choices = Object.values(nativeProps.characterLoadoutDict || {}).filter(raw =>
          scene && (raw.actionTypeHrid || "") === (scene.snapshot.raw.actionTypeHrid || ""));
        const raw = choices.find(row => String(row.id) === this.state.target);
        const btn = (label, click) => h("button", { type: "button", className: "mwi-overview-button",
          disabled: this.state.busy, onClick: click }, label);
        const details = scene && h("details", { onToggle: e => this.setState({ expanded: e.currentTarget.open }) },
          h("summary", null, "查看配装内容"),
          this.state.expanded && h(Snapshot, { snapshot: scene.snapshot, nativeProps }),
          h("label", null, "保存到自己的配装",
            h("select", { value: this.state.target, onChange: e => this.setState({ target: e.target.value }) },
              h("option", { value: "" }, "选择同类型的原生配装"), choices.map(row => h("option", { key: row.id, value: row.id }, row.name)))),
          h("label", null, "子方案名称", h("input", { maxLength: 60, value: this.state.title,
            placeholder: scene.name, onChange: e => this.setState({ title: e.target.value }) })),
          btn("保存为我的子方案", () => this.run(async () => {
            if (!raw) throw Error("请选择用于保存的原生配装。");
            await app.Virtual.adopt(owner, scene, raw, this.state.title.trim() || scene.name.slice(0, 60));
            if (this.alive) this.setState({ notice: "已保存为子方案，可到对应配装的详情中查看切换指引。" });
          })),
          board && btn("另存为本地虚拟配装", () => this.run(async () => {
            await app.Virtual.save(owner, scene.name.slice(0, 60), scene.snapshot); await reload();
            if (this.alive) this.setState({ notice: "已保存独立副本。" });
          })));
        return h("article", { className: "mwi-virtual-card" },
          h("h3", null, board ? "订阅 · " + board : scene?.name || "虚拟配装"),
          board && h("a", { href: "https://clipboard.im/" + board, target: "_blank", rel: "noopener noreferrer" }, "查看来源"),
          board && scenes.length === 1 && h("p", null, scene.name),
          h("p", { className: entry.error ? "mwi-cloud-warning" : "" }, entry.error ?
            "更新失败，保留上次内容 · " + entry.error : "上次读取 " + new Date(entry.checked).toLocaleString()),
          scenes.length > 1 && h("label", null, "配装内容",
            h("select", { value: scene.id, onChange: e => this.setState({ selected: e.target.value, target: "", title: "" }) },
              scenes.map(row => h("option", { key: row.id, value: row.id }, row.name)))),
          !scene && h("p", null, "来源已无可订阅的配装内容。"),
          details,
          h("div", { className: "mwi-virtual-actions" },
            board && btn("检查更新", () => this.run(async () => { await app.Virtual.refresh(owner, entry); await reload(); })),
            btn(board ? "取消订阅" : "移除虚拟配装", () => this.setState({ removing: true }))),
          this.state.removing && h("div", null,
            h("p", null, board ? "取消这项订阅并移除本机缓存？" : "移除这份本地虚拟配装？"),
            btn("确认移除", () => this.run(async () => { await app.Virtual.remove(owner, entry); await reload(); })),
            btn("保留", () => this.setState({ removing: false }))),
          h("p", { role: "status" }, this.state.notice));
      }
    }
    class Snapshot extends React.Component {
      render() {
        const { snapshot, nativeProps } = this.props, raw = snapshot.raw;
        const empty = { ...raw, wearableMap: {}, abilityMap: {}, foodItemHrids: [], drinkItemHrids: [],
          abilityCombatTriggersMap: {}, consumableCombatTriggersMap: {} };
        const changes = app.Core.diff(empty, snapshot);
        return h("dl", { className: "mwi-virtual-items" },
          h("dt", null, "强化选择"), h("dd", null, app.Adapter.describe({ props: nativeProps }, { kind: "setting" }, raw.useExactEnhancement)),
          changes.map((change, i) => h(React.Fragment, { key: i },
            h("dt", null, change.label), h("dd", null, app.Adapter.describe({ props: nativeProps }, change, change.to)))));
      }
    }
    return class VirtualPanel extends React.Component {
      state = { entries: [], input: "", notice: "", busy: false, loading: true };
      componentDidMount() {
        this.alive = true;
        this.check();
        this.timer = setInterval(() => this.check(), 30000);
      }
      componentWillUnmount() { this.alive = false; clearInterval(this.timer); }
      fail(error) { if (this.alive) this.setState({ notice: error.message, loading: false }); }
      reload = async () => {
        const entries = await app.Virtual.list(this.props.owner);
        if (this.alive) {
          const signature = JSON.stringify(entries);
          if (signature !== this.signature) {
            this.signature = signature;
            this.setState({ entries, loading: false });
          }
        }
      };
      async check() {
        if (this.checking) return;
        this.checking = true;
        try {
          const entries = await app.Virtual.list(this.props.owner);
          for (const entry of entries) {
            if (!this.alive || document.hidden || root.navigator.onLine === false) break;
            if (entry.board && Date.now() - (entry.attempted || 0) >= 300000)
              await app.Virtual.refresh(this.props.owner, entry);
          }
          await this.reload();
        } catch (error) { this.fail(error); }
        finally { this.checking = false; }
      }
      subscribe = async event => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "" });
        try {
          await app.Virtual.subscribe(this.props.owner, this.state.input);
          await this.reload();
          if (this.alive) this.setState({ input: "", notice: "已订阅，打开配装总览时每 5 分钟检查更新。" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      render() {
        return h("section", { className: "mwi-virtual-panel", "aria-label": "虚拟配装" },
          h("h2", null, "虚拟配装"),
          h("p", null, "订阅他人的当前原生配装及子方案，或在配装详情中保存一份本地虚拟配装。"),
          h("p", null, "订阅列表与虚拟配装保存在本机；订阅只读，保存为自己的子方案后可参与云同步。"),
          h("form", { onSubmit: this.subscribe },
            h("input", { "aria-label": "配装分享地址", placeholder: "粘贴配装助手的剪贴板地址", value: this.state.input,
              onChange: e => this.setState({ input: e.target.value }), required: true }),
            h("button", { type: "submit", className: "mwi-overview-button", disabled: this.state.busy }, this.state.busy ? "读取中…" : "订阅配装")),
          h("p", { role: "status" }, this.state.notice),
          this.state.loading ? h("p", null, "读取中…") :
            !this.state.entries.length && h("p", null, "暂无虚拟配装"),
          h("div", { className: "mwi-virtual-grid" }, this.state.entries.map(entry =>
            h(Entry, { key: entry.token, entry, owner: this.props.owner, nativeProps: this.props.nativeProps, reload: this.reload }))));
      }
    };
  };
})(globalThis);
