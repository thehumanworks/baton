# ADR 0002 — Terminal session persistence and reattachment

- **Status**: Accepted
- **Date**: 2026-04-21
- **Deciders**: Baton maintainers

## Implementation status

Implemented for the Electron desktop runtime:

- PTYs now live in a detached local session host.
- Terminal windows persist their `terminalId` and reattach on restore.
- Quitting/reopening Baton reattaches to the same live shell session.
- Workspace/layout metadata is saved in an app-owned JSON store under `userData` and mirrored to renderer `localStorage` as a cache.
- CI/automation has a built-runtime verification script that proves PID-stable detach/reattach behavior.

Still deferred:

- WebSocket attach/reattach support for the web/mobile backend
- crash-recovery hardening, GC/TTL, and optional disk-backed scrollback

## Context

Baton already preserves a useful subset of state today, but only inside a
single app lifetime:

- `src/renderer/src/persistence.ts` stores workspace layout in renderer
  `localStorage`.
- That same file intentionally strips `terminalId` and rewrites terminal
  status to `'starting'` when state is saved or loaded, so a relaunch
  respawns fresh shells instead of reconnecting to existing ones.
- `src/main/index.ts` keeps live `node-pty` instances in an in-process
  `Map` and kills them on `before-quit` and `window-all-closed`.
- `server/pty-websocket.ts` does the same per WebSocket connection and
  kills terminals when the socket closes.
- `BufferedTerminalClient` keeps a scrollback buffer in memory, which is
  enough to make workspace switching feel stateful while the renderer and
  PTY owner are both still alive.

That means the current product can preserve **layout** across reloads and
can preserve **live shell state** only while the owning process stays up.
It cannot satisfy the stronger expectation that a user can quit Baton,
relaunch it, and continue the exact same shell processes.

A tempting shortcut is to "spawn terminals outside the main process and
reconnect by PID later". That is not sufficient. A PID alone does not let
Baton recover the PTY master, the controlling terminal, the buffered
output, or the resize/data plumbing. In the common case, when the PTY
owner exits, the shell receives SIGHUP / console teardown and exits as
well. Even if the child process survives briefly, `node-pty` does not
provide a supported "reattach to existing PTY by PID" flow.

We therefore need to separate two different product promises:

1. **Workspace persistence** — canvas, terminal window geometry, active
   workspace, settings, and the mapping from each window to its backing
   session.
2. **Live shell persistence** — the actual PTY-backed process tree,
   scrollback, and the ability to detach the UI and later reattach.

We also need to be explicit about scope:

- **Realistic and achievable**: switch workspaces, close Baton, reopen
  Baton, and resume the same live terminal sessions on the same machine
  and same user account.
- **Not generally realistic for arbitrary shells**: survive OS reboot,
  logout, or daemon crash with zero loss. That requires either the OS to
  keep the process tree alive or a shell/session multiplexer such as
  `tmux`/`zellij` on Unix-like hosts.

## Decision

### 1. Introduce a long-lived Baton Session Host

Baton should own PTYs in a **separate local background process** rather
than inside the Electron main process or a per-WebSocket-connection
handler.

This Baton Session Host is the sole owner of:

- `node-pty` instances
- the terminal/session registry
- scrollback ring buffers
- session lifecycle and garbage collection
- local IPC for attach / detach / write / resize / close

Electron becomes a client of the host, not the PTY owner.

This is the minimum architecture that makes "close app, reopen app,
resume same shell" reliable. Merely detaching the child by PID is not.
The PTY owner itself must outlive the UI.

### 2. Persist stable workspace + session identities

Each terminal window needs two separate identities:

- `terminalWindowId`: the canvas/window object
- `sessionId`: the live terminal session owned by the Session Host

Each workspace persists its terminal windows and references the
`sessionId` for each retained shell. On relaunch, Baton restores the
workspace graph first, then asks the Session Host to reattach each saved
`sessionId`.

Explicit close semantics become:

- **Close terminal window**: kill that `sessionId`, remove it from the
  workspace, delete its retained metadata.
- **Delete workspace**: kill all sessions attached to that workspace and
  remove their windows.
- **Quit/close Baton UI**: detach clients only; do **not** kill sessions.

### 3. Use an app-owned durable state store, not renderer localStorage

Workspace state should move out of renderer `localStorage` into an
app-owned store under `app.getPath('userData')`.

For Baton's current scale, the recommended shape is:

- one versioned manifest file for workspace/session metadata, written
  atomically (`tmp` + rename)
- optional per-session transcript/ring-buffer files if disk-backed
  scrollback is desired later

A single-writer daemon/process keeps this simple and reliable without
immediately forcing SQLite into the packaging story. If future needs add
multi-process readers, query-heavy views, or large session indexes,
SQLite remains a valid upgrade path.

### 4. The Session Host speaks local-only IPC with stable session ids

Use a local transport only:

- Unix domain socket on macOS/Linux
- named pipe on Windows

Requirements:

