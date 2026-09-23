# Mythic Agent Command Center

A standalone, read-only visualization of local agent telemetry placed as agent markers inside the copied **Villages** 3D map. The WebGL scene makes status and location glanceable; the adjacent HTML roster is the accessible source of operational detail.

The project is independent. It does not read, write, import, or depend on the IPAM repository.

## Run

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. `npm run dev` starts Vite and the read-only telemetry proxy, both bound to loopback. The proxy discovers the installed `codex` and `opencode` CLIs without provider passwords, and reads Claude Code's local session metadata directly. Choose **Explore simulation** only when you intentionally want clearly labelled synthetic data.

Production bundle:

```bash
npm run build
npm run preview
```

The preview command serves the UI only. Run `npm run telemetry` separately if a built deployment needs localhost telemetry.

## UX and hierarchy

- **Great Hall:** Astra, the main lead and sole canonical acceptance authority.
- **War Council/watchtower:** Grok 4.7 owns integration/spec critique, adversarial API/schema review, negative-test design, dependency detection, and ambiguity detection. Grok 4.6 is its scout.
- **Forge yard:** Terra is delivery sublead. Two DeepSeek workers are leaf builders; Sol is the difficult, cross-cutting escalation model.
- **Proving grounds:** Luna performs independent QA and test execution.
- **Rune hall:** evidence, lineage, and accounting.
- **Oracle shrine:** Fable reviews milestones as an adviser only.
- **Portability dock:** Spencer is a portability lane owner, shown as an ordinary worker in the roster.

The hierarchy never nests more than two levels below the main lead. Each district wears a distinct uniform, and agents animate as village characters: active agents walk a closed route with swinging arms and legs, review agents bend and inspect, needs-input and failed agents raise a signalling arm, completed agents mark it with a one-shot ground-returning hop before settling, and waiting agents idle with a slow turn. Historical sessions (real, but outside the freshness window) loop a calm ambient gesture without reading as working; stale and unknown records rest in a neutral pose. This scene motion is illustrative and is not evidence of verified model activity. `prefers-reduced-motion` disables scene motion and CSS loops.

### Hall staging

Which hall a live worker appears in is **timestamp-based scenery, not a job claim**:

- Every chat updated within the last hour is staged in the Great Hall. This overrides any earlier keyword/role routing, because timestamp is the chosen visual grouping.
- All older live chats are sorted by `updatedAt` descending (ties broken by id) and distributed across the six other halls, filling empty halls first and then balancing counts. An older chat's prior heuristic routing is not preserved.
- When nothing is recent, the freshest older chat is reserved for the Great Hall so it never reads as empty.
- A roster too small to fill the halls shows the true zero counts; no worker is ever synthesized. With the current adapters, 22 real records stage all seven halls as long as at least six are older.
- Staging changes only the displayed hall. Provider, model, status, activity, and id are untouched: a staged hall is labelled `staging` in the roster and shows `Shown in <hall> · staging placement` in the inspector instead of the hall's authored role kicker. Scene, roster, and inspector always show the same hall.
- Simulation commits the demo roster verbatim, so its authored halls are never staged from live timestamps. A stale snapshot keeps the halls it was already shown with.

### Past sessions

The server retains a wider window of the scoped project's history than it reports as current, so previously observed sessions still appear in their halls:

- `TELEMETRY_RETENTION_MINUTES` (default `10080`, seven days) bounds the provider read. It replaces the older six-hour `TELEMETRY_RECENCY_MINUTES`.
- `TELEMETRY_LIST_LIMIT` (default `200`) is a finite cap on the one-page provider listing; the provider's own `updatedAt` decides what is retained, so this is not an unbounded scanner.
- The client keeps a six-hour freshness distinction. A record older than that is marked `historical`, its runtime `active` status is demoted to `waiting`, and it is excluded from the active and attention counts. Explicit `complete` and `failed` outcomes remain but read as past in the roster and inspector. `stale` still means a failed refresh and stays separate.
- Only current, non-historical sessions count as active. Past sessions are never synthesized in live mode, and simulation data is never mixed into live records.

## 3D map attribution

