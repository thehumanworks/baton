# Session persistence — verification plan

Covers the eventual implementation of ADR 0002 end-to-end: durable
workspace state, detached PTY ownership, app relaunch reattachment, and
explicit session lifecycle semantics.

Run this after any change that touches:

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/shared/terminal-types.ts`
- `src/renderer/src/persistence.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/TerminalWindow.tsx`
- `src/renderer/src/services/terminalClient.ts`
- any future Session Host / local IPC files
- `server/pty-websocket.ts` if it is adapted to the shared session model

## Preflight: automated gates

```bash
bun test
bun run typecheck
bun run build
bun run verify:session-persistence
```

Expected: tests pass, TypeScript exits 0, the desktop bundles build
cleanly, and the verification script proves that a terminal PID survives
client disconnect + reattach while preserving buffered output.

---

## Scenario 1 — Workspace switch preserves the same live shell

### Preconditions

1. Launch Baton.
2. Create workspace A and workspace B.
3. In workspace A, spawn one terminal.
4. In that terminal, run:

```bash
printf 'pid=%s\n' "$BASHPID" 2>/dev/null || echo "pid=$$"
pwd
sleep 9999
```

5. Note the visible PID and current directory.

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Switch to workspace B. | Workspace A disappears from view. |
| 2 | Spawn a different terminal in workspace B. | A new, distinct session appears. |
| 3 | Switch back to workspace A. | The original shell is still present. |
| 4 | Inspect the terminal in workspace A. | The prior scrollback is visible, including the noted PID and cwd. |
| 5 | Interrupt the long-running command in workspace A (`Ctrl+C`). | Control returns to the same shell prompt. |

### Pass criteria

Workspace switching reattaches to the same live shell rather than
spawning a fresh one.

---

## Scenario 2 — Quit Baton and relaunch Baton resumes the same shell

### Preconditions

1. Start from scenario 1 or create a fresh workspace with one terminal.
2. In the terminal, run a command that proves continuity, for example:

```bash
echo "marker=$(date +%s)"
export BATON_SESSION_TEST=alive
printf 'pid=%s\n' "$BASHPID" 2>/dev/null || echo "pid=$$"
```

3. Note the marker and PID.

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Quit Baton completely. | The UI closes. |
| 2 | Relaunch Baton. | The same workspace layout reappears. |
| 3 | Reopen the saved terminal/session. | Prior scrollback is visible immediately or after attach replay. |
| 4 | Run `echo "$BATON_SESSION_TEST"`. | Prints `alive`. |
| 5 | Run the same PID command as before. | The PID matches the one from before quit. |

### Pass criteria

A full Baton quit/relaunch preserves the same live shell session.

---

## Scenario 3 — Close terminal kills only that session

### Preconditions

1. Launch Baton.
2. In one workspace, spawn terminal A and terminal B.
3. In each terminal, print its PID.

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Close terminal A from the window chrome. | Terminal A disappears. |
| 2 | Inspect terminal B. | Terminal B remains alive and interactive. |
| 3 | Quit Baton and relaunch. | Workspace restores with terminal B only. |
| 4 | Reattach terminal B. | Terminal B still has the same PID as before. |

### Pass criteria

Explicit close kills only the selected terminal's session.

---

## Scenario 4 — Delete workspace kills only that workspace's sessions

### Preconditions

1. Launch Baton.
2. Workspace A contains at least one live terminal.
3. Workspace B contains at least one different live terminal.
4. Record the PIDs in both workspaces.

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Delete workspace A. | Workspace A disappears. |
| 2 | Switch to workspace B. | Workspace B still exists. |
| 3 | Inspect the terminal(s) in workspace B. | They remain interactive. |
| 4 | Quit Baton and relaunch. | Workspace B restores; workspace A does not. |
| 5 | Re-check the PID in workspace B. | It matches the value from before workspace A was deleted. |

### Pass criteria

Workspace deletion kills only the deleted workspace's sessions.

---

## Scenario 5 — Exited sessions do not silently respawn

### Preconditions

1. Launch Baton.
2. Spawn a terminal and note its PID.
3. Exit the shell normally (`exit`).

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Observe the terminal before quitting Baton. | It shows exited status. |
| 2 | Quit Baton and relaunch. | Workspace layout restores. |
| 3 | Inspect the same terminal window/session entry. | It still shows exited state. |
| 4 | Compare with a freshly spawned terminal. | Only the fresh spawn gets a new PID/new shell. |

### Pass criteria

Exited sessions remain exited on restore; Baton must not silently replace
them with new shells.

---

## Scenario 6 — Machine reboot is handled honestly

### Preconditions

1. Launch Baton and create at least one live terminal.
2. Record its PID and print an obvious marker.
3. Reboot the machine.

### Steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Relaunch Baton after login. | Workspace layout restores. |
| 2 | Inspect the saved terminal/session entry. | Baton does not claim the old process survived. |
| 3 | If Baton offers resume/restart actions, use them. | A new shell starts explicitly as a fresh session. |

### Pass criteria

After reboot, Baton restores layout and communicates that old live
processes are gone unless an external multiplexer preserved them.
