# Shell selection — adversarial replay

Covers ADR 0001 end-to-end: the shell registry, preferences
persistence, workspace overrides, first-run prompt, and the WSL spawn
path. Run this after any change that touches:

- `src/shared/shell-registry.ts`
- `src/main/shell-resolver.ts`
- `src/main/shell-detection.ts`
- `src/main/preferences.ts`
- `src/main/index.ts` (shell or preferences IPC)
- `server/pty-websocket.ts` (shell or `list` protocol)
- `src/renderer/src/services/preferencesContext.tsx`
- `src/renderer/src/components/Modal.tsx` (the three new modals)
- `src/renderer/src/components/ShellPicker.tsx`
- `src/renderer/src/components/TerminalWindow.tsx`

## Preflight: automated gates

Run before touching anything manual. All three must be green.

```bash
bun test
bun run typecheck
bun run build
```

Expected: 76+ tests pass, tsc exits 0, electron-vite builds all three
bundles (main, preload, renderer) without errors.

## Preferences file path cheat sheet

| OS      | Path                                                                |
|---------|---------------------------------------------------------------------|
| macOS   | `~/Library/Application Support/Baton/preferences.json`              |
| Linux   | `~/.config/Baton/preferences.json`                                  |
| Windows | `%APPDATA%\Baton\preferences.json`                                  |

All scripts below assume `PREFS` is shorthand for the correct path for
your host.

---

## Scenario 1 — First-run prompt on Windows

**Host required**: Windows 10 or 11. `[SKIPPED: wrong host OS]` on
macOS/Linux.

### Preconditions

1. `rm "$PREFS"` (or delete via Explorer). Confirm the file is absent.
2. PowerShell is installed (always true on Windows).
3. If PowerShell 7 (`pwsh.exe`) is installed, note that — scenario 1c
   depends on it.

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Launch Baton via `bun run dev` or the built exe.                    | First-run modal appears with title "Pick your default shell".            |
| 2 | Inspect the dropdown contents.                                       | At minimum: PowerShell; pwsh if installed; Command Prompt; one `WSL · <distro>` per installed distro. |
| 3 | Dismiss the modal with "Decide later".                               | Modal closes. `PREFS` is still absent on disk (decide-later does not write). |
| 4 | Spawn a terminal on the canvas.                                      | A working shell opens. Window title reads `<label> · <cwd>` where `<label>` is whatever `'auto'` resolved to (pwsh if installed, else PowerShell, else cmd). |
| 5 | Quit Baton. Relaunch.                                                | **First-run modal appears again**, because `wasFreshlyCreated` is still true. This is intentional: "decide later" does not count as a choice. |
| 6 | This time, pick PowerShell 7 (or PowerShell if pwsh absent). Save.   | Modal closes. Inspect `PREFS`: file exists with `{"version":1,"terminal":{"defaultShellId":"pwsh"}}` (or `"powershell"`). |
| 7 | Quit Baton. Relaunch.                                                | **First-run modal does not appear.** The saved choice is honoured.       |
| 8 | Spawn a terminal.                                                    | Window title reflects the pinned shell label.                             |

### Pass criteria

All eight steps produce the expected outcome. Any deviation — especially
step 7 re-prompting, or step 6 failing to write the file — is a bug.

---

## Scenario 2 — App default on macOS/Linux (no first-run prompt)

**Host required**: macOS or Linux.

### Preconditions

1. `rm "$PREFS"`.
2. `$SHELL` is set (`echo $SHELL` — should be `/bin/zsh`, `/bin/bash`,
   or similar).

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Launch Baton.                                                        | **No first-run modal.** The main UI renders normally.                    |
| 2 | Spawn a terminal.                                                    | A working shell opens. Window title reflects `basename($SHELL)`.          |
| 3 | Open Preferences (sidebar footer button, expanded mode).             | `AppPreferencesModal` opens. The "Default shell" select shows "Auto-detect (\<resolved label\>)" as the first option, selected. |
| 4 | Inspect the option list.                                             | Auto-detect row, then every entry from `detectShells()` on your box (zsh, bash, fish if installed, etc.). |
| 5 | Change the default to a different installed shell. Save.             | `PREFS` is written. Subsequent terminal spawns use the new shell.         |
| 6 | Re-open Preferences. Change back to "Auto-detect". Save.             | `PREFS` contains `"defaultShellId":"auto"`. Spawns return to `$SHELL`.    |

