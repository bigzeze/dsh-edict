/**
 * dsh-edict — 三省六部 multi-agent pipeline plugin for DeepSeek Harness.
 *
 * Node half (Cordis service):
 *  - registers the edict_* tool family (enforced state machine + audit trail);
 *  - injects the 三省六部 pipeline section into every system prompt;
 *  - serves the 军机处 kanban dashboard and its JSON API via webServer.
 *
 * The browser half is intentionally framework-free: dashboard.js ships a
 * self-contained HTML page polled over HTTP, so no client bundle is required.
 */
import { createStore, STATES } from "./store.js";
import { SYSTEM_PROMPT_SECTION } from "./roles.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import { SKILL_NAME, SKILL_DESCRIPTION, SKILL_CONTENT } from "./skill-content.js";
import { wireEvents } from "./events.js";

export const name = "dsh-edict";
const inject = ["systemPrompt"];

const OUTPUT_STRING = { type: "string", description: "操作结果回执（中文一句话摘要，异常时以 ❴ 开头说明原因与合法去向）。" };

function brief(t) {
	return `${t.id}「${t.title}」→ ${STATES[t.status] ?? t.status}${t.current ? `（${t.current}）` : ""}`;
}

/** Build the edict_* tool family against a store instance. */
function createTools(store) {
	const tools = [
		{
			name: "edict_issue",
			description: "三省六部·下旨：将用户的复杂任务立为旨意，进入太子分拣(intake)。闲聊/单轮问答不要调用。",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "旨意标题，一句话概括（10-30 字）" },
					detail: { type: "string", description: "旨意详情：背景、要求、约束、验收标准" },
					goalId: { type: "string", description: "可选：若已用 create_goal 建长期目标，填其 goal id，旨意即与该目标联动（叫停/恢复随目标）" },
				},
				required: ["title"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.issue({ title: String(args.title || "").trim(), detail: args.detail ? String(args.detail) : "", goalId: args.goalId ? String(args.goalId) : "" });
					return `✅ 已下旨 ${brief(t)}。下一步：太子分拣后用 edict_transit(to="planning") 传旨中书省规划。`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_transit",
			description: "三省六部·流转：按制度推进旨意状态。合法路径：intake→planning→review→(封驳回planning|准奏→dispatching)→doing→final_review→(发回doing|done)。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号，如 EDICT-20260827-001" },
					to: { type: "string", enum: Object.keys(STATES), description: "目标状态" },
					remark: { type: "string", description: "流转备注（本阶段做了什么、为何流转）" },
				},
				required: ["id", "to"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.transit(String(args.id), String(args.to), args.remark ? String(args.remark) : "", "");
					return `✅ ${brief(t)}`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_verdict",
			description: "三省六部·门下省审议结论：approve=准奏(转尚书省派发)，reject=封驳(打回中书省重做，封驳次数+1)。仅 review 状态可用。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					verdict: { type: "string", enum: ["approve", "reject"], description: "approve=准奏 / reject=封驳" },
					opinions: { type: "array", items: { type: "string" }, description: "审议意见：封驳时为逐条修改意见，准奏时为放行备注" },
				},
				required: ["id", "verdict"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.verdict(String(args.id), String(args.verdict), Array.isArray(args.opinions) ? args.opinions.map(String) : []);
					return t.status === "dispatching"
						? `✅ 门下省准奏，${brief(t)}。下一步：edict_assign 派发六部。`
						: `🚫 门下省封驳（第 ${t.round} 次），${brief(t)}。将意见交中书省重做后重新提交审议。`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_assign",
			description: "三省六部·尚书省派发：把子任务派给六部并进入执行(doing)。ministry 取值：户部/礼部/兵部/刑部/工部/吏部。仅 dispatching 状态可用。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					items: {
						type: "array",
						description: "分派列表",
						items: {
							type: "object",
							properties: {
								ministry: { type: "string", description: "承接部门：户部/礼部/兵部/刑部/工部/吏部" },
								task: { type: "string", description: "该部承接的具体任务与验收标准" },
							},
							required: ["ministry", "task"],
							additionalProperties: false,
						},
					},
				},
				required: ["id", "items"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.assign(String(args.id), Array.isArray(args.items) ? args.items : []);
					return `✅ ${brief(t)}。各部任务应并行执行（workflow parallel 或多个并行 subagent），进展用 edict_progress 上报。`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_progress",
			description: "三省六部·心跳进展：上报当前在做什么与清单进度（看板心跳来源，执行阶段每完成一步都要调）。清单条目可带 ✅=完成 / 🔄=进行中 标记。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					doing: { type: "string", description: "当前正在做什么（一句话）" },
					checklist: { type: "array", items: { type: "string" }, description: "进度清单，如 [\"调研选型✅\",\"撰写方案🔄\",\"原型实现\"]" },
				},
				required: ["id", "doing"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.progress(String(args.id), String(args.doing || ""), Array.isArray(args.checklist) ? args.checklist.map(String) : undefined);
					return `✅ 心跳已记：${brief(t)}`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_assignment",
			description: "三省六部·部务回报：标记某个部门分派任务的完成状态（某部 subagent 完工时调用）。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					key: { type: "string", description: "部门名（如 户部）或分派键 a1/a2…" },
					status: { type: "string", enum: ["todo", "doing", "done", "failed"], description: "任务状态；某部执行失败标 failed 并在 result 写明原因，返工后改回 doing/done" },
					result: { type: "string", description: "交付结果摘要或产物路径" },
				},
				required: ["id", "key", "status"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.assignment(String(args.id), String(args.key), String(args.status), args.result ? String(args.result) : undefined);
					const done = t.assignments.filter((a) => a.status === "done").length;
					const failed = t.assignments.filter((a) => a.status === "failed").length;
					const failWarn = failed ? ` ⚠️ ${failed} 部失败，须返工（edict_assignment 改回 doing 重做）后才可回奏。` : "";
					return `✅ 部务已记：${done}/${t.assignments.length} 部完工。${failWarn}${!failed && done === t.assignments.length ? "全部完工，请 edict_transit(to=\"final_review\") 进入回奏审定。" : ""}`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_complete",
			description: "三省六部·回奏归档：汇总六部成果，写奏折归档(done)。summary 为回奏正文。仅 final_review 状态可用。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					summary: { type: "string", description: "回奏正文：做了什么、结果如何、产物清单" },
					outputs: { type: "array", items: { type: "string" }, description: "产物路径/链接列表" },
				},
				required: ["id", "summary"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.complete(String(args.id), String(args.summary || ""), Array.isArray(args.outputs) ? args.outputs.map(String) : []);
					return `✅ 奏折已归档：${brief(t)}。可用 edict_show 取完整流转链向皇上回奏。`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_control",
			description: "三省六部·干预：hold=叫停(在办→blocked)，resume=恢复(blocked→原状态)，cancel=取消(需先叫停)。也用于执行看板用户提交的 pendingControl。",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string", description: "旨意编号" },
					action: { type: "string", enum: ["hold", "resume", "cancel"], description: "hold=叫停 / resume=恢复 / cancel=取消" },
					note: { type: "string", description: "缘由说明" },
				},
				required: ["id", "action"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				try {
					const t = await store.control(String(args.id), String(args.action), args.note ? String(args.note) : "");
					const word = { hold: "叫停", resume: "恢复", cancel: "取消" }[args.action] || args.action;
					return `✅ 旨意已${word}：${brief(t)}${args.action === "hold" ? "。立即停止推进该旨意，等待皇上进一步指示。" : ""}`;
				} catch (e) { return `❌ ${e.message}`; }
			},
		},
		{
			name: "edict_list",
			description: "三省六部·军机处看板：列出全部旨意（可按状态过滤）。用于渲染看板、检查 pendingControl、开工前查看在办旨意。",
			parameters: {
				type: "object",
				properties: {
					status: { type: "string", enum: Object.keys(STATES), description: "仅看某状态（省略则全部）" },
				},
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				const data = await store.board();
				let tasks = data.tasks;
				if (args.status) tasks = tasks.filter((t) => t.status === args.status);
				if (tasks.length === 0) return "军机处暂无旨意。";
				const lines = tasks.map((t) => {
					const hb = ["done", "cancelled", "blocked"].includes(t.status) ? "" : (Date.now() - new Date(t.updatedAt).getTime()) / 1000 < 120 ? "🟢" : "🟡";
					const pc = t.pendingControl ? ` ⚠️待处理干预:${t.pendingControl.action}` : "";
					const asg = t.assignments.length ? ` [部务 ${t.assignments.filter((a) => a.status === "done").length}/${t.assignments.length}${t.assignments.some((a) => a.status === "failed") ? " ❌失败" : ""}]` : "";
					return `${hb} ${t.id} | ${STATES[t.status]} | ${t.title} | ${t.current || ""}${t.round ? ` | 封驳${t.round}次` : ""}${asg}${pc}`;
				});
				return `军机处旨意 ${tasks.length} 道：\n${lines.join("\n")}`;
			},
		},
		{
			name: "edict_show",
			description: "三省六部·旨意详情/奏折：取单道旨意的完整流转链、分派、清单、审议记录与奏折，用于回奏或排查。",
			parameters: {
				type: "object",
				properties: { id: { type: "string", description: "旨意编号" } },
				required: ["id"],
				additionalProperties: false,
			},
			output: { schema: OUTPUT_STRING },
			async execute(args) {
				const data = await store.board();
				const t = data.tasks.find((x) => x.id === String(args.id));
				if (!t) return `❌ 旨意 ${args.id} 不存在。`;
				const flow = t.flow.map((e) => `- ${e.at?.slice(11, 19)} ${e.stage}：${e.fromName || "—"}→${e.toName}${e.remark ? `（${e.remark}）` : ""}`).join("\n");
				const asg = t.assignments.map((a) => `- ${a.status === "done" ? "✅" : "🔄"} ${a.ministry}：${a.task}${a.result ? ` → ${a.result}` : ""}`).join("\n");
				const v = t.verdicts.map((x) => `- ${x.verdict === "approve" ? "准奏" : "封驳"}：${(x.opinions || []).join("；")}`).join("\n");
				return [
					`${t.id}「${t.title}」— ${STATES[t.status]}`,
					t.detail ? `旨意：${t.detail}` : "",
					asg ? `六部分派：\n${asg}` : "",
					v ? `审议记录：\n${v}` : "",
					t.memorial ? `奏折：\n${t.memorial.summary}\n产物：${(t.memorial.outputs || []).join("、") || "无"}` : "",
					`流转链：\n${flow}`,
				].filter(Boolean).join("\n\n");
			},
		},
	];
	return tools;
}

