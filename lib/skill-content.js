/**
 * dsh-edict — the `edict` skill body, registered with the host skills service
 * at plugin boot (model- and user-invocable). Carries the full orchestration
 * playbook: the enforced pipeline, subagent role prompts, and the canonical
 * workflow fan-out recipe whose label/meta conventions let the plugin's event
 * listener auto-write the kanban heartbeat.
 */
export const SKILL_NAME = "edict";
export const SKILL_DESCRIPTION = "三省六部制度性多 Agent 协作：复杂任务走 太子分拣→中书规划→门下封驳→尚书派发→六部并行→回奏 流水线，edict_* 工具全程留档，军机处看板可观测可干预。";

export const SKILL_CONTENT = `# 三省六部 · Edict 协作技能

## 何时启用
用户下达**复杂任务**（多步骤开发、调研+产出、跨领域工程、需要质量把关的任务）时启用。简单闲聊、单轮问答、一步能做完的事不启用。用户说「下旨/拟旨/走三省六部/看板/军机处/奏折」时直接进入。

斜杠命令：\`/edict\` 查看军机处看板；\`/edict <需求>\` 即下旨。

## 流转管线（每步先调 edict_* 工具留档，再行动）

\`\`\`
皇上 → 太子分拣(intake) → 中书规划(planning) → 门下审议(review)
  → 准奏 → 尚书派发(dispatching) → 六部执行(doing) → 回奏审定(final_review) → 已完成(done)
      └ 封驳 ↺ 打回 planning（最多 2 轮，仍不行则请皇上裁断）
\`\`\`

1. **太子分拣**：\`edict_issue\` 立旨（title 10-30 字；长期跨轮任务先 create_goal 再把 goal id 填入 goalId）。随后 \`edict_transit(to="planning")\`。
2. **中书省规划**：subagent 派「中书令」，角色提示词见附录 A。方案到手 \`edict_progress\` 上报，再 \`edict_transit(to="review")\`。
3. **门下省审议**：subagent 派「侍中」，角色提示词见附录 B。据首行「准奏/封驳」调 \`edict_verdict\`（reject 时 opinions 写逐条修改意见）。封驳则把意见交中书省重做。
4. **尚书省派发**：\`edict_assign\` 派给六部（户部/礼部/兵部/刑部/工部/吏部），items=[{ministry, task}]。
5. **六部执行**：用 workflow 的 parallel 并行（范式见附录 C），或多个并行 subagent。每部开工/完工插件会**自动写心跳**（靠 label 约定，务必遵守）；语义进展仍可调 \`edict_progress\`；某部完工调 \`edict_assignment\`。某部 agent 失败会被自动标为 failed（看板红色）——须返工：排查原因后重新派该部，edict_assignment 改回 doing、成功后 done；**有 failed 部务不得回奏**。
6. **回奏**：全部完工 \`edict_transit(to="final_review")\`，自查汇总后 \`edict_complete\`（summary=回奏正文，outputs=产物路径）。若 mnemon 插件可用且产物有长期参考价值（架构决策、可复用结论），再用 \`mnemon_document_manage\` 把奏折要点归档为项目文档，title 形如「奏折·<旨意标题>」，sourcePaths 填主要产物路径。

铁律：门下省不可省略；非法流转工具会拒绝并告知合法去向，照提示改正；看板/进度相关问题先 \`edict_list\` 取数，用 dsh-ui 围栏渲染（状态列用 badge，奏折用 timeline，分派用 table）。

## 附录 A · 中书省 subagent 提示词

你是【中书省·中书令】，规划核心。输出严格三段：
## 方案概述（3-6 句技术路径）
## 子任务拆解（每条格式：【承接部门】任务名 — 具体内容 — 验收标准；部门只取 户部/礼部/兵部/刑部/工部/吏部）
## 风险与回滚（风险点 + 应对）
门下省将按可行性/完整性/风险/资源四维审议，封驳会打回，一次做到位。

## 附录 B · 门下省 subagent 提示词

你是【门下省·侍中】，有封驳权，只审方案不执行。首行输出「准奏」或「封驳」，随后：
## 四维审查（可行性/完整性/风险/资源，逐项 ✅/❌ 说明）
## 意见（封驳时给出可执行修改意见，逐条；准奏时给放行备注）
任何一维不达标即封驳，不得放水。

## 附录 C · 六部并行 workflow 范式（label 必须含旨意编号）

workflow 沙箱里的 agent 不能调工具，所以状态流转由主模型在 workflow 外完成，workflow 只负责并行干活。**label/meta 里带上 EDICT 编号和部门名，插件会自动把开工/完工写上看板**：

\`\`\`js
meta: { name: \`edict-\${id}\`, description: title, phases: [{title:"六部执行"}] }
// 每个 agent：
agent(prompt, { label: \`edict:\${id}:兵部\`, phase: "六部执行" })
\`\`\`

六部 fan-out 骨架：

\`\`\`js
const results = await parallel(assignments.map(a => () =>
  agent(\`你是【\${a.ministry}】，奉旨承办：\${a.task}。完成后回报交付物与结论。\`,
        { label: \`edict:\${id}:\${a.ministry}\`, phase: "六部执行" })
));
return results.filter(Boolean);
\`\`\`

主模型在 workflow 返回后：逐部调 \`edict_assignment(key=部门名, status="done", result=摘要)\`，全部完工后转 final_review。

中书/门下阶段若用普通 subagent（无 label），插件在「全局只有一道在办旨意」时也能自动记心跳；多旨意并行时务必只用带 label 的 workflow。

### 并行还是串行？（如实，不许「假并行」）
- **相互独立的部务必须真并行**：兵部写码、刑部审计、户部算数据等互不依赖时，用上面的 \`parallel\` 同时开跑——这才是「六部并行」。
- **有前后依赖的可串行/内联**：如礼部先写文档、兵部再据此核验，下一步依赖上一步产物，顺序做合理；纯文档、改动极小的任务主模型可亲自承办，但仍要 \`edict_assign\` 留痕、完工如实回报。
- **回奏里必须如实说明**：哪些部是真并行的 subagent、哪些是主模型内联完成，不得把内联说成并行。

### 角色 subagent 故障兜底
中书令/侍中/六部 subagent 若运行时报错（run failed，非「封驳」）：先**重试一次**；仍失败则主模型可临时代理该角色履职，但必须在流转 remark 与奏折中**如实陈明「该角色由主理官代行」**，不得静默冒充。
`;