### Pass criteria

Steps 1 and 5 are the load-bearing ones. Step 1 catches "we accidentally
trigger the first-run flow on macOS". Step 5 catches "preferences don't
actually take effect until restart".

---

## Scenario 3 — Workspace override wins over app default

**Host required**: any. The workspace override is platform-agnostic.

### Preconditions

1. App default set to something concrete (not `'auto'`) via
   Preferences. Pick shell A.
2. At least one other shell installed. Call it shell B.
3. Two workspaces exist; create a second if only one is present.

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | In workspace 1, spawn a terminal.                                   | Shell A launches (inherits app default).                                  |
| 2 | Open workspace 1 Settings. In "Shell", pick shell B. Save.          | Settings close. Workspace state in localStorage reflects `shellId: <B>`. |
| 3 | Spawn another terminal in workspace 1.                              | **Shell B launches**, overriding the app default.                        |
| 4 | Switch to workspace 2. Spawn a terminal.                            | **Shell A launches.** Workspace 2 has no override, so it inherits app default. |
| 5 | Open workspace 1 Settings again. Change "Shell" back to "Use app default". Save. | `shellId` is removed from that workspace's settings.          |
| 6 | Spawn in workspace 1.                                               | Shell A launches again.                                                   |

### Pass criteria

Step 3 proves the precedence order works. Step 4 proves the override is
scoped correctly — a common bug is leaking workspace-level state into
siblings. Step 5 proves "Use app default" is a real clear operation,
not a disguised pin to shell A.

---

## Scenario 4 — Uninstalling the saved shell

**Host required**: Windows preferred (uninstalling pwsh is
straightforward); Linux acceptable (uninstall fish). Skip on macOS
unless you can cleanly remove a non-default shell.

### Preconditions

1. App default pinned to a shell you can uninstall (`pwsh` on Windows,
   `fish` on Linux).