/** HTTP router for /edict (dashboard page + JSON API + control queue). */
function createHandler(store) {
	return async function handler(req, res) {
		let pathname = "/";
		try {
			pathname = new URL(req.url ?? "/", "http://x").pathname;
		} catch { /* keep "/" */ }

		if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/edict" || pathname === "/edict/" || pathname === "/edict/index.html")) {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
			res.end(DASHBOARD_HTML);
			return;
		}

		if ((req.method === "GET" || req.method === "HEAD") && pathname === "/edict/api/board") {
			const data = await store.board();
			res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
			res.end(JSON.stringify({ now: new Date().toISOString(), tasks: data.tasks }));
			return;
		}

		if (req.method === "POST" && pathname === "/edict/api/control") {
			try {
				const body = await new Promise((resolve, reject) => {
					let raw = "";
					req.on("data", (c) => { raw += c; if (raw.length > 8192) reject(new Error("body too large")); });
					req.on("end", () => resolve(raw));
					req.on("error", reject);
				});
				const { id, action, note } = JSON.parse(body || "{}");
				if (!id || !["hold", "resume", "cancel"].includes(action)) {
					res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "需要 id 与 action(hold|resume|cancel)" }));
					return;
				}
				await store.queueControl(String(id), String(action), note ? String(note) : "");
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			} catch (e) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
			}
			return;
		}

		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("dsh-edict: not found");
	};
}

