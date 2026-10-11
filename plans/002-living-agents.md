# 002 — Living agents: real activity, walking workers, readable city

- Status: READY FOR BUILD
- Base: `main` at 4dc2b6d (Mythic City prototype)
- Contract: `src/components/prototype/agentModel.ts` (frozen; changes go through the lead)
- Builders: Muse Spark 1.3 (xhigh) via OpenCode, one run per lane in its own worktree. They commit locally on their lane branch.
- Lead: plans, owns the contract, verifies parsers against real local data, reviews, pushes and merges.

## Why

The city looks great, but the agents are the least visible thing in it. They are tiny, they never move while anonymous traffic does, and nothing is connected to real agents. Meanwhile real Codex / Claude Code / OpenCode agents work in this machine's repositories and write logs every few seconds. Goal: every real agent is a worker in the city. Workers walk to the district that matches what they are doing right now. "Needs you" is visible from the whole city.

Motion must stay truthful. A worker walks only because a real (or clearly labelled simulated) signal changed. Ambient traffic stays scenery.

## Shared model (see contract)

Each agent has separate axes, never collapsed into one status:

- `workState`: active / needs-input / waiting / complete / unknown (what it is doing).
- `freshness`: fresh / stale / historical (how recent the evidence is).
- `phase`: thinking / tool / talking / gap / idle (the moment inside a turn; `gap` is the pause between tool calls, so workers never look frozen).
- `toolKind`: the category of the latest tool, mapped to a district by `TOOL_DISTRICT`.

Freshness thresholds are fixed:

- fresh: signal within `FRESH_MS` (90 s).
- stale: up to `STALE_MS` (20 min). Stale is not dead: the worker sits down and greys out.
- historical: older than that. Not rendered in the city; listed under Past in the roster.

District metaphor (`TOOL_DISTRICT`):

| District | What happens there |
|---|---|
| Foundry | shell commands, file edits (building things) |
| Archive | reading, searching the codebase |
| Observatory | tests, web lookups (checking and looking outward) |
| Port | commits, pushes, PRs (shipping) — a boat leaves the harbor |
| Citadel | delegating to sub-agents, asking the human (needs-input waits on the Citadel steps) |
| Gateway | arrivals and departures |

## Lane A — live feed (branch `codex/city-live-feed`)

Owns `server/**`, new `src/hooks/useCityFeed.ts`, and new tests and fixtures under `server/city/`. Must not edit `src/components/prototype/**` or `src/prototype-main.tsx`.