- same-user-only access
- ephemeral auth token or OS-level path permissions
- versioned protocol
- idempotent `attach`, `detach`, `close`, and `listSessions`
- a session record that includes at least:
  - `sessionId`
  - `workspaceId`
  - shell label / shell id
  - launch cwd
  - last-known cwd (best effort)
  - PID
  - exit status
  - timestamps (`createdAt`, `lastAttachedAt`, `lastOutputAt`)

Recommended RPC surface:

- `createSession`
- `attachSession`
- `detachSession`
- `writeSession`
- `resizeSession`
- `closeSession`
- `listSessions`
- `getSessionBuffer`

### 5. Retain enough scrollback to make reattachment feel native

The Session Host should keep an in-memory ring buffer per session and
replay it to newly attached renderer clients before switching them to the
live data stream.

This keeps the existing "switch workspace and see prior output" UX, but
moves it to the durable session owner instead of the renderer.

Disk-backed scrollback is optional in phase 1. It improves recovery from
Session Host crashes, but it is not required for app-close/app-reopen
reattachment.

### 6. Track cwd via shell integration, not process guessing alone

If Baton wants titles and workspace summaries to reflect the shell's
current directory after reattach, the reliable path is lightweight shell
integration that emits cwd changes (for example via OSC 7 / prompt hooks)
rather than trying to infer cwd from arbitrary child PIDs.

Fallback order:

1. shell-reported cwd
2. session launch cwd
3. no cwd shown

### 7. Offer optional Unix multiplexer support for "maximum survival"

For macOS/Linux, Baton may optionally launch shells inside `tmux` or
`zellij` when installed. That is **not** the baseline architecture, but
it is the best available answer for users who want sessions to survive
more than a Baton UI restart.

Why optional, not mandatory:

- not available by default on Windows
- adds a second layer of lifecycle semantics users must understand
- changes keybindings and shell startup assumptions

Recommended positioning:

- **Baseline guarantee**: Baton Session Host survives Baton UI restarts.
- **Enhanced guarantee on Unix**: Baton + `tmux`/`zellij` can survive
  some Session Host failures and app upgrades more gracefully.

## Consequences

### Positive

- Baton can genuinely resume the same live shell after app relaunch.
- Workspace switching becomes a detach/reattach operation rather than a
  renderer-local illusion.
- Terminal lifecycle semantics become intuitive: only explicit close or
  workspace deletion kills the shell.
- The WebSocket bridge and Electron runtime can converge on the same
  session model instead of each owning PTYs separately.
- Baton gains a clean seam for future multi-window or remote-control
  features.

### Negative / trade-offs

- Adds a background process and protocol to maintain.
- Requires careful cleanup of orphaned sessions and stale sockets.
- Windows needs extra lifecycle care so the Session Host is not dragged
  down with Electron's process tree or Job Object.
- App upgrades must account for an already-running host using an older
  protocol version.
- True persistence across OS reboot is still outside the baseline
  guarantee.

## Alternatives considered

1. **Keep localStorage + respawn shells on launch.** Rejected. Good
   enough for layout restore, not good enough for live-session resume.
2. **Detach shell processes and recover by PID later.** Rejected. The
   PTY/control-terminal problem remains unsolved.
3. **Store PTYs in Electron main only.** Rejected. Quitting Electron
   still kills the PTY owner.
4. **Always wrap every shell in `tmux`.** Rejected as the baseline.
   Strong on Unix, poor cross-platform fit, and too opinionated for the
   default UX.
5. **SQLite first for everything.** Deferred. Viable later, but not
   necessary for the first durable single-writer architecture.

## Rollout

### Phase 1 — make the state model ready

- Move workspace persistence from renderer `localStorage` to an
  app-owned store in `userData`.
- Add `sessionId` to terminal window state.
- Introduce backend APIs around session lifecycle (`create`, `attach`,
  `detach`, `close`, `list`) even if they are temporarily satisfied by
  the current in-process owner.
- Stop persisting only renderer-local `terminalId` values.

This phase improves reliability and reduces renderer ownership, but it
still does **not** satisfy full app-close/app-reopen resume by itself.

### Phase 2 — extract the Session Host

- Run the PTY owner as a detached Baton background process.
- Switch Electron and the web bridge to that local IPC protocol.
- Reattach saved `sessionId`s on startup.
- Kill sessions only on explicit close/delete or retention-GC.

This is the phase that satisfies the main product expectation.

### Phase 3 — harden recovery

- Add disk-backed scrollback if desired.
- Add shell integration for cwd tracking.
- Add orphan/session TTL and explicit "resume last session" UX.
- Optionally add `tmux` / `zellij` integration on Unix hosts.

## Acceptance criteria for the eventual implementation

1. Switching away from a workspace and back reattaches to the exact same
   live shell session.
2. Quitting Baton and relaunching Baton reattaches to the exact same
   live shell session, with prior scrollback visible.
3. Closing a terminal window kills only that terminal's session.
4. Deleting a workspace kills only sessions owned by that workspace.
5. If a session exited while Baton was closed, the relaunched UI shows it
   as exited rather than silently respawning a fresh shell.
6. If the user reboots the machine, Baton restores the layout and can
   optionally offer to start fresh shells, but it must not claim that the
   old interactive processes were preserved.
