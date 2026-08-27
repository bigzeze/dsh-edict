# ⚔️ dsh-edict · Three Departments and Six Ministries

> Brings the ancient Chinese imperial institution of the **Three Departments and Six Ministries** (三省六部) into multi-agent collaboration on the DeepSeek Harness (DSH).
> Instead of one AI ploughing through a complex task alone, every non-trivial job becomes an **edict** (旨意) that flows through a fixed pipeline: **Intake (Crown Prince) → Planning (Secretariat) → Review with veto power (Chancellery) → Dispatch (Department of State Affairs) → Parallel execution by the Six Ministries → Final report to the throne** — fully audited, observable, and interruptible.

[简体中文](README.md) · **English**

---

## What problem it solves

Ordinary multi-agent setups rely on the model "remembering" to behave: tasks get split ad hoc, nobody gates the plan for quality, a failed subtask still looks green on the board, and you cannot intervene midway. dsh-edict turns the workflow into a hard, **institutional state machine**:

- **A mandatory review gate** — every plan must pass the Chancellery (门下省). A substandard plan is **vetoed** (封驳, *fēngbó*) and sent back to the Secretariat to redo; the gate cannot be skipped.
- **Full audit trail** — every transition, veto, dispatch, and ministry completion is appended to an immutable flow log.
- **A live "Grand Council" kanban** (军机处, *Jūnjīchù*) — one board in the browser showing which stage each edict is in, how far each ministry has got, and who is stuck.
- **Intervention** — you can **hold / resume / cancel** any in-flight edict at any time.
- **Failures are not hidden** — if a ministry's agent errors, its card turns red automatically; an edict with a failed ministry cannot be reported as done.

---

## Relationship to the original edict

