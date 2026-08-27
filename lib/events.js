/**
 * dsh-edict — host lifecycle event → kanban auto-heartbeat wiring.
 *
 * The host emits Cordis events as agents come and go:
 *   workflow/start        { id, meta: { name, description } }
 *   workflow/agent-start  { label, phase, childId }
 *   workflow/agent-end    { label, phase, childId, stopReason? }
 *   subagent/start|end    { id, runId, provider, local, stopReason? }
 *   goal/change           { ...goal fields... }
 *
 * Precise correlation: labels/meta carrying `EDICT-YYYYMMDD-NNN` route to the
 * exact edict; ministry names in the label drive assignment status. Fallback
 * attribution (unlabeled subagent events) only fires when exactly one edict is
 * active, so unrelated sessions never pollute a board.
 */

const EDICT_ID_RE = /EDICT-\d{8}-\d{3}/;
const MINISTRY_NAMES = ["户部", "礼部", "兵部", "刑部", "工部", "吏部"];

function extractId(...parts) {
	for (const p of parts) {
		const m = String(p ?? "").match(EDICT_ID_RE);
		if (m) return m[0];
	}
	return null;
}

function extractMinistry(...parts) {
	const blob = parts.join(" ");
	return MINISTRY_NAMES.find((n) => blob.includes(n)) ?? null;
}

function isFailure(info) {
	return info?.stopReason === "error" || info?.error != null || info?.status === "error" || info?.status === "failed";
}

/**
 * Wire listeners onto a host context. Returns a dispose function.
 * Every handler is defensive: a missing service or unknown payload must never
 * disrupt the host event stream.
 */
export function wireEvents(ctx, store) {
	const disposers = [];
	const on = (eventName, fn) => {
		try {
			const d = ctx.on?.(eventName, (...args) => {
				Promise.resolve()
					.then(() => fn(...args))
					.catch((e) => ctx.logger?.warn?.(`[dsh-edict] event ${eventName} failed: ${e?.message || e}`));
			});
			if (typeof d === "function") disposers.push(d);
			else if (d && typeof d.dispose === "function") disposers.push(() => d.dispose());
		} catch (e) {
			ctx.logger?.warn?.(`[dsh-edict] cannot listen to ${eventName}: ${e?.message || e}`);
		}
	};

	// workflow/start — the 尚书省 fan-out begins; meta.name carries edict-<id>.
	on("workflow/start", async (info) => {
		const meta = info?.meta ?? {};
		const id = extractId(meta.name, info?.id);
		if (!id) return;
		await store.touch(id, `workflow 启动：${meta.description || meta.name || "六部并行"}`, "workflow-start");
	});

	// workflow/agent-start — a ministry agent picks up work. Workflow agents
	// carry the edict id in their label by skill convention; without it the
	// event belongs to some other (non-edict) workflow and must not land here.
	on("workflow/agent-start", async (info) => {
		const label = String(info?.label ?? "");
		const phase = String(info?.phase ?? "");
		const id = extractId(label, phase);
		if (!id) return;
		const min = extractMinistry(label, phase);
		await store.touch(id, `${min ?? (label || "agent")} 开工${phase ? `（${phase}）` : ""}`, "agent-start");
		if (min) await store.assignment(id, min, "doing").catch(() => {});
	});

	// workflow/agent-end — a ministry agent reports back.
	on("workflow/agent-end", async (info) => {
		const label = String(info?.label ?? "");
		const phase = String(info?.phase ?? "");
		const id = extractId(label, phase);
		if (!id) return;
		const min = extractMinistry(label, phase);
		const failed = isFailure(info);
		await store.touch(id, `${min ?? (label || "agent")} ${failed ? "❌ 执行出错" : "完工交差"}`, failed ? "agent-error" : "agent-end");
		if (min) {
			await store
				.assignment(id, min, failed ? "failed" : "done", failed ? "agent 执行失败（stopReason=error），需返工" : undefined)
				.catch(() => {});
		}
	});

	// Plain subagents (中书/门下 stages) carry no label — attribute only when
	// exactly one edict is active, so concurrent unrelated sessions are safe.
	on("subagent/start", async () => {
		const id = await store.singleActiveId();
		if (id) await store.touch(id, "子代理开工（中书/门下/部务）", "subagent-start");
	});
	on("subagent/end", async (payload) => {
		const id = await store.singleActiveId();
		if (!id) return;
		await store.touch(id, isFailure(payload) ? "子代理执行出错" : "子代理交差", isFailure(payload) ? "subagent-error" : "subagent-end");
	});

	// goal/change — keep the linked edict's heartbeat alive across goal rounds.
	on("goal/change", async (payload) => {
		const gid = payload?.goal?.id ?? payload?.id ?? payload?.goalId;
		if (!gid) return;
		const phase = payload?.goal?.phase ?? payload?.phase ?? payload?.status ?? "";
		await store.touchGoal(String(gid), `目标续跑（${phase || "状态变更"}）`, "goal-change");
	});

	return () => {
		for (const d of disposers) {
			try { d(); } catch { /* already disposed */ }
		}
	};
}
