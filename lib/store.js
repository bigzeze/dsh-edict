/**
 * dsh-edict — task state store with the enforced 三省六部 state machine.
 *
 * Port of edict's kanban_update.py design (legal-transition table, file
 * locking, flow audit chain) to a zero-dependency Node store. State lives in
 * a single JSON file under the DSH dir; writes are serialized through a
 * promise chain and made atomic via tmp+rename, so parallel sub-agents can
 * call the edict_* tools concurrently without corrupting the board.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Canonical task states with their Chinese stage names. */
export const STATES = {
	intake: "太子分拣",
	planning: "中书规划",
	review: "门下审议",
	dispatching: "尚书派发",
	doing: "六部执行",
	final_review: "回奏审定",
	done: "已完成",
	blocked: "叫停",
	cancelled: "已取消",
};

/** Active pipeline states (hold/cancel targets). */
export const ACTIVE_STATES = ["intake", "planning", "review", "dispatching", "doing", "final_review"];

/**
 * Legal transitions — the institutional rulebook. `review → planning` is the
 * 封驳 (rejection) loop; `final_review → doing` is the 发回补充 loop.
 * blocked/cancelled are terminal-ish and only move via control actions.
 */
export const TRANSITIONS = {
	intake: ["planning"],
	planning: ["review"],
	review: ["planning", "dispatching"],
	dispatching: ["doing"],
	doing: ["final_review"],
	final_review: ["doing", "done"],
	blocked: [],
	done: [],
	cancelled: [],
};

/** The six ministries (六部) plus 吏部 that 尚书省 dispatches to. */
export const MINISTRIES = {
	hubu: { name: "户部", emoji: "💰", duty: "数据、资源、核算：数据处理、报表、成本分析" },
	libu: { name: "礼部", emoji: "📝", duty: "文档、规范、报告：技术文档、API 文档、规范制定" },
	bingbu: { name: "兵部", emoji: "⚔️", duty: "代码、算法、巡检：功能开发、Bug 修复、代码审查" },
	xingbu: { name: "刑部", emoji: "⚖️", duty: "安全、合规、审计：安全扫描、合规检查、红线管控" },
	gongbu: { name: "工部", emoji: "🔧", duty: "CI/CD、部署、工具：Docker、流水线、自动化" },
	lilibu: { name: "吏部", emoji: "📋", duty: "人事、Agent 管理：子代理编排、权限维护" },
};

export function nowIso() {
	return new Date().toISOString();
}

