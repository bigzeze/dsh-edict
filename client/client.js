/**
 * dsh-edict client half (browser bundle, hand-written — no build step).
 *
 * Registers two UI slots:
 *  - sidebar.footer.action: a ⚔️ 军机处 button at the sidebar foot (beside
 *    Settings); collapses to an icon when the sidebar is a rail.
 *  - shell.overlay: the 军机处 modal — an iframe pointing at the plugin's own
 *    webServer route (/edict/), so the dashboard page and its control API are
 *    reused as-is, rendered natively inside the DSH window.
 *
 * Bundle contract (see dshmarket client/client.js for the reference shape):
 *   window.__ModuleLoader__.load({ id, factory: (require) => moduleExports })
 *   exports.apply(ctx); exports.inject = [service names...]; exports.name.
 */
window.__ModuleLoader__.load({
  id: "dsh-edict",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useSyncExternalStore = React.useSyncExternalStore;

    /* ---- tiny shared open/close store (footer button ↔ overlay modal) ---- */
    var listeners = new Set();
    var isOpen = false;
    function setOpen(v) {
      if (isOpen === v) return;
      isOpen = v;
      for (var l of listeners) { try { l(); } catch (e) { /* listener gone */ } }
    }
    var openStore = {
      subscribe: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
      getSnapshot: function () { return isOpen; }
    };

    /* The plugin route is mounted at the web server root as /edict (prefix). */
    function boardUrl() {
      try { return window.location.origin + "/edict/"; }
      catch (e) { return "/edict/"; }
    }

    var BTN_BASE = {
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      border: "none", background: "transparent", color: "inherit",
      font: "inherit", textAlign: "left", cursor: "pointer",
      borderRadius: 8, fontSize: 13
    };

    /* ---- sidebar foot action: ⚔️ 军机处 ---- */
    function FooterAction(props) {
      var wide = !props || props.wide !== false;
      var style = Object.assign({}, BTN_BASE, {
        padding: wide ? "8px 12px" : "8px",
        justifyContent: wide ? "flex-start" : "center"
      });
      return h(
        "button",
        {
          type: "button",
          title: "军机处 · 三省六部旨意看板",
          "aria-label": "军机处看板",
          style: style,
          onClick: function () { setOpen(true); },
          onMouseEnter: function (e) { e.currentTarget.style.background = "rgba(127,127,127,0.15)"; },
          onMouseLeave: function (e) { e.currentTarget.style.background = "transparent"; }
        },
        h("span", { style: { fontSize: 16, lineHeight: 1 } }, "⚔️"),
        wide ? h("span", null, "军机处") : null
      );
    }

    /* ---- shell overlay: modal with the live kanban iframe ---- */
    function KanbanModal() {
      var open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot);
      if (!open) return null;
      return h(
        "div",
        {
          onClick: function (e) { if (e.target === e.currentTarget) setOpen(false); },
          style: {
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }
        },
        h(
          "div",
          {
            style: {
              width: "min(1240px, 95vw)", height: "min(88vh, 920px)",
              background: "#1a1d26", border: "1px solid #303646", borderRadius: 12,
              overflow: "hidden", display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
            }
          },
          h(
            "div",
            {
              style: {
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px", borderBottom: "1px solid #262a35",
                flex: "0 0 auto"
              }
            },
            h("span", { style: { fontSize: 16 } }, "⚔️"),
            h("span", { style: { fontWeight: 600, fontSize: 15 } }, "军机处 · 三省六部"),
            h(
              "button",
              {
                type: "button",
                onClick: function () { setOpen(false); },
                title: "关闭",
                style: {
                  marginLeft: "auto", background: "#262b38", color: "#d6dae4",
                  border: "1px solid #394052", borderRadius: 8,
                  padding: "5px 14px", fontSize: 13, cursor: "pointer", font: "inherit"
                }
              },
              "✕ 关闭"
            )
          ),
          h("iframe", {
            src: boardUrl(),
            title: "军机处看板",
            style: { flex: 1, width: "100%", border: "none", background: "#100e0a" }
          })
        )
      );
    }

    /* Forward a dashboard control click straight into the current session's
       conversation, so the model acts on 叫停/恢复/取消 immediately instead of
       waiting to notice the queued pendingControl on its next tool call. The
       iframe's HTTP queue remains as the fallback path. */
    function sendControlToConversation(hostCtx, d) {
      try {
        if (!hostCtx || !hostCtx.sessions) return;
        var sid;
        try { sid = hostCtx.sessions.list.getSnapshot().current; } catch (e) { sid = undefined; }
        if (!sid) return;
        var conv;
        try { conv = hostCtx.sessions.scope(sid)?.get("conversation"); } catch (e) { conv = undefined; }
        if (!conv || typeof conv.send !== "function") return;
        var word = { hold: "叫停", resume: "恢复", cancel: "取消" }[d.action] || d.action;
        var text = "[edict] 用户在军机处看板点击「" + word + "」旨意 " + d.id +
          (d.note ? "（缘由：" + d.note + "）" : "") +
          "。请立即调用 edict_control(id=\"" + d.id + "\", action=\"" + d.action + "\") 执行；" +
          "若该旨意带 🎯 联动（edict_show 可见 goalId），叫停时同步 update_goal(action=\"pause\")、" +
          "恢复时同步 update_goal(action=\"resume\")；" +
          (d.action === "hold" ? "执行后停止推进该旨意并向用户确认。" : "执行后向用户确认。");
        Promise.resolve(conv.send(text)).catch(function () { /* queued fallback still holds */ });
      } catch (e) { try { console.warn("[dsh-edict] control forward failed:", e && e.message ? e.message : e); } catch (_) { /* no console */ } }
    }

    function apply(ctx) {
      function safe(label, fn) {
        try { fn(); }
        catch (e) { try { console.warn("[dsh-edict] " + label + " failed:", e && e.message ? e.message : e); } catch (_) { /* no console */ } }
      }
      safe("slots.inject", function () {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
        ctx.slots.inject("sidebar.footer.action", function () {
          try {
            return ctx.slots.register(
              { name: "sidebar.footer.action", id: "dsh-edict-kanban", order: 30 },
              FooterAction
            );
          } catch (e) { console.warn("[dsh-edict] footer register failed:", e && e.message ? e.message : e); }
        });
        ctx.slots.inject("shell.overlay", function () {
          try {
            return ctx.slots.register(
              { name: "shell.overlay", id: "dsh-edict-kanban-modal", order: 30 },
              KanbanModal
            );
          } catch (e) { console.warn("[dsh-edict] overlay register failed:", e && e.message ? e.message : e); }
        });
      });
      safe("control-forward", function () {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
        window.addEventListener("message", function (ev) {
          try {
            var d = ev.data;
            if (!d || d.source !== "edict" || d.type !== "control") return;
            try { if (ev.origin !== window.location.origin) return; } catch (e) { /* same-origin check best effort */ }
            sendControlToConversation(ctx, d);
          } catch (e) { /* never break the message stream */ }
        });
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    exports.name = "dsh-edict";
    return module.exports;
  }
});
