(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  function formatTime(ts) {
    const date = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  app.makeVirtualPanel = function (React, NativePreview) {
    const h = React.createElement;
    const VirtualEditor = app.makeVirtualEditor(React);
    function downloadShare(scene) {
      const url = URL.createObjectURL(new Blob([app.VirtualDraft.share(scene)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = scene.name.replace(/[\\/:*?"<>|]/g, "_") + ".json";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    class Entry extends React.Component {
      state = {
        selected: "", target: "", title: "", notice: "", noticeError: false, copied: false,
        busy: false, removing: false, expanded: true, adoptOpen: false, menuOpen: false, shareText: ""
      };
      async run(work) {
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try { await work(); }
        catch (error) { if (this.alive) this.setState({ notice: error.message, noticeError: true }); }
        finally { if (this.alive) this.setState({ busy: false }); }
      }
      flashNotice(notice, noticeError = false) {
        clearTimeout(this.noticeTimer);
        if (!this.alive) return;
        this.setState({ notice, noticeError });
        if (notice && !noticeError) {
          this.noticeTimer = setTimeout(() => {
            if (this.alive && this.state.notice === notice) this.setState({ notice: "" });
          }, 2800);
        }
      }
      componentDidMount() { this.alive = true; }
      componentWillUnmount() { this.alive = false; clearTimeout(this.copyTimer); clearTimeout(this.noticeTimer); }
      componentDidUpdate(previous) {
        if (this.state.shareText && previous.entry !== this.props.entry) this.setState({ shareText: "" });
      }
      render() {
        const { entry, owner, nativeProps, nativeIcons, reload } = this.props;
        const { scenes, board } = entry;
        const scene = scenes.find(row => row.id === this.state.selected) || scenes[0];
        const choices = Object.values(nativeProps.characterLoadoutDict || {}).filter(raw =>
          scene && (raw.actionTypeHrid || "") === (scene.snapshot.raw.actionTypeHrid || ""));
        const resolvedTarget = this.state.target && choices.some(row => String(row.id) === this.state.target)
          ? this.state.target
          : choices.length === 1 ? String(choices[0].id) : "";
        const raw = choices.find(row => String(row.id) === resolvedTarget);
        const btn = (label, click, extra = "") => h("button", {
          type: "button",
          className: "mwi-overview-button" + (extra ? " " + extra : ""),
          disabled: this.state.busy,
          onClick: click
        }, label);

        const nativeScene = scenes.find(row => row.native);
        const title = nativeScene ? nativeScene.snapshot.raw.name : scene ? scene.name : "虚拟配装";
        const chipLabel = row => row.native ? "当前配装" : row.name;

        const adoptSubmit = event => {
          event?.preventDefault?.();
          this.run(async () => {
            if (!raw) throw Error("请选择要保存到的原生配装。");
            const fallbackName = (scene.native ? scene.snapshot.raw.name : scene.name).slice(0, 60);
            await app.Virtual.adopt(owner, scene, raw, this.state.title.trim() || fallbackName);
            if (this.alive) {
              this.setState({ adoptOpen: false, title: "" });
              this.flashNotice(`已保存到「${raw.name}」的子方案`);
            }
          });
        };

        const adoptDrawer = this.state.adoptOpen && scene && h("div", { className: "mwi-virtual-drawer" },
          !choices.length
            ? h("p", { className: "mwi-cloud-warning mwi-virtual-hint" }, "当前角色没有同类型的原生配装。")
            : h("form", { className: "mwi-virtual-adopt-form", onSubmit: adoptSubmit },
                h("div", { className: "mwi-virtual-adopt-fields" },
                  h("select", {
                    "aria-label": "保存到哪个原生配装",
                    value: resolvedTarget,
                    onChange: e => this.setState({ target: e.target.value })
                  },
                    choices.length > 1 && h("option", { value: "" }, "选择同类型原生配装…"),
                    choices.map(row => h("option", { key: row.id, value: row.id }, row.name))),
                  h("input", {
                    "aria-label": "子方案名称",
                    maxLength: 60,
                    value: this.state.title,
                    placeholder: scene.native ? scene.snapshot.raw.name : scene.name,
                    onChange: e => this.setState({ title: e.target.value })
                  })),
                h("div", { className: "mwi-virtual-actions" },
                  btn("取消", () => this.setState({ adoptOpen: false, notice: "" }), "mwi-overview-ghost-btn"),
                  h("button", {
                    type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: this.state.busy
                  }, "保存为子方案"))));

        const menuDrawer = (this.state.menuOpen || this.state.removing) && h("div", { className: "mwi-virtual-drawer" },
          h("div", { className: "mwi-virtual-meta-row" },
            h("span", { className: "mwi-virtual-meta", title: "上次读取：" + new Date(entry.checked).toLocaleString() },
              (board ? "同步于 " : "保存于 ") + formatTime(entry.checked)),
            board && h("a", {
              href: "https://clipboard.im/" + board, target: "_blank", rel: "noopener noreferrer",
              className: "mwi-virtual-link"
            }, "来源剪贴板")),
          !this.state.removing
            ? h("div", { className: "mwi-virtual-actions" },
                scene && btn("分享", () => this.setState({
                  expanded: true, menuOpen: false, adoptOpen: false, shareText: app.VirtualDraft.share(scene), notice: ""
                })),
                board && btn("检查更新", () => this.run(async () => {
                  await app.Virtual.refresh(owner, entry);
                  await reload();
                  if (this.alive) this.setState({ menuOpen: false });
                })),
                board && scene && btn("另存为本地副本", () => this.run(async () => {
                  const copyName = (scene.native ? scene.snapshot.raw.name : scene.name).slice(0, 60);
                  await app.Virtual.save(owner, copyName, scene.snapshot);
                  await reload();
                  if (this.alive) {
                    this.setState({ menuOpen: false });
                    this.flashNotice("已存为本地副本");
                  }
                })),
                btn(board ? "取消订阅" : "移除", () => this.setState({ removing: true }), "mwi-overview-danger-ghost"))
            : h("div", { className: "mwi-virtual-confirm" },
                h("span", null, board ? "取消订阅并移除缓存？" : "移除这份虚拟配装？"),
                h("div", { className: "mwi-virtual-actions" },
                  btn("保留", () => this.setState({ removing: false })),
                  btn("确认移除", () => this.run(async () => {
                    const removed = await app.Virtual.remove(owner, entry);
                    if (removed) this.props.onRemoved?.(removed, title);
                    await reload();
                  }), "mwi-overview-danger"))));

        const shareDrawer = this.state.shareText && h("div", { className: "mwi-virtual-drawer mwi-virtual-share" },
          h("div", { className: "mwi-virtual-drawer-head" },
            h("span", { className: "mwi-virtual-drawer-title" }, "分享虚拟配装"),
            h("button", {
              type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn",
              "aria-label": "关闭分享", title: "关闭", onClick: () => this.setState({ shareText: "" })
            }, "×")),
          h("textarea", {
            readOnly: true, rows: 3, value: this.state.shareText,
            "aria-label": "虚拟配装分享内容", onFocus: e => e.target.select()
          }),
          h("div", { className: "mwi-virtual-actions" },
            btn("下载 JSON", () => downloadShare(scene), "mwi-overview-ghost-btn"),
            btn(this.state.copied ? "已复制" : "复制内容", () => this.run(async () => {
              try {
                await navigator.clipboard.writeText(this.state.shareText);
                if (this.alive) {
                  clearTimeout(this.copyTimer);
                  this.setState({ copied: true });
                  this.copyTimer = setTimeout(() => { if (this.alive) this.setState({ copied: false }); }, 1800);
                }
              } catch (_) { throw Error("无法复制，请选中上方内容手动复制，或下载文件。"); }
            }), "mwi-overview-primary mwi-overview-copy-btn" + (this.state.copied ? " is-copied" : ""))));

        const sceneSwitcher = scenes.length > 1 && (scenes.length <= 5
          ? h("div", { className: "mwi-virtual-pills", role: "group", "aria-label": "切换配装内容" },
              scenes.map(row => h("button", {
                key: row.id,
                type: "button",
                className: "mwi-virtual-pill" + (row.id === scene.id ? " is-active" : ""),
                "aria-pressed": row.id === scene.id,
                title: row.name,
                onClick: () => this.setState({ selected: row.id, target: "", title: "", notice: "", shareText: "" })
              }, chipLabel(row))))
          : h("div", { className: "mwi-virtual-select-row" },
              h("select", {
                "aria-label": "切换配装内容",
                value: scene.id,
                onChange: e => this.setState({ selected: e.target.value, target: "", title: "", notice: "", shareText: "" })
              }, scenes.map(row => h("option", { key: row.id, value: row.id }, row.name)))));

        return h("article", {
          className: "mwi-virtual-card mwi-overview-card" +
            ((this.state.adoptOpen || this.state.menuOpen || this.state.shareText) ? " mwi-overview-card-active" : "") +
            (!this.state.expanded ? " mwi-overview-card-collapsed" : ""),
          onKeyDown: e => {
            if (e.key !== "Escape") return;
            if (this.state.removing) { e.stopPropagation(); this.setState({ removing: false }); }
            else if (this.state.adoptOpen || this.state.menuOpen || this.state.shareText) {
              e.stopPropagation();
              this.setState({ adoptOpen: false, menuOpen: false, shareText: "", notice: "" });
            }
          }
        },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null,
              h("button", {
                type: "button",
                className: "mwi-overview-fold",
                "aria-expanded": this.state.expanded,
                onClick: () => this.setState({ expanded: !this.state.expanded })
              },
                h("svg", {
                  className: "mwi-overview-chevron" + (this.state.expanded ? " is-open" : ""),
                  width: 12, height: 12, viewBox: "0 0 16 16",
                  fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round",
                  "aria-hidden": true
                }, h("path", { d: "M6 4l4 4-4 4" })),
                nativeIcons?.[scene?.snapshot.raw.actionTypeHrid || ""],
                h("span", { className: "mwi-overview-name" }, title),
                (entry.error || board) && h("span", {
                  className: "mwi-virtual-tag" + (entry.error ? " mwi-cloud-warning" : "")
                }, entry.error ? "缓存" : "订阅"))),
            h("div", { className: "mwi-overview-card-actions" },
              scene && !board && btn("编辑", () => this.props.onEdit(entry, scene), "mwi-overview-scenes-btn"),
              scene && h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-scenes-btn" + (this.state.adoptOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": this.state.adoptOpen,
                onClick: () => this.setState({
                  expanded: true, adoptOpen: !this.state.adoptOpen, menuOpen: false, shareText: "", removing: false, notice: ""
                })
              }, "存为子方案"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn" + (this.state.menuOpen ? " mwi-overview-scenes-active" : ""),
                "aria-label": "更多操作",
                title: "更多操作",
                "aria-expanded": this.state.menuOpen,
                onClick: () => this.setState({
                  expanded: true, menuOpen: !this.state.menuOpen, adoptOpen: false, shareText: "", removing: false
                })
              }, "⋯"))),
          this.state.expanded && h("div", { className: "mwi-virtual-body" },
            entry.error && h("div", { className: "mwi-virtual-error" },
              h("span", null, "更新失败：" + entry.error),
              board && btn("重试", () => this.run(async () => { await app.Virtual.refresh(owner, entry); await reload(); }))),
            sceneSwitcher,
            adoptDrawer,
            menuDrawer,
            shareDrawer,
            this.state.notice && h("p", {
              role: "status",
              className: "mwi-virtual-notice" + (this.state.noticeError ? " mwi-cloud-warning" : "")
            }, this.state.notice),
            scene
              ? h(Snapshot, { snapshot: scene.snapshot, nativeProps, getCatalog: this.props.getCatalog })
              : h("p", { className: "mwi-virtual-empty" }, "来源暂无可显示的配装内容。")));
      }
    }

    class Snapshot extends React.Component {
      render() {
        const { snapshot, nativeProps, getCatalog } = this.props, raw = snapshot.raw;
        const activeFlags = [
          ["默认", Boolean(raw.isDefault)],
          ["缺失不提醒", Boolean(raw.suppressValidation)],
          ["最高强化", !raw.useExactEnhancement]
        ].filter(([, on]) => on);
        return h("div", null,
          activeFlags.length > 0 && h("div", { className: "mwi-virtual-options", "aria-label": "配装选项（只读）" },
            activeFlags.map(([label]) => h("span", {
              key: label,
              className: "mwi-virtual-flag is-on",
              "aria-label": `${label}：已启用`
            }, "✓ " + label))),
          NativePreview ? h(NativePreview, { snapshot, nativeProps, getCatalog }) : h("p", { className: "mwi-virtual-empty" }, "图标预览暂不可用，请刷新游戏后重试。"));
      }
    }

    return class VirtualPanel extends React.Component {
      state = {
        entries: [], input: "", notice: "", noticeError: false, exported: false, busy: false, loading: true,
        subscribeOpen: false, editor: null, importOpen: false, importText: "",
        draft: null, undo: null
      };
      componentDidMount() {
        this.alive = true;
        const draft = app.VirtualDraft?.readDraft?.(this.props.owner) || null;
        if (draft) this.setState({ draft });
        this.unwatch = app.Virtual.watch?.(() => this.reload());
        this.check();
        this.timer = setInterval(() => this.check(), 30000);
      }
      componentWillUnmount() {
        this.alive = false;
        this.unwatch?.();
        clearInterval(this.timer);
        clearTimeout(this.exportTimer);
        clearTimeout(this.noticeTimer);
        app.VirtualTooltip?.hide?.();
      }
      flashNotice(notice, noticeError = false) {
        clearTimeout(this.noticeTimer);
        if (!this.alive) return;
        this.setState({ notice, noticeError });
        if (notice && !noticeError) {
          this.noticeTimer = setTimeout(() => {
            if (this.alive && this.state.notice === notice) this.setState({ notice: "" });
          }, 3000);
        }
      }
      fail(error) { if (this.alive) this.setState({ notice: error.message, noticeError: true, loading: false }); }
      reload = async () => {
        const entries = await app.Virtual.list(this.props.owner);
        if (this.alive) {
          this.props.onCountChange?.(entries.length);
          const signature = JSON.stringify(entries);
          if (signature !== this.signature) {
            this.signature = signature;
            this.setState({ entries, loading: false });
          } else if (this.state.loading) {
            this.setState({ loading: false });
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
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          await app.Virtual.subscribe(this.props.owner, this.state.input);
          await this.reload();
          if (this.alive) this.setState({ input: "", subscribeOpen: false, notice: "" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      edit = (entry = null, scene = null, draft = null) => {
        if (this.state.editor) {
          this.setState({ notice: "请先保存或取消当前编辑。", noticeError: true });
          this.editorTop?.scrollIntoView({ block: "nearest" });
          return;
        }
        try {
          this.setState({
            editor: { entry, scene, draft, catalog: this.props.getCatalog() },
            notice: "", noticeError: false, importOpen: false, subscribeOpen: false
          });
        } catch (error) { this.fail(error); }
      };
      resumeDraft = () => {
        const draft = this.state.draft;
        if (!draft) return;
        const matched = draft.entryKey && this.state.entries.find(row =>
          !row.board && row.key === draft.entryKey && row.token === draft.entryToken);
        this.edit(matched || null, matched?.scenes?.[0] || null, draft);
      };
      discardDraft = () => {
        app.VirtualDraft?.clearDraft?.(this.props.owner);
        this.setState({ draft: null });
      };
      persistDraft = payload => {
        const editor = this.state.editor;
        app.VirtualDraft?.saveDraft?.(this.props.owner, {
          ...payload,
          entryKey: editor?.entry?.key || editor?.draft?.entryKey || null,
          entryToken: editor?.entry?.token || editor?.draft?.entryToken || null
        });
      };
      cancelEditor = () => {
        app.VirtualDraft?.clearDraft?.(this.props.owner);
        this.setState({ editor: null, draft: null });
      };
      saveDraft = async (title, snapshot, asNew = false) => {
        const { owner } = this.props, editor = this.state.editor;
        if (app.Adapter.cloudContext(false)?.character !== owner) throw Error("角色已变化，请重新打开配装总览。");
        if (editor.entry && !asNew) await app.Virtual.update(owner, editor.entry, title, snapshot);
        else await app.Virtual.save(owner, title, snapshot);
        app.VirtualDraft?.clearDraft?.(owner);
        if (this.alive) this.setState({ editor: null, draft: null, notice: "", noticeError: false });
        await this.reload();
      };
      handleRemoved = (entry, title) => {
        if (this.alive) this.setState({ undo: { entry, title }, notice: "", noticeError: false });
      };
      restoreRemoved = async () => {
        const undo = this.state.undo;
        if (!undo || this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          await app.Virtual.restore(this.props.owner, undo.entry);
          await this.reload();
          if (this.alive) this.setState({ undo: null, notice: "" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      exportAll = () => {
        try {
          const text = app.Virtual.exportBackup(this.state.entries);
          const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `虚拟配装备份-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          clearTimeout(this.exportTimer);
          this.setState({ exported: true });
          this.exportTimer = setTimeout(() => { if (this.alive) this.setState({ exported: false }); }, 1800);
        } catch (error) { this.fail(error); }
      };
      importShare = async event => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          if (app.Adapter.cloudContext(false)?.character !== this.props.owner) throw Error("角色已变化，请重新打开配装总览。");
          const text = this.state.importText;
          let parsedJson = null;
          try { parsedJson = JSON.parse(text); } catch (_) { /* Validated below. */ }
          if (parsedJson?.format === "mwi-layu-loadout-scenes")
            throw Error("这是子方案备份，请在对应配装卡片的「子方案 → ⋯ → 导入备份」中导入。");
          if (parsedJson?.format === "mwi-vue-solo")
            throw Error("这是战斗模拟器配装，请在战斗配装卡片的「子方案 → 导入」中导入。");
          if (parsedJson?.format === "mwi-virtual-loadouts-backup") {
            const { added, skipped } = await app.Virtual.importBackup(this.props.owner, text);
            await this.reload();
            if (this.alive) {
              this.setState({ importOpen: false, importText: "" });
              this.flashNotice(added ? `已导入 ${added} 项虚拟配装${skipped ? `（跳过 ${skipped} 项重复）` : ""}` : "内容均已存在，未重复导入");
            }
          } else {
            const scene = app.VirtualDraft.parse(text);
            await app.Virtual.save(this.props.owner, scene.name, scene.snapshot);
            await this.reload();
            if (this.alive) this.setState({ importOpen: false, importText: "", notice: "", noticeError: false });
          }
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      handleImportFile = async event => {
        const input = event.target, file = input.files?.[0];
        if (!file) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          if (file.size > 5000000) throw Error("文件超过 5 MB 大小限制。");
          const text = await file.text();
          if (this.alive) this.setState({ importText: text });
        } catch (error) { this.fail(error); }
        finally { input.value = ""; if (this.alive) this.setState({ busy: false }); }
      };
      render() {
        const { entries, loading, subscribeOpen, importOpen, editor, draft, undo, input, notice, noticeError, busy } = this.state;
        return h("section", { id: "mwi-virtual-section", className: "mwi-virtual-panel", "aria-label": "虚拟配装" },
          h("div", { className: "mwi-virtual-head" },
            h("div", { className: "mwi-virtual-head-left" },
              h("h2", null, "虚拟配装"),
              entries.length > 0 && h("span", { className: "mwi-overview-scene-count" }, String(entries.length)),
              !loading && !entries.length && !subscribeOpen && !importOpen && !editor && !draft && !undo &&
                h("span", { className: "mwi-virtual-empty-inline" }, "暂无副本或订阅")),
            h("div", { className: "mwi-virtual-actions" },
              h("button", {
                type: "button",
                className: "mwi-overview-button" + (editor ? " mwi-overview-scenes-active" : ""),
                disabled: Boolean(editor),
                onClick: () => this.edit()
              }, "+ 新建"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn" + (importOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": importOpen,
                disabled: Boolean(editor),
                onClick: () => this.setState({ importOpen: !importOpen, subscribeOpen: false, notice: "" })
              }, "导入分享"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn" + (subscribeOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": subscribeOpen,
                disabled: Boolean(editor),
                onClick: () => this.setState({ subscribeOpen: !subscribeOpen, importOpen: false, notice: "" })
              }, "+ 订阅配装"),
              entries.length > 0 && h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn mwi-overview-copy-btn" + (this.state.exported ? " is-copied" : ""),
                disabled: busy,
                title: "导出全部虚拟配装与订阅备份",
                onClick: this.exportAll
              }, this.state.exported ? "已导出" : "导出备份"))),

          !editor && draft && h("div", { className: "mwi-virtual-banner", role: "status" },
            h("span", null, `有未保存草稿「${draft.title || "未命名"}」`),
            h("div", { className: "mwi-virtual-actions" },
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-primary", onClick: this.resumeDraft }, "继续编辑"),
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", onClick: this.discardDraft }, "丢弃"))),

          undo && h("div", { className: "mwi-virtual-banner", role: "status" },
            h("span", null, `已移除“${undo.title}”`),
            h("div", { className: "mwi-virtual-actions" },
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-primary", disabled: busy, onClick: this.restoreRemoved }, "撤销"),
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn", "aria-label": "关闭提示", onClick: () => this.setState({ undo: null }) }, "×"))),

          editor && h("div", { ref: node => { this.editorTop = node; } }, h(VirtualEditor, {
            scene: editor.scene, draft: editor.draft, catalog: editor.catalog, nativeProps: this.props.nativeProps,
            onDraftChange: this.persistDraft,
            onSave: this.saveDraft, onCancel: this.cancelEditor
          })),

          importOpen && h("form", {
            className: "mwi-virtual-bar mwi-virtual-share",
            onSubmit: this.importShare,
            onKeyDown: e => { if (e.key === "Escape") { e.stopPropagation(); this.setState({ importOpen: false, notice: "" }); } }
          },
            h("div", { className: "mwi-virtual-drawer-head" },
              h("span", { className: "mwi-virtual-drawer-title" }, "导入虚拟配装（分享 / 备份）"),
              h("button", {
                type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn",
                "aria-label": "关闭导入", title: "关闭", disabled: busy,
                onClick: () => this.setState({ importOpen: false, notice: "" })
              }, "×")),
            h("textarea", {
              required: true, maxLength: 5000000, rows: 4, value: this.state.importText,
              "aria-label": "虚拟配装分享内容", placeholder: "粘贴单条虚拟配装分享或虚拟配装备份 JSON，或选择文件", disabled: busy,
              onChange: e => this.setState({ importText: e.target.value })
            }),
            h("input", {
              type: "file", accept: ".json,.txt,application/json", hidden: true,
              "aria-label": "选择虚拟配装分享文件",
              ref: node => { this.importFileInput = node; },
              onChange: this.handleImportFile
            }),
            h("div", { className: "mwi-virtual-split-actions" },
              h("button", {
                type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
                onClick: () => this.importFileInput?.click()
              }, "选择文件"),
              h("div", { className: "mwi-virtual-actions" },
                h("button", {
                  type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
                  onClick: () => this.setState({ importOpen: false, notice: "" })
                }, "取消"),
                h("button", {
                  type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy
                }, "导入为新配装")))),

          subscribeOpen && h("form", {
            className: "mwi-virtual-subscribe",
            onSubmit: this.subscribe,
            onKeyDown: e => { if (e.key === "Escape") { e.stopPropagation(); this.setState({ subscribeOpen: false, notice: "" }); } }
          },
            h("input", {
              "aria-label": "配装分享地址",
              placeholder: "粘贴 clipboard.im 分享地址或 ID",
              value: input,
              onChange: e => this.setState({ input: e.target.value }),
              required: true
            }),
            h("button", { type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy }, busy ? "读取中…" : "订阅"),
            h("button", {
              type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
              onClick: () => this.setState({ subscribeOpen: false, notice: "" })
            }, "取消")),

          notice && h("p", {
            role: "status",
            className: "mwi-virtual-notice mwi-virtual-panel-notice" + (noticeError ? " mwi-cloud-warning" : "")
          }, notice),
          loading && h("p", { className: "mwi-virtual-empty" }, "读取中…"),
          entries.length > 0 && h("div", { className: "mwi-virtual-grid" }, entries.map(entry =>
            h(Entry, {
              key: entry.token,
              entry,
              owner: this.props.owner,
              nativeProps: this.props.nativeProps,
              nativeIcons: this.props.nativeIcons,
              getCatalog: this.props.getCatalog,
              onEdit: this.edit,
              onRemoved: this.handleRemoved,
              reload: this.reload
            }))));
      }
    };
  };
})(globalThis);