The scene background is the **Villages** 3D map from [`andrinr/villages`](https://github.com/andrinr/villages), licensed **AGPL-3.0**. The copied map assets (`public/models/models3.gltf`, `models3.bin`, the four referenced PNGs), a local Draco decoder (`public/draco/`), and the display typeface (`public/fonts/Chillax-Variable.ttf`, self-hosted with no CDN request) are redistributed under that license; the full license text is retained at `public/models/LICENSE`. Our seven districts are anchored to named nodes in the map, and every agent marker is our own overlay. The Svelte UI, scripts, runtime, and `public/pub` build from the reference are not used.

## Telemetry architecture

```text
codex app-server --stdio (persisted metadata) -----------+
                                                         |
opencode api reads + filtered event subscription -------+-> Node metadata proxy -> normalized records -> React
                                                         |
claude-code local JSONL (metadata fields only) ---------+
```

Every record is normalized to:

```ts
{
  id, parentId, provider, model, title, status, activity,
  updatedAt, usage?, branch?, role?, district
}
```

The browser receives only safe metadata. It never receives server passwords, provider keys, prompt text, message bodies, customer content, tool arguments, or tool output.

### OpenCode adapter

The adapter uses the installed CLI's authenticated read operations:

- `opencode api session.list --param directory=<COMMAND_CENTER_SCOPE_CWD>` when a scope is configured. Pushing the scope down as a directory filter keeps the read to the scoped project and avoids the oversized unscoped listing; without a scope the adapter falls back to the plain `session.list` and reports a truncated payload as a read failure.
- `opencode api session.list --param parentID=<session-id> --param directory=<COMMAND_CENTER_SCOPE_CWD>` for direct children. The same scope filter is pushed to the child read, and the final inventory is re-checked against the scope. Child reads are capped at 64 roots and run at most four at a time; results are cached by parent id and updated timestamp for about a minute so a 15-second poll does not respawn every child read, while a changed parent, an expired entry, or any failed read is never served from cache. Reaching the cap or failing a read is reported as a `limited` diagnostic, and a failed child read never removes its parent root from the inventory.
- `opencode api event.subscribe`; only allowlisted event **types** trigger a metadata refresh.

No prompt, message, todo text, tool input, or tool output is requested. Parent relationships appear only when OpenCode supplies `parentID`; otherwise the UI says that the parent was not reported.

Scope the reads in `.env`:

```bash
cp .env.example .env
printf '%s\n' \
  'COMMAND_CENTER_SCOPE_CWD=/absolute/path/to/project' \
  'COMMAND_CENTER_LEAD_THREAD_ID=<codex-thread-id>' >> .env
npm run dev
```

The project uses Node's local `.env` loader. Never put secrets in `VITE_*` variables; this integration does not require a provider password.

This machine was inspected read-only on 2026-09-22:

- OpenCode is installed at `/opt/homebrew/bin/opencode`.
- Installed version: `v2.0.14`.
- The configured credential label is `OpenCode Go`.
- `opencode models` returned no advertised model IDs matching Terra or `gpt-5.6`.

Therefore an exact Terra provider/model ID is **not verified**. The command center shows Terra as unavailable and does not estimate OpenCode Go quota. OpenCode’s supported model syntax is `provider/model#variant`; never guess the ID.

For later implementation work, verify the ID first, then use this guarded command form from the intended repository directory:

```bash
TERRA_MODEL_ID="$(opencode models | rg -i 'terra|gpt-5[.]6-terra' | head -n 1)"
test -n "$TERRA_MODEL_ID" || { echo 'Terra model ID is not advertised; refusing to run.' >&2; exit 1; }
opencode run --model "$TERRA_MODEL_ID" "<bounded implementation request>"
```

That command is documented for later use only. It was not run, and this project did not begin IPAM implementation.

### Codex adapter

The adapter starts the official read-only JSONL transport itself:

```bash
codex app-server --stdio
```

It initializes the protocol and issues `thread/list` reads only, scoped by `COMMAND_CENTER_SCOPE_CWD` and, when configured, `ancestorThreadId`. Notification payloads containing agent text, reasoning, or command output are opted out.

Important limitation: a separately spawned app-server can read persisted thread metadata, but it cannot observe the Codex desktop process's in-memory active status on this machine. `codex app-server proxy` currently reports that the default desktop control socket does not exist. The UI therefore marks Codex **limited**, labels `notLoaded` records as persisted metadata, and never calls them live-active. OpenCode records still remain visible and current.

The [official Codex app-server protocol](https://developers.openai.com/docs/app-server) documents the JSONL handshake, `thread/list`, runtime status fields, and child/ancestor filters used here.

### Claude Code adapter

Claude Code stores one local JSONL transcript per session under `~/.claude/projects/<encoded cwd>/`. The adapter parses those local files, but extracts and forwards only a bounded set of metadata fields:

- It narrows the scan to the scoped project directory plus worktrees whose encoded directory name shares the scope's basename, then verifies each transcript's own `cwd` is the exact scope or a matching-basename worktree under `~/.codex/worktrees`. An unrelated same-named project is skipped rather than mis-attributed.
- Per transcript it uses only the line type, `sessionId`, `cwd`, chat-turn timestamps, and an assistant line's `message.model`. The whole JSONL line is parsed locally, but prompt text, message bodies, tool arguments, and tool output are never used, stored, or forwarded.
- A file with no real user or assistant turn (for example a system/cost-only record) is skipped rather than shown as a chat.
- Status is always `unknown`: a persisted transcript proves a past conversation, not a running process, so no live-active state is inferred. The real model and the last user/assistant turn timestamp are preserved when the transcript supplies them; system, queue, and cost lines cannot move the updated time.
- The title is a neutral workspace/task slug plus a short session id. Only a folder name is used, never a full local path.
- Reads are bounded: at most `TELEMETRY_LIST_LIMIT` of the freshest files, a 12 MB per-file cap, and four concurrent reads. Results are cached by file mtime and size because the client polls every 15 seconds, so an unchanged transcript is never re-read.
- A skipped, unreadable, oversized, or malformed transcript is surfaced as a `limited` diagnostic instead of silently disappearing. With no `COMMAND_CENTER_SCOPE_CWD`, the adapter stays disconnected rather than scanning the whole home directory.
- `~/.claude/history.jsonl` is deliberately not read, because it can contain prompt text.
- No subscription allowance, quota, or model id is inferred.

Only metadata fields are used or forwarded, and the adapter is read-only and kept separate from the live runtime adapters; it does not claim that a Claude Code process is running. Its records flow through the existing roster, inspector, diagnostics, and scene with the shared provider label; no Claude-specific scene styling is added yet.

## Security boundary

- Both servers bind to `127.0.0.1`.
- Provider credentials are handled by the already-authenticated local CLIs and never enter the Vite bundle.
- The Claude Code adapter parses local transcript lines but forwards only metadata fields: prompt/message text, tool output, and full local paths never cross the loopback boundary.
- There are no task mutation, prompt submission, model execution, permission-response, share, delete, or write routes.
- No provider response is logged. Error messages contain only the provider/path/status boundary.
- OpenCode allowance is displayed only if a documented API supplies it. This adapter deliberately does not infer it from token activity.
- Simulation is opt-in, persistent on-screen, and visually watermarked.

## Source map

- `src/components/WorldScene.tsx` — Villages 3D map, agent markers, hover data, and state motion.
- `src/components/OperationsPanel.tsx` — accessible roster, detail view, and connection states.
- `src/hooks/useTelemetry.ts` — connection state, explicit simulation, filtered refresh events.
- `server/adapters/codex.mjs` — Codex app-server reads.
- `server/adapters/opencode.mjs` — OpenCode CLI reads and event subscription.
- `server/adapters/claude.mjs` — read-only Claude Code local transcript metadata.
- `server/safety.mjs` — loopback enforcement and safe metadata helpers.

## Repair status (unverified, 2026-09-23)

A source-level repair pass was applied on 2026-09-23. It has **not** been built, typechecked, linted, or observed in a running browser, and no provider was queried. Everything in this section is unverified.

Client and scene:

- The detail panel can stay closed; the first record is auto-selected once, and a selection whose record disappears is cleared without jumping to another worker.
- A persistent Live/Simulation source control replaced the one-way simulation entry, so simulation can be left as well as entered. `partial` snapshots are labelled "Partial live snapshot" rather than a scenario preview.
- Live reads are coalesced to one in-flight request with a single trailing refresh; superseded, stale-source, and unmounted responses are ignored. A transport failure retains the last snapshot, its timestamp, and its diagnostics, marks records stale, shows current activity counts as unavailable, and rests their scene motion.
- Worker slots are keyed by record identity, so survivors do not move when siblings reorder, arrive, or leave. Bodies are grounded on a separate animated transform, completion motion is bounded, and unknown/reduced-motion states rest neutral.
- An orbit drag no longer selects a worker (pointer-movement threshold), the cursor is released when a worker unmounts, and the first worker row sits clear of the building footprints.

Telemetry normalization and aggregation:

- OpenCode no longer treats a missing status as active. Only affirmative metadata produces `active`; otherwise the status is `unknown`, and activity text is derived from the normalized status instead of always saying "running".
- Failed child-session reads are counted and the snapshot is marked `limited`, so a skipped child read no longer yields an apparently complete inventory.
- Aggregate mode is derived from per-provider diagnostic states: a success alongside any error, disconnected, or limited provider is `partial`; no success with an error is `error`; no success with only disconnected providers is `disconnected`; and a successful empty read remains a valid snapshot.
- Simultaneous `/api/telemetry` requests share one in-flight snapshot promise. Each client still receives its own filtered SSE stream.
- The OpenCode event subscription now runs as a spawned child with a bounded pending line buffer rather than a buffered `execFile`. An oversized or malformed frame ends the stream into the existing unavailable/reconnect path, and the SSE route aborts on the response close event rather than the incoming-request close event.
- Codex parent links use only the explicit parent field; fork provenance and shared session IDs are no longer treated as supervising parents.
- Raw CLI stderr and protocol error text are no longer returned to the browser. Failures surface fixed provider text plus an allowlisted category (`executable unavailable`, `timeout`, `read failed`).

These notes do not supersede the historical read-only 2026-09-22 inspection recorded above; that section describes the machine state at that earlier time.

## Unresolved configuration questions

- `COMMAND_CENTER_LEAD_THREAD_ID` points at the earlier task `mainLead 1- phase2`, while a newer task titled `Mainlead2.0 - Phase2` also exists. This mismatch was surfaced but not resolved; lead configuration and ownership were not changed.
- `inScope()` accepts any directory whose basename matches the configured scope, which can include a worktree or an unrelated same-named project. The scope policy was intentionally left unchanged, because widening or narrowing it is a user decision.

## What this does not claim

A successful local build proves only that this standalone UI compiles. The diagnostics panel separately reports actual provider connectivity, records received, last refresh, and connector limitations. It does not infer model IDs, parent links, subscription allowance, portability, or production readiness.