1. **Scope.** `COMMAND_CENTER_SCOPE_CWD` plus every worktree path that `git -C <scope> worktree list --porcelain` reports (read-only git). An agent belongs to the city if its cwd is one of those paths.
2. **Codex**, from rollout files `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
   - Consider only files modified in the last 24 h: at most 80 files, newest first. Read line 1 (`session_meta`: id, cwd, originator, source) and a bounded tail (≤ 256 KB).
   - Cache parse results by mtime+size. The file mtime is the heartbeat.
   - Observed record kinds (the lead checks them against real data after the build, so parse defensively and ignore unknown kinds):
     - `event_msg` with payload types `task_started`, `task_complete`, `token_count`, and `item_completed` / `item_started`. Item types are `CommandExecution`, `FileChange`, `Reasoning`, `AgentMessage`, `McpToolCall`, `UserMessage`.
     - `response_item` with types `custom_tool_call` (name `exec`), `function_call`, `message`, `reasoning`.
   - Map `CommandExecution` → shell, or test/ship by local command classification. `FileChange` → edit, `Reasoning` → thinking, `AgentMessage` → talking. `task_complete` → waiting. Any event whose type contains `approval_request` → needs-input.
   - Parent links: only an explicit parent/ancestor id from session_meta. Never infer one.
3. **Codex thread titles.** Keep the existing app-server `thread/list` read only for titles. Raise its timeout to 25 s and cache results for 60 s. A measured read of 40 threads took about 11 s against the old 6 s timeout.
4. **Claude Code**, from `~/.claude/projects/<encoded cwd>/<session>.jsonl` for in-scope cwds.
   - Line kinds include `assistant` content `tool_use:<Name>`, `user` content `tool_result`, `assistant` `thinking`/`text`, `custom-title`, `agent-name` and `system`.
   - A `tool_use` without a following `tool_result` → phase tool. Tool names map to kinds:
     - Bash → shell/test/ship by local classification
     - Edit / Write / NotebookEdit → edit
     - Read / Grep / Glob → read / search
     - WebFetch / WebSearch / browser MCP → web
     - Agent / Task → delegate
     - AskUserQuestion → needs-input
   - Sub-agents live in `<session>/subagents/agent-*.jsonl` with `agent-*.meta.json` (keys: agentType, description, toolUseId, spawnDepth, model). parentId = the session; role = agentType. Never forward `description`.
   - Optional exact states via Claude Code hooks: ship `scripts/claude-hook.mjs`, which appends `{session_id, hook_event_name, tool_name, ts}` to `~/.mythic/claude-events.jsonl`, plus documentation of the settings snippet. Do NOT edit the user's `~/.claude/settings.json`; installing the hook is the user's decision. When hook events exist they win over transcript inference: Notification(permission) → needs-input, Stop → waiting.
5. **OpenCode.** Run the existing `session.list` for the scope and for each worktree path, bounded to 4 concurrent reads. Map existing event types (`tool.execute.before/after`, `session.idle`, `session.error`, `session.status`) to phase and toolKind.
6. **Command classification** happens only inside the server process. Use the first tokens of the command:
   - `git commit|push`, `gh pr` → ship
   - known test runners (`npm test`, `node --test`, `pytest`, `vitest`, `jest`, `go test`, `cargo test`) → test
   - anything else → shell

   Raw command text, prompts, messages, tool input and tool output NEVER leave the server. Only `CityAgent` fields do.
7. **Endpoints** (loopback only):
   - `GET /api/city` → `CitySnapshot`.
   - `GET /api/city/stream` (SSE) → the snapshot whenever it changes. Poll file stats every 2 s; only re-parse changed files.
8. **Client.** `useCityFeed()` returns `{ snapshot, status: 'connecting'|'live'|'unavailable', error? }`. Keep the last snapshot on transport failure and mark agents stale by time, never by guesswork.
9. **Tests** use node `--test` with **synthetic hand-written fixtures only**; the repo is public. Never read real local logs (`~/.codex`, `~/.claude`, OpenCode data). Production code may read them at runtime, but you may not open them while building. Cover: freshness thresholds, Codex tail parsing, Claude pending tool_use and sub-agent linking, command classification, scope filtering, and that no forbidden field (command text, prompt, description, full path) appears in a snapshot.

## Lane B — walking workers and readability (branch `codex/city-walking`)

Owns `src/components/prototype/**` (except the frozen contract), `src/prototype-main.tsx`, `prototype.html` and `docs/courtyard-prototype.md`. Must not edit `server/**`.

1. **Consume the contract.** The scene, HUD and roster take `CityAgent[]`. The simulation scenario becomes a producer of `CityAgent` snapshots. Keep its determinism and tests, and extend the script to cover:
   - an arrival at the Gateway
   - tool changes that cause walks
   - a sub-agent spawning beside its parent
   - needs-input → walk to the Citadel steps
   - stale → sit down
   - historical → walk out the Gateway and fade
2. **Work spots.** Every district needs at least one work spot (a ring of slots, so several workers never overlap). Keep the three existing plazas where they are. Add Citadel steps, Observatory and Port spots with the smallest carve that keeps a clear camera corridor. Keep the layout deterministic, and update the building count in the docs to whatever it evaluates to.
3. **Road graph** (`cityGraph.ts`, pure and unit-tested).
   - Nodes are street intersections on the existing grid, plus a connector to each work spot and the Gateway arch.
   - No node or edge may pass through water, the canal (except at `BRIDGES`), the citadel core or the landmarks.
   - Shortest path is a small Dijkstra; no pathfinding library.
   - Tests: every spot reachable from the Gateway, and no edge intersects water/canal/landmark footprints.
4. **Movement** (pure planner plus frame loop).
   - Walk the polyline at constant speed with the existing leg/arm rig; heading follows the tangent.
   - Cap trip time at 4–10 s by scaling speed for long trips (brisk walk → jog).
   - Hysteresis: the target district is the dominant `toolKind` over `DOMINANCE_WINDOW_MS`. Leave a spot only after `DWELL_MIN_MS` there, so a worker never ping-pongs between districts every few seconds.
   - The gesture at a spot follows the current phase/toolKind immediately: hammer (shell/edit), scroll (read/search), telescope (test/web), crate (ship), banner (delegate), hand on chin (thinking), soft glow pulse (talking).
   - Pause freezes walkers. Reduced motion snaps them to their destination. Reuse vectors; no React state per frame.
5. **Spawning and lifecycle.**
   - New root agents walk in through the Gateway arch.
   - Sub-agents appear beside their parent at 0.8× scale. A thin light tether joins child and parent while both are fresh.
   - Historical agents walk back out the Gateway and fade over about 8 s.
   - Stale agents sit (seated pose) and desaturate.
   - Render at most `MAX_RENDERED_WORKERS`, preferring needs-input, then fresh, then stale. The roster lists the rest.
6. **Readability.**
   - Worker scale about 2.2× the current size.
   - A ground status ring per worker using five semantic colors: accent = selected, info = thinking/talking, success = active tool, warning = needs-input, muted = stale.
   - Needs-input gets a tall amber light beam (additive, about 40 units) visible from city view. It pulses slowly and is static under reduced motion.
   - District window emissive intensity follows the count of fresh active workers there, eased over about 1.5 s.
   - A one-shot boat departs the Port on a ship event.
   - Black-hole rotation speed scales gently with the active count. It is decorative, and the docs must say so.
7. **HUD.**
   - At narrow widths the inspector becomes a bottom sheet of at most 40% height, so the focused worker stays visible.
   - Fix the 3D district labels drawing over the Districts menu: scene labels must sit below HUD layers.
   - Add a Live / Simulation source switch that is inert until Lane A merges, with simulation labelled as today.
8. **Tests:** graph and planner tests, hysteresis, lifecycle transitions, slot assignment, render cap ordering, and the existing scenario tests updated.

## Integration (after both lanes merge)

Lane B or a short third run wires `useCityFeed` into `prototype-main.tsx`. Live is the default when `/api/city` answers; otherwise the scene falls back to simulation with the existing disclosure.

## Constraints for every builder

- Disk is nearly full. Run no `npm install` and add no dependencies. `node_modules` is a symlink; never replace or delete it.
- Keep added files small. Delete any build output you create.
- Run no dev server, no `vite preview` and no browser. Verify with `npx tsc -b`, `node --test …` and, if useful, one `npx vite build` of `prototype.html` into a temp outDir that you delete afterwards.
- Shell access is limited to: `npx tsc`, `node --test`, `node --experimental-strip-types --test`, `npx vite build`, `rm -rf .tmp-build`, and `git status|diff|log|add|commit`. File access outside your worktree is denied.
- Commit each coherent change on your lane branch with a clear message. Do not push; the lead reviews and pushes.
- Public repository: no personal paths, ids, emails, customer names or copied log content in code, fixtures or docs.
- Finish with a short report: commits (sha + subject), tests run with results, known gaps, and anything that needs a visual check in a browser.