function ymd(d = new Date()) {
	return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Create the store. `dataDir` defaults to ~/.dsh/dsh-edict — outside the
 * session workspace so the board survives across sessions and projects.
 */
export function createStore(dataDir) {
	const dir = dataDir || join(homedir(), ".dsh", "dsh-edict");
	const file = join(dir, "edict.json");

	let chain = Promise.resolve();
	/** Serialize all read-modify-write cycles (the agent-facing file lock). */
	function withLock(fn) {
		const run = chain.then(() => fn());
		// Keep the chain alive even when a caller rejects.
		chain = run.then(() => {}, () => {});
		return run;
	}

	function load() {
		try {
			return JSON.parse(readFileSync(file, "utf8"));
		} catch {
			return { seq: 0, tasks: [] };
		}
	}

	function save(data) {
		mkdirSync(dir, { recursive: true });
		const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
		writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
		renameSync(tmp, file);
	}

	function nextId(data) {
		const today = ymd();
		const count = data.tasks.filter((t) => t.id.includes(today)).length;
		data.seq = (data.seq || 0) + 1;
		return `EDICT-${today}-${String(count + 1).padStart(3, "0")}`;
	}

	function getTask(data, id) {
		const t = data.tasks.find((x) => x.id === id);
		if (!t) {
			const err = new Error(`旨意 ${id} 不存在。用 edict_list 查看在办旨意。`);
			err.code = "NOT_FOUND";
			throw err;
		}
		return t;
	}

	function pushFlow(t, from, to, remark, stage) {
		t.flow.push({ at: nowIso(), from, to, fromName: STATES[from] || from, toName: STATES[to] || to, remark: remark || "", stage: stage || "" });
	}

	function legalTargets(status) {
		return TRANSITIONS[status] ?? [];
	}

	/** Cap archived (terminal) tasks so edict.json cannot grow without bound. */
	const ARCHIVE_KEEP = 200;
	function pruneArchive(data) {
		const active = data.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
		const archived = data.tasks.filter((t) => ["done", "cancelled"].includes(t.status));
		// tasks are newest-first; keep only the most recent ARCHIVE_KEEP archives
		if (archived.length <= ARCHIVE_KEEP) return;
		const kept = new Set(archived.slice(0, ARCHIVE_KEEP));
		data.tasks = data.tasks.filter((t) => active.includes(t) || kept.has(t));
	}

	return {
		file,
		STATES,
		TRANSITIONS,
		MINISTRIES,

		/** Raw board snapshot (for the HTTP API and edict_list). */
		board() {
			return withLock(() => load());
		},

		/**
		 * Auto-heartbeat from host lifecycle events (workflow/subagent/goal).
		 * Appends an event to the audit trail and bumps updatedAt so the board
		 * heartbeat reflects real agent activity without model reporting.
		 */
		touch(id, text, kind) {
			return withLock(() => {
				const data = load();
				const t = data.tasks.find((x) => x.id === id);
				if (!t || !ACTIVE_STATES.includes(t.status)) return null;
				if (text) t.current = String(text).slice(0, 500);
				t.events.push({ at: nowIso(), kind: kind || "event", text: String(text || "").slice(0, 300) });
				if (t.events.length > 100) t.events = t.events.slice(-100);
				t.updatedAt = nowIso();
				save(data);
				return t;
			});
		},

		/** Id of the most recently updated active task (event fallback). */
		async latestActiveId() {
			const data = await this.board();
			const active = data.tasks.filter((t) => ACTIVE_STATES.includes(t.status)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
			return active[0]?.id ?? null;
		},

		/** Id only when exactly one task is active (safe attribution). */
		async singleActiveId() {
			const data = await this.board();
			const active = data.tasks.filter((t) => ACTIVE_STATES.includes(t.status));
			return active.length === 1 ? active[0].id : null;
		},

		/** Heartbeat routed by linked goal id. */
		touchGoal(goalId, text, kind) {
			return withLock(() => {
				const data = load();
				const t = data.tasks.find((x) => x.goalId === goalId);
				if (!t || !ACTIVE_STATES.includes(t.status)) return null;
				t.current = String(text).slice(0, 500);
				t.events.push({ at: nowIso(), kind: kind || "goal", text: String(text || "").slice(0, 300) });
				t.updatedAt = nowIso();
				save(data);
				return t;
			});
		},

		/** 下旨：create an edict in intake (太子分拣). */
		issue({ title, detail, goalId }) {
			return withLock(() => {
				const data = load();
				const id = nextId(data);
				const now = nowIso();
				const task = {
					id,
					title,
					detail: detail || "",
					goalId: goalId || null,
					status: "intake",
					prevStatus: null,
					round: 0,
					createdAt: now,
					updatedAt: now,
					current: "旨意已下，等候太子分拣",
					checklist: [],
					assignments: [],
					verdicts: [],
					flow: [],
					events: [],
					memorial: null,
					pendingControl: null,
				};
				pushFlow(task, null, "intake", "皇上降旨", "皇上");
				data.tasks.unshift(task);
				save(data);
				return task;
			});
		},

		/** Generic legal transition with rulebook enforcement. */
		transit(id, to, remark, stage) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				const from = t.status;
				if (from === to) {
					const err = new Error(`${id} 已在「${STATES[to]}」状态，无需重复流转。`);
					err.code = "NOOP";
					throw err;
				}
				const ok = legalTargets(from);
				if (!ok.includes(to)) {
					const err = new Error(
						`非法流转：${STATES[from]} → ${STATES[to] ?? to}。「${STATES[from]}」只可流转至：${ok.map((s) => `${STATES[s]}(${s})`).join("、") || "（终态，不可流转）"}。`,
					);
					err.code = "ILLEGAL";
					throw err;
				}
				t.status = to;
				t.updatedAt = nowIso();
				pushFlow(t, from, to, remark, stage);
				save(data);
				return t;
			});
		},

		/** 门下省 verdict: approve (准奏) or reject (封驳 → planning, round++). */
		verdict(id, verdict, opinions) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				if (t.status !== "review") {
					const err = new Error(`门下省只能审议「review(门下审议)」状态的旨意，当前为「${STATES[t.status]}」。`);
					err.code = "STATE";
					throw err;
				}
				const from = t.status;
				t.verdicts.push({ at: nowIso(), verdict, opinions: opinions || [] });
				if (verdict === "approve") {
					t.status = "dispatching";
					pushFlow(t, from, "dispatching", `门下省准奏${opinions?.length ? `：${opinions.join("；")}` : ""}`, "门下省");
				} else if (verdict === "reject") {
					t.round += 1;
					t.status = "planning";
					pushFlow(t, from, "planning", `门下省封驳（第 ${t.round} 次）：${(opinions || []).join("；") || "方案不达标"}`, "门下省");
				} else {
					const err = new Error(`verdict 只接受 "approve"（准奏）或 "reject"（封驳）。`);
					err.code = "ARG";
					throw err;
				}
				t.updatedAt = nowIso();
				save(data);
				return t;
			});
		},

		/** 尚书省 dispatch: assign ministries, then move dispatching → doing. */
		assign(id, items) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				if (t.status !== "dispatching") {
					const err = new Error(`派发旨意需处于「dispatching(尚书派发)」状态，当前为「${STATES[t.status]}」。请先经门下省准奏。`);
					err.code = "STATE";
					throw err;
				}
				if (!Array.isArray(items) || items.length === 0) {
					const err = new Error("至少派发一个部：items=[{ministry:'户部', task:'...'}]。");
					err.code = "ARG";
					throw err;
				}
				const byName = Object.fromEntries(Object.values(MINISTRIES).map((m) => [m.name, m]));
				const validNames = Object.keys(byName);
				t.assignments = items.map((it, i) => {
					const ministry = String(it.ministry || "").trim();
					if (!validNames.includes(ministry)) {
						const err = new Error(`未知部门「${ministry}」。可派发：${validNames.join("、")}。`);
						err.code = "ARG";
						throw err;
					}
					return {
						key: `a${i + 1}`,
						ministry,
						emoji: byName[ministry].emoji,
						task: String(it.task || "").trim(),
						status: "todo",
						result: "",
						startedAt: null,
						endedAt: null,
					};
				});
				const from = t.status;
				t.status = "doing";
				t.current = `已派发 ${t.assignments.length} 个部，开始并行执行`;
				t.updatedAt = nowIso();
				pushFlow(t, from, "doing", `尚书省派发：${t.assignments.map((a) => a.ministry).join("、")}`, "尚书省");
				save(data);
				return t;
			});
		},

		/** Heartbeat + checklist update (any active state). */
		progress(id, doing, checklist) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				if (t.status === "done" || t.status === "cancelled") {
					const err = new Error(`旨意已${STATES[t.status]}，不可再报进展。`);
					err.code = "STATE";
					throw err;
				}
				if (doing) t.current = String(doing).slice(0, 500);
				if (Array.isArray(checklist)) {
					t.checklist = checklist.slice(0, 30).map((raw) => {
						const s = String(raw);
						const done = /[✅☑️✔]|完成|done/i.test(s);
						const doingNow = /[🔄⏳🔨]|进行中|doing/i.test(s);
						return { text: s.replace(/[✅☑️✔🔄⏳🔨]/g, "").replace(/(完成|进行中|done)/gi, "").trim() || s, state: done ? "done" : doingNow ? "doing" : "todo" };
					});
				}
				t.updatedAt = nowIso();
				save(data);
				return t;
			});
		},

		/** Mark one ministry assignment: todo → doing → done/failed. */
		assignment(id, key, status, result) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				const a = t.assignments.find((x) => x.key === key || x.ministry === key);
				if (!a) {
					const err = new Error(`旨意 ${id} 无此分派「${key}」。`);
					err.code = "NOT_FOUND";
					throw err;
				}
				if (!["todo", "doing", "done", "failed"].includes(status)) {
					const err = new Error(`部务状态只接受 todo/doing/done/failed，收到「${status}」。`);
					err.code = "ARG";
					throw err;
				}
				const now = nowIso();
				a.status = status;
				if (status === "doing" && !a.startedAt) a.startedAt = now;
				if (status === "done" || status === "failed") {
					if (!a.startedAt) a.startedAt = a.startedAt || now;
					a.endedAt = now;
				}
				if (result !== undefined) a.result = String(result).slice(0, 1000);
				t.updatedAt = now;
				save(data);
				return t;
			});
		},

		/** 回奏：final_review → done, archive the memorial. */
		complete(id, summary, outputs) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				if (t.status !== "final_review") {
					const err = new Error(`回奏归档需处于「final_review(回奏审定)」状态，当前为「${STATES[t.status]}」。`);
					err.code = "STATE";
					throw err;
				}
				const from = t.status;
				t.memorial = { at: nowIso(), summary: String(summary || "").slice(0, 4000), outputs: outputs || [] };
				t.status = "done";
				t.current = "已回奏归档";
				t.updatedAt = nowIso();
				pushFlow(t, from, "done", "奏折归档，回奏皇上", "尚书省");
				pruneArchive(data);
				save(data);
				return t;
			});
		},

		/** 叫停 / 恢复 / 取消. */
		control(id, action, note) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				const from = t.status;
				if (action === "hold") {
					if (!ACTIVE_STATES.includes(from)) {
						const err = new Error(`只有在办旨意可叫停，当前为「${STATES[from]}」。`);
						err.code = "STATE";
						throw err;
					}
					t.prevStatus = from;
					t.status = "blocked";
					t.pendingControl = null;
					pushFlow(t, from, "blocked", `叫停：${note || "皇上口谕"}`, "皇上");
				} else if (action === "resume") {
					if (from !== "blocked") {
						const err = new Error(`只有「blocked(叫停)」状态可恢复，当前为「${STATES[from]}」。`);
						err.code = "STATE";
						throw err;
					}
					const to = ACTIVE_STATES.includes(t.prevStatus) ? t.prevStatus : "doing";
					t.status = to;
					t.prevStatus = null;
					t.pendingControl = null;
					pushFlow(t, from, to, `恢复旨意：${note || ""}`, "皇上");
				} else if (action === "cancel") {
					if (from !== "blocked" && from !== "intake") {
						const err = new Error(`取消前请先行叫停（hold）；当前为「${STATES[from]}」。`);
						err.code = "STATE";
						throw err;
					}
					t.status = "cancelled";
					t.prevStatus = null;
					t.pendingControl = null;
					pushFlow(t, from, "cancelled", `取消旨意：${note || ""}`, "皇上");
					pruneArchive(data);
				} else {
					const err = new Error(`control action 只接受 hold(叫停) / resume(恢复) / cancel(取消)。`);
					err.code = "ARG";
					throw err;
				}
				t.updatedAt = nowIso();
				save(data);
				return t;
			});
		},

		/** Dashboard-originated request: queued, model executes via edict_control. */
		queueControl(id, action, note) {
			return withLock(() => {
				const data = load();
				const t = getTask(data, id);
				t.pendingControl = { action, note: note || "", at: nowIso() };
				save(data);
				return t;
			});
		},
	};
}