/**
 * Register against a host context. Services may arrive after plugin init
 * (loader ordering), so probe both synchronously and via internal/service.
 */
export function apply(ctx, config = {}) {
	const store = createStore(config.dataDir);

	const section = () => {
		try {
			ctx.systemPrompt?.section?.({ name: "edict:pipeline", order: 100, text: SYSTEM_PROMPT_SECTION });
		} catch (e) {
			ctx.logger?.warn?.(`[dsh-edict] systemPrompt section failed: ${e?.message || e}`);
		}
	};
	section();

	let toolsDone = false;
	const registerTools = (svc) => {
		if (toolsDone || !svc?.register) return;
		for (const tool of createTools(store)) {
			try { svc.register(tool); } catch (e) { ctx.logger?.warn?.(`[dsh-edict] tool ${tool.name} failed: ${e?.message || e}`); }
		}
		toolsDone = true;
		ctx.logger?.info?.("[dsh-edict] edict_* tools registered (10 tools, state machine armed)");
	};
	const toolsSvc = ctx.reflect?.get?.("tools", false);
	if (toolsSvc) registerTools(toolsSvc);
	ctx.on?.("internal/service", (n, v) => { if (n === "tools") registerTools(v); });

	let routesDone = false;
	const registerRoutes = (svc) => {
		if (routesDone || !svc?.register) return;
		try {
			svc.register({ kind: "prefix", path: "/edict", handler: createHandler(store) });
			routesDone = true;
			ctx.logger?.info?.("[dsh-edict] 军机处 kanban mounted at /edict/");
		} catch (e) { ctx.logger?.warn?.(`[dsh-edict] webServer register failed: ${e?.message || e}`); }
	};
	const webSvc = ctx.reflect?.get?.("webServer", false);
	if (webSvc) registerRoutes(webSvc);
	ctx.on?.("internal/service", (n, v) => { if (n === "webServer") registerRoutes(v); });

	// edict skill — full orchestration playbook (workflow fan-out recipe etc.).
	let skillDone = false;
	const registerSkill = (svc) => {
		if (skillDone || !svc?.register) return;
		try {
			svc.register({
				name: SKILL_NAME,
				description: SKILL_DESCRIPTION,
				whenToUse: "复杂任务需多 Agent 协作、强制审核、看板追踪时；用户提到 旨意/下旨/三省六部/军机处/奏折/edict 时。",
				content: SKILL_CONTENT,
				invocation: { modelInvocable: true, userInvocable: true },
			});
			skillDone = true;
			ctx.logger?.info?.("[dsh-edict] edict skill registered");
		} catch (e) { ctx.logger?.warn?.(`[dsh-edict] skill register failed: ${e?.message || e}`); }
	};
	const skillSvc = ctx.reflect?.get?.("skills", false);
	if (skillSvc) registerSkill(skillSvc);
	ctx.on?.("internal/service", (n, v) => { if (n === "skills") registerSkill(v); });

	// /edict slash command: empty input shows the board; with input it is
	// recorded into the session (recordInput default) and the model picks it
	// up as a 旨意 via the skill.
	let commandDone = false;
	const registerCommand = (svc) => {
		if (commandDone || !svc?.register) return;
		try {
			svc.register({
				name: "edict",
				description: "三省六部·军机处：留空查看在办旨意看板；后接需求文字即下旨（走 中书→门下→六部 流程）",
				input: { hint: "留空查看看板；输入任务即下旨，如：做一个带登录的待办应用" },
				async handler(invocation) {
					const raw = String(invocation?.rawInput ?? "").trim();
					if (raw) {
						return {
							kind: "success",
							text: `⚔️ 旨意已录：「${raw.slice(0, 80)}」。即日发三省六部议处——太子分拣、中书拟方案、门下审议封驳、尚书派发六部承办，进度可在军机处看板（/edict/）查看。`,
						};
					}
					const data = await store.board();
					const active = data.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
					if (active.length === 0) return { kind: "success", text: "军机处无在办旨意。直接对话下达复杂任务，或用 /edict <需求> 下旨。" };
					const lines = active.slice(0, 10).map((t) => {
						const age = (Date.now() - new Date(t.updatedAt).getTime()) / 1000;
						const hb = t.status === "blocked" ? "🛑" : age < 120 ? "🟢" : "🟡";
						const asg = t.assignments.length ? ` [部务 ${t.assignments.filter((a) => a.status === "done").length}/${t.assignments.length}${t.assignments.some((a) => a.status === "failed") ? " ❌失败" : ""}]` : "";
						return `${hb} ${t.id} | ${STATES[t.status]} | ${t.title}${asg}${t.pendingControl ? " | ⚠️待处理干预" : ""}`;
					});
					return { kind: "success", text: `军机处在办旨意 ${active.length} 道：\n${lines.join("\n")}\n\n完整看板：浏览器打开 /edict/` };
				},
			});
			commandDone = true;
			ctx.logger?.info?.("[dsh-edict] /edict command registered");
		} catch (e) { ctx.logger?.warn?.(`[dsh-edict] command register failed: ${e?.message || e}`); }
	};
	const cmdSvc = ctx.reflect?.get?.("commands", false);
	if (cmdSvc) registerCommand(cmdSvc);
	ctx.on?.("internal/service", (n, v) => { if (n === "commands") registerCommand(v); });

	// Auto-heartbeat: host lifecycle events → kanban (no model reporting needed).
	try {
		wireEvents(ctx, store);
		ctx.logger?.info?.("[dsh-edict] lifecycle event listeners armed (workflow/subagent/goal)");
	} catch (e) {
		ctx.logger?.warn?.(`[dsh-edict] event wiring failed: ${e?.message || e}`);
	}
}

export default { name, apply, inject };