This plugin is inspired by [cft0808/edict](https://github.com/cft0808/edict), an OpenClaw project that simulates the imperial court with 12 always-on agents and instant-messaging. dsh-edict ports the **institutional idea** into a native DSH plugin:

| Aspect | Original edict (OpenClaw) | dsh-edict (this plugin) |
|---|---|---|
| Runtime | 12 persistent agents with SOUL.md personas | Task-scoped, short-lived subagents / workflows; no daemons |
| State flow | Python scripts writing JSON | Built-in state machine; illegal transitions are rejected |
| Dashboard | Standalone FastAPI + React service | Built-in DSH HTTP route + native sidebar entry |
| Approval | By messaging convention | The Chancellery review is an enforced tool gate; a veto auto-rebounds |
| Integration | IM (Feishu / Telegram) | Native DSH tools, slash command, skill, and sessions |

---

## Installation

### Prerequisites

- **DeepSeek Harness (DSH)** installed, using the `web` profile (`dsh web`).
- **Node.js ≥ 20**.
- Local link installs require **pnpm** on your `PATH` (DSH uses pnpm to manage a profile's plugin dependencies).

### Option 1: Local link install (for development / self-hosting — recommended to start)

Run from anywhere, using an **absolute path** to the plugin source:

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-edict
```

For example, if the source lives at `/home/user/Desktop/dsh/dsh-edict`:

```bash
dsh plugin --profile web add link:/home/user/Desktop/dsh/dsh-edict
```

A link install needs no network and picks up source changes after a restart — ideal for development and self-hosting.

### Option 2: Install from npm (once published)

```bash
dsh plugin --profile web add dsh-edict
```

### After installing: restart to load

Plugins load when the `dsh web` process starts, so **restart after installing or updating**: press `Ctrl+C` in the terminal running `dsh web`, run `dsh web` again, then refresh your browser.

### Verify it works

After the restart:

1. A **⚔️ 军机处 (Grand Council)** button appears at the bottom of the sidebar (icon-only ⚔️ when the rail is collapsed);
2. Opening `http://127.0.0.1:<port>/edict/` in the browser shows the kanban;
3. Typing `/edict` in a session prints a summary of active edicts.

### Uninstall

```bash
dsh plugin --profile web remove dsh-edict
```

---

## Quick start

### 1. Issue an edict (the natural way)

Just describe a genuinely **complex** task in plain language, for example:

> "Build me a todo app with login — frontend, backend, and deployment docs."

The model follows the institution automatically: the **Crown Prince** opens an intake record, a **Secretariat** agent drafts the plan, the **Chancellery** reviews it, and on approval the **Department of State Affairs** fans the work out to the Six Ministries to run in parallel, ending with a **final report to the throne**. You can also ask explicitly: "Use the Three Departments and Six Ministries to…" or "Edict: …".

> 💡 Simple questions, chat, and one-line bug fixes do **not** — and should not — go through this pipeline. The intake step filters them out; otherwise every sentence would summon the whole court.

### 2. The `/edict` slash command

| Usage | Effect |
|---|---|
| `/edict` | Show a summary of currently active edicts |
| `/edict <your request>` | Record `<request>` as a new edict and start the pipeline |

### 3. The Grand Council kanban

Open it either way:

- Click the **⚔️ 军机处** button at the bottom of the sidebar for an in-window modal;
- Or visit the standalone page at `/edict/`.

The header shows stats (active / held / completed today / veto count / ministry progress). The board is laid out in six stage columns; clicking any card slides out a **detail drawer** (the edict, ministry assignments, current progress, full flow log). **Held** edicts appear in a vermilion alert strip at the top. The second tab, **📜 Memorials** (奏折阁), archives every edict that has been reported and closed.

### 4. Hold / Resume / Cancel

In the detail drawer:

- **🛑 Hold** — suspends an active edict (it enters the "held" state) and the model stops advancing it; if the edict is linked to a long-running goal, that goal is paused too;
- **▶️ Resume** — returns a held edict to its previous stage;
- **❌ Cancel** — terminates an edict (you must hold it first).

When clicked inside the DSH window the instruction is sent straight into the current session for the model to execute; on the standalone page it is queued on the server and picked up the next time the model reads the board.

---

## Pipeline & state machine

The legal transitions for an edict (illegal jumps are rejected by the tools, which also tell you the valid destinations):

```
intake ──→ planning ──→ review
                          │
              veto ↺──────┤
                          │ approve
                          ▼
                     dispatching
                          │
                          ▼
                        doing ──→ (sent back for more) ↺
                          │
                          ▼
                    final_review
                          │ report
                          ▼
                        done
```

Two intervention states also exist: **blocked (held)** — resumable or cancellable, and **cancelled** (terminal).

A Chancellery veto may bounce back and forth at most twice; if the plan still falls short, the disagreement is surfaced to you for a ruling.

---

## Tool reference

The plugin registers ten `edict_*` tools for the model (you normally don't call these yourself — the model uses them as the pipeline runs):

| Tool | Purpose | Key parameters |
|---|---|---|
| `edict_issue` | Open an intake record | `title`*, `detail`, `goalId` |
| `edict_transit` | Generic state transition | `id`*, `to`* (target state), `remark` |
| `edict_verdict` | Chancellery decision | `id`*, `verdict`* (`approve`/`reject`), `opinions` |
| `edict_assign` | Dispatch to the Six Ministries | `id`*, `items`* (`{ministry, task}`) |
| `edict_progress` | Report progress / checklist | `id`*, `doing`*, `checklist` |
| `edict_assignment` | Report a ministry's status | `id`*, `key`*, `status`* (`todo`/`doing`/`done`/`failed`), `result` |
| `edict_complete` | Final report & archive (→done) | `id`*, `summary`*, `outputs` |
| `edict_control` | Hold / resume / cancel | `id`*, `action`* (`hold`/`resume`/`cancel`), `note` |
| `edict_list` | Fetch board data | `status` (optional filter) |
| `edict_show` | Fetch one edict's full flow log | `id`* |

---

## Roles & the Six Ministries

**The decision-making departments:**

| Role | Responsibility |
|---|---|
| 🤴 Crown Prince (太子) | Triage: answer chat directly; for an edict, distil a title and open the record |
| 📜 Secretariat (中书省) | Planning: understand the request, design the plan, break it into subtasks, set acceptance criteria |
| 🔍 Chancellery (门下省) | Review & veto: examine feasibility / completeness / risk / resourcing; approve or veto |
| 📮 Dept. of State Affairs (尚书省) | Dispatch & coordinate: assign subtasks to the Six Ministries, run them in parallel, compile the report |

**The Six Ministries (executors):**

| Ministry | Domain |
|---|---|
| 💰 Ministry of Revenue (户部) | Data, resources, accounting: data processing, reports, cost analysis |
| 📝 Ministry of Rites (礼部) | Documentation, standards, reports: tech docs, API docs, specifications |
| ⚔️ Ministry of War (兵部) | Code, algorithms, inspection: feature development, bug fixes, code review |
| ⚖️ Ministry of Justice (刑部) | Security, compliance, audit: security scans, compliance checks, red lines |
| 🔧 Ministry of Works (工部) | CI/CD, deployment, tooling: Docker, pipelines, automation |
| 📋 Ministry of Personnel (吏部) | Personnel, agent management: subagent orchestration, permissions, process meta-tasks |

---

## Multi-agent orchestration notes

The plugin registers an **`edict`** skill that the model follows automatically on complex tasks. Key points:

- **Automatic heartbeats** — the plugin listens to DSH `workflow` / `subagent` / `goal` lifecycle events and writes "started / finished" heartbeats to the board itself; agents don't clock in manually.
- **The label convention** (so heartbeats land on the right edict) — when fanning the Six Ministries out via `workflow`:
  - set the workflow's `meta.name` to `edict-<edict id>`;
  - set each agent's `label` to `edict:<edict id>:<ministry name>` (e.g. `edict:EDICT-20260827-001:兵部`).
  - Workflow events without an edict id are strictly ignored, so other sessions never get polluted.
- **Goal linkage** — long tasks may pass a `goalId` when issued; the board shows a 🎯 badge, and hold/resume prompts the model to pause/resume the linked goal in step.
- **Failure & rework** — if a ministry's agent errors (stopReason=error) it is auto-marked `failed` (red on the board) and must be redone; the model won't close an edict while a ministry is failed.

---

## Data & files

| Content | Location |
|---|---|
| Edicts / flow logs / memorials | `~/.dsh/dsh-edict/edict.json` (atomic writes; terminal edicts are pruned to the most recent 200) |
| Kanban page | Built into the plugin — HTTP route `GET /edict/` |
| Board data API | `GET /edict/api/board` |
| Intervention API | `POST /edict/api/control` |
| Server-side code | package `lib/` |
| Browser-side code | package `client/` (hand-written bundle, no build step) |

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| No ⚔️ button in the sidebar | Plugins load only on restart — restart `dsh web`; confirm it's installed on the `web` profile; hard-refresh the browser (Ctrl+Shift+R) |
| Board shows "connection failed" | Make sure you're on `/edict/`; the data endpoint is `/edict/api/board` (the plugin already uses absolute paths); check `dsh web` is running |
| `dsh plugin add` throws a pnpm / ENOENT error | Link installs need pnpm — install pnpm and make sure it's on your `PATH` |
| Can't install via `git+https://...` | Some environments have no git — use `link:<local path>` or the npm package name instead |
| The model doesn't use the pipeline | Simple tasks shouldn't; when you want it, say "use the Three Departments and Six Ministries to…" or use `/edict <request>` |
| A ministry card stays "in progress" | An errored agent turns red automatically; otherwise check that the workflow `meta.name` / agent `label` follow the convention |

---

## License

[MIT](LICENSE)
