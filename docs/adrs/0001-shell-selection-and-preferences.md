# ADR 0001 — Shell selection and preferences

- **Status**: Accepted
- **Date**: 2026-04-20
- **Deciders**: Baton maintainers

## Context

Baton spawns interactive shells in two places: the Electron main process
(`src/main/index.ts`) and the optional WebSocket PTY bridge
(`server/pty-websocket.ts`). Before this ADR, both spawners hard-coded the
shell choice through a `getDefaultShell()` helper that returned
`$SHELL` on UNIX and `ComSpec || 'powershell.exe'` on Windows, and the
`TerminalCreateRequest` wire type accepted a free-form `shell?: string`
field that either spawner would hand straight to `pty.spawn`.

Two problems arise from that shape:

1. **Windows has no OS-owned "preferred shell" signal.** macOS and Linux
   record the user's choice in `/etc/passwd` (or the Directory Services
   equivalent) and surface it through `$SHELL`, which every terminal
   emulator respects. Windows never had that concept: `ComSpec` points
   at `cmd.exe` and is really about which interpreter runs `.bat` files,
   PowerShell 7 installs alongside Windows PowerShell 5.1 without
   declaring itself the default, and WSL is not a shell at all — it is
   a wrapper (`wsl.exe`) that launches a Linux shell inside a lightweight
   VM with its own path and environment conventions. The user must be
   able to express a preference, and the app must remember it.

2. **The free-form `shell` field is unsafe and product-hostile.** The
   WebSocket variant exposes shell-spawning over a network socket gated
   only by a token; accepting an arbitrary path from the client turns
   that into remote arbitrary-binary execution with the shell user's
   rights. And because the UI has no way to enumerate what the backend
   considers a valid shell, there is no sensible way to build a picker
   on top of the field as it stands.

## Decision

### Shell registry

Introduce a `ShellDescriptor` registry that each backend (Electron main
process and WebSocket server) constructs at startup from what is actually
installed on the host. Each descriptor has a stable `id`
(`powershell`, `pwsh`, `cmd`, `wsl:Ubuntu`, `bash`, `zsh`, …), a
human-readable `label`, the executable `file` and `args` to launch, a
`kind` discriminator (`native` vs `wsl`), and backend-only metadata
(env hygiene rules, cwd translator).

The renderer never sees or sends a raw executable path. It sends only a
`shellId`. The backend is the sole authority that resolves
`shellId` → `{file, args, env, cwdTranslator}`. Unknown ids are rejected
rather than spawned.

### `'auto'` sentinel

A reserved `shellId` of `'auto'` means "resolve using the platform's
preferred-shell detection at spawn time". On UNIX that reads
`process.env.SHELL` and picks the matching descriptor. On Windows that
prefers `pwsh` if installed, else `powershell`. This keeps the
`$SHELL`-style ergonomics portable across machines and avoids baking a
concrete id into persisted settings until the user actually picks one.

### Precedence

At spawn time the effective `shellId` is resolved through:

1. Workspace override (`WorkspaceSettings.shellId`), if set.
2. App-level preference (`AppPreferences.terminal.defaultShellId`), if
   set to something other than `'auto'`.
3. Platform auto-detection (the `'auto'` resolver above).
4. Hard-coded fallback (first registry entry, else a known-safe default).

### App-level persistence

App-level preferences live in
`app.getPath('userData')/preferences.json`, which resolves to
`%APPDATA%\Baton\preferences.json` on Windows,
`~/Library/Application Support/Baton/preferences.json` on macOS, and
`~/.config/Baton/preferences.json` on Linux. The file is versioned
(`version: 1`) with a migration seam, written atomically via tmp + rename
(NTFS-safe), and never written eagerly — the default file is only
materialised when the user saves a change.

Two IPC surfaces are added: `preferences:get`, `preferences:set`, and
`terminal:list-shells`. The WebSocket protocol gains a matching `list`
message.

### WSL spawn policy

For any `shellId` whose kind is `wsl`, the resolver emits
`wsl.exe -d <distro> --cd <windows cwd>` and attaches a minimal
environment: `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `WSL_UTF8=1`, plus
the Windows host variables `SystemRoot` and `windir` when present.
`wsl.exe` is a Windows process before it enters the Linux distribution,
so those host variables must survive the otherwise strict environment.
The resolver still does **not** spread `process.env`, so Windows-style
`PATH` values do not leak into the Linux side. Native Windows shells keep
the current permissive env shape.

## Consequences

### Positive

- Windows users get a real shell picker plus durable persistence.
- First-launch friction becomes a single one-time modal rather than a
  recurring re-pick for every workspace.
- The WebSocket bridge no longer accepts arbitrary executable paths from
  clients.
- Adding Nushell, Git Bash, or a second WSL distro later is a data
  change (registering a new descriptor), not a code change.
- The renderer UI is data-driven: one picker component populated from
  `listShells()`, platform differences handled entirely backend-side.

### Negative / trade-offs

- Small increase in IPC surface (`preferences:*`, `terminal:list-shells`).
- Breaking change to the WebSocket protocol: the free-form `shell` field
  is removed. Acceptable because the bridge is local-only today and has
  no production clients outside this repo.
- ConPTY must remain enabled on Windows for WSL rendering to behave
  correctly under resize. That was already the default, but we now
  depend on it intentionally.
- The `'auto'` sentinel means `preferences.json` stays portable across
  machines, but it also means "what am I actually spawning?" is
  indirection the user has to reason about. Mitigated by showing the
  resolved shell's label in the window title and in the picker's
  "Use app default (X)" row.

## Alternatives considered

1. **Keep the free-form `shell` path.** Rejected: unsafe on the
   WebSocket variant, and the UI has no way to enumerate it.
2. **Per-workspace shell only, no app-level preference.** Rejected:
   forces the user to re-pick for every new workspace, which is exactly
   the friction this ADR exists to remove.
3. **Read Windows Terminal's `defaultProfile` in phase 1.** Parked.
   Parsing `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_*\LocalState\settings.json`,
   handling UTF-16 / JSONC, and matching profile GUIDs against the
   registry is a larger surface area than the rest of phase 1 combined.
   Revisit if real users ask for it.
4. **Store shell as an `enum` rather than a string id.** Rejected: WSL
   distributions are data, not enum cases — `wsl:Ubuntu-22.04` must be
   expressible without a type change.

## Migration

- Existing persisted `WorkspaceSettings` without `shellId` are valid.
  They resolve to the app preference, which defaults to `'auto'`.
- The `shell?: string` field on `TerminalCreateRequest` is removed in
  the same release. No production callers set it today.
- No data migration script is needed. Old persisted state is forward-
  compatible.

## Rollout

Phase 1 (this ADR): registry, resolver, preferences module, UI picker
and first-run prompt, WSL strict-env spawn path, WebSocket protocol
update.

Phase 2 (future): Windows Terminal `defaultProfile` seed for `'auto'`;
a `listWslDistros` IPC so the WSL picker is a dropdown rather than a
free-text field; shell-specific start-command dialects if users ask.