2. `PREFS` contains that concrete id.

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Uninstall the pinned shell (e.g. `winget uninstall Microsoft.PowerShell`, or `sudo apt remove fish`). | The executable is no longer on PATH. Verify with `where pwsh` / `which fish`. |
| 2 | Relaunch Baton.                                                      | The app **does not crash**. The main UI renders.                         |
| 3 | Spawn a terminal.                                                    | A shell opens. Under current behaviour, resolving a missing id falls through to `'auto'`, so you get the platform's auto-detected shell. **This should not throw.** |
| 4 | Open Preferences.                                                    | Modal opens. The "Default shell" select shows **"Auto-detect"** highlighted (because the old id isn't in the registry). |
| 5 | Inspect the window title of the terminal from step 3.               | Title reflects the fallback shell, not the removed one.                   |

### Known gap

The plan called for a "saved shell is no longer available" notice in
this case. That UI is not yet built. If you hit this scenario during
verification, record it as a follow-up rather than a regression. The
critical invariant is step 2: the app must not crash, and step 3 must
not throw.

---

## Scenario 5 — WSL spawn path

**Host required**: Windows 10/11 with WSL installed and at least one
distro registered (`wsl -l -q` returns at least one line).

### Preconditions

1. `wsl.exe` on PATH.
2. At least one distro. Note its name — call it `<DISTRO>`.
3. App default set to `"wsl:<DISTRO>"` via Preferences, OR set a
   workspace override to that value.

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Spawn a terminal.                                                   | A WSL session opens showing a Linux prompt (e.g. `mish@host:/mnt/c/...$`). |
| 2 | Run `echo $PATH` inside the session.                                | The PATH reflects **the Linux side's PATH** (e.g. `/usr/local/sbin:/usr/local/bin:...`). It should **not** contain Windows-style entries like `C:\Windows`. |
| 3 | Run `echo $WSL_UTF8`.                                                | Outputs `1`.                                                              |
| 4 | Run `echo $TERM`.                                                    | Outputs `xterm-256color`.                                                 |
| 5 | Run `pwd`.                                                           | Prints the WSL-translated path of the workspace cwd (e.g. `/mnt/c/Users/mish/Development/foo`). |
| 6 | Resize the terminal window by dragging its corner.                  | The shell's `$COLUMNS` / `$LINES` update. Run `stty size` to confirm.     |
| 7 | Exit the shell (`exit`).                                             | The terminal window shows an "exited" status. No error frames in devtools console. |

### Pass criteria

Step 2 is the load-bearing security check: it confirms the strict env
hygiene from ADR 0001 is actually applied. A regression that spreads
`process.env` into the WSL spawn would leak Windows PATH here.

The strict env still needs to include the Windows host variables
`SystemRoot` and `windir` for the `wsl.exe` launcher itself. If WSL exits
with `Wsl/Service/0x8007072c`, check the unit coverage around
`resolveShell` before assuming the distro is broken.

Step 5 confirms the `--cd <windows-path>` argument is understood by
WSL. Older WSL versions do not support `--cd`; if step 5 fails with "WSL
does not recognise --cd", that is a platform-version issue worth
capturing.

---

## Scenario 6 — WebSocket bridge rejects unknown shell ids

**Host required**: any. Exercises the WebSocket server defensively.

### Preconditions

1. Start the bridge: `bun run terminal:server`.
2. Note the printed URL (default `ws://127.0.0.1:8787`).

### Steps

```bash
# Step 1: confirm 'list' returns the host registry.
bun -e '
const ws = new WebSocket("ws://127.0.0.1:8787");
ws.addEventListener("open", () => ws.send(JSON.stringify({type: "list", clientId: "c1"})));
ws.addEventListener("message", (ev) => { console.log(ev.data); ws.close(); });
'
```

Expected: a `{"type":"listed",...}` frame containing only shells
installed on your host.

```bash
# Step 2: send a bogus shellId.
bun -e '
const ws = new WebSocket("ws://127.0.0.1:8787");
ws.addEventListener("open", () => ws.send(JSON.stringify({
  type: "create", clientId: "c1", cols: 80, rows: 24, shellId: "wsl:NotARealDistro"
})));
ws.addEventListener("message", (ev) => { console.log(ev.data); ws.close(); });
'
```

Expected: a `{"type":"error","clientId":"c1","message":"Unknown shell id \"wsl:NotARealDistro\""}` frame. **No terminal is spawned.**

```bash
# Step 3: send a valid 'auto' create.
bun -e '
const ws = new WebSocket("ws://127.0.0.1:8787");
ws.addEventListener("open", () => ws.send(JSON.stringify({
  type: "create", clientId: "c1", cols: 80, rows: 24, shellId: "auto"
})));
ws.addEventListener("message", (ev) => { console.log(ev.data); });
setTimeout(() => ws.close(), 2000);
'
```

Expected: a `created` frame followed by one or more `data` frames.

### Pass criteria

Step 2 is the security-relevant one. A regression where the server
silently spawns anyway — perhaps because a future refactor replaced the
`shellRegistry.some(...)` check with a fall-through — must be caught
here.

---

## Scenario 7 — Preferences file is corruption-tolerant

**Host required**: any.

### Preconditions

Baton is running; Preferences are saved (any value).

### Steps

| # | Action                                                              | Expected                                                                 |
|---|---------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Quit Baton.                                                         | No lingering process.                                                     |
| 2 | Corrupt the file: `echo 'not json' > "$PREFS"`.                     | File is now malformed JSON.                                               |
| 3 | Launch Baton.                                                        | App starts normally. Does **not** crash. Does **not** show the first-run modal (on Windows, because `wasFreshlyCreated` is false — the file exists). |
| 4 | Spawn a terminal.                                                   | Works. Uses the `'auto'` default because corruption triggers the defaults fallback. |
| 5 | Open Preferences.                                                    | Modal shows "Auto-detect" highlighted. Save a concrete choice.            |
| 6 | Inspect `PREFS`.                                                     | The file is valid JSON again, containing the new choice.                  |

### Pass criteria

Step 3 is the survival check. Step 6 confirms the app self-heals rather
than refusing to write over a corrupted file.

---

## Replay record template

At the end of a verification pass, append a block like this to your
change's PR description:

```markdown
### Shell-selection verification (docs/verification/shell-selection.md)

- Preflight: bun test ✅ / bun run typecheck ✅ / bun run build ✅
- Host: macOS 14.5 (arm64) — Windows/WSL scenarios [SKIPPED: wrong host OS]
- Scenario 2 (macOS default): ✅
- Scenario 3 (workspace override): ✅
- Scenario 6 (WebSocket bridge): ✅
- Scenario 7 (corruption tolerance): ✅
- Follow-ups: none.
```

If a scenario fails, include the divergence rather than hand-waving it.
"Step 4 showed X instead of Y" is useful; "mostly worked" is not.
