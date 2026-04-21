# Baton

<p align="center">
  <img src="build/baton_logo.webp" alt="Baton logo" width="300" />
</p>

<p align="center"><strong>Orchestrate terminals.</strong></p>

Baton is an Electron + React desktop app with an infinite canvas of movable, resizable terminal windows. The desktop app runs on macOS, Windows, and Linux, and the same renderer also runs as a web/mobile-responsive app.

## What is included

- Infinite canvas with pan and zoom.
- Spawn terminal windows on the canvas.
- Move, resize, minimise, restore, and close terminal windows.
- Multiple named workspaces, each with its own canvas, viewport, and terminal layout.
- Collapsible vertical workspace panel on the left.
- Desktop Electron runtime using real pseudo-terminals via `node-pty` on macOS, Windows, and Linux.
- Web/mobile renderer with:
  - a safe browser demo terminal by default;
  - optional real terminal support through the included local WebSocket PTY bridge.

## Important runtime model

The Electron app can spawn real local shells because the Electron main process can use `node-pty`.

A normal web page or mobile browser cannot directly spawn a local macOS shell. For web/mobile, this project uses the same UI and falls back to a demo terminal unless `VITE_TERMINAL_WS_URL` points to a trusted terminal backend. A small local development backend is included in `server/pty-websocket.ts`.

Do not expose the PTY WebSocket server to an untrusted network. It gives clients shell access on the machine where the server runs.

## Prerequisites

- Bun 1.3+ recommended.
- Node.js 22+ recommended.
- A C/C++ toolchain for building the `node-pty` native module:
  - **macOS 13+**: Xcode command line tools.
    ```bash
    xcode-select --install
    ```
  - **Windows 10/11**: Visual Studio Build Tools (Desktop development with C++) and Python 3. Installing via `npm install --global windows-build-tools` is deprecated; use the Visual Studio Installer instead.
  - **Linux**: `build-essential`, `python3`, and the X11/keyboard headers, for example on Debian/Ubuntu:
    ```bash
    sudo apt-get install -y build-essential python3 libx11-dev libxkbfile-dev
    ```

## Install

```bash
bun install
```

`node-pty` is a native module. If installation or launch fails after changing Electron versions, rebuild native dependencies:

```bash
bun x electron-builder install-app-deps
```

## Run the Electron app (macOS, Windows, Linux)

```bash
bun run dev
```

## Build a desktop app

Build for the host platform:

```bash
bun run dist
```

Build for a specific platform (run each on a matching host, or use the CI workflow described below):

```bash
bun run dist:mac      # .dmg and .zip for macOS (x64 + arm64)
bun run dist:win      # NSIS installer and portable .exe for Windows x64
bun run dist:linux    # AppImage and .deb for Linux x64
```

The packaged artifacts are written to `release/`.

## Continuous builds on GitHub Actions

The workflow in `.github/workflows/build.yml` builds the app for macOS, Windows, and Linux on every push to `main` (and on pull requests targeting `main`). Each job uploads its installers as a workflow artifact (`baton-macos`, `baton-windows`, `baton-linux`) which you can download from the Actions run summary. The builds are unsigned; see "Notes for production hardening" below for signing and notarization.

## Run the web/mobile renderer with the demo terminal

```bash
bun run web
```

Open the printed Vite URL in a desktop or mobile browser. Terminals in this mode are intentionally simulated.

## Run the web/mobile renderer with real terminals through the local PTY bridge

```bash
bun run web:terminal
```

This starts:

- `server/pty-websocket.ts` on `ws://127.0.0.1:8787`
- the Vite web app with `VITE_TERMINAL_WS_URL=ws://127.0.0.1:8787`

For testing on a phone on the same LAN, bind the terminal server explicitly and use a token:

```bash
TERMINAL_WS_HOST=0.0.0.0 TERMINAL_WS_TOKEN=change-me bun run terminal:server
VITE_TERMINAL_WS_URL=ws://YOUR_MAC_LAN_IP:8787 VITE_TERMINAL_WS_TOKEN=change-me bun run web
```

Again: only do this on a trusted network.

## Controls

- **Spawn Terminal**: creates a terminal at the current viewport center.
- **Drag terminal header**: move a terminal window.
- **Bottom-right handle**: resize a terminal window.
- **Mouse/trackpad drag on background**: pan canvas.
- **Wheel/trackpad scroll**: pan canvas.
- **Cmd/Ctrl/Alt + wheel**: zoom around cursor.
- **Zoom buttons**: zoom in/out/reset.
- **Minimise**: keep the shell running while hiding the terminal body.
- **Close**: remove the window and kill the backing PTY.

## Project structure

```text
src/main/                 Electron main process; owns real PTYs
src/preload/              Safe bridge between renderer and Electron IPC
src/renderer/             React canvas UI; also builds for web/mobile
src/shared/               Shared terminal protocol types
server/pty-websocket.ts   Optional WebSocket PTY bridge for web/mobile
```

## Electron preload API example: `window.baton.agentSession`

In the Electron renderer, the preload bridge exposes `window.baton.agentSession` for creating and controlling long-lived local agent-backed shell sessions.

```ts
const stopData = window.baton.agentSession.onData(({ sessionId, data }) => {
  console.log(`[agent ${sessionId}]`, data)
})

const stopExit = window.baton.agentSession.onExit(({ sessionId, exitCode, signal }) => {
  console.log(`agent exited`, { sessionId, exitCode, signal })
})

const session = await window.baton.agentSession.create({
  cols: 120,
  rows: 30,
  cwd: '/tmp',
})

console.log('created session', session.sessionId, session.status, session.cwd)
console.log('buffered output so far', session.recentOutput)

window.baton.agentSession.write(session.sessionId, 'echo hello from Baton\r')
window.baton.agentSession.write(session.sessionId, 'pwd\r')

const current = await window.baton.agentSession.get(session.sessionId)
console.log('current summary', current)

const sessions = await window.baton.agentSession.list()
console.log('all sessions', sessions.map(({ sessionId, status, cwd }) => ({ sessionId, status, cwd })))

await window.baton.agentSession.close(session.sessionId)
stopData()
stopExit()
```

How data flows in Electron:

- `create()` returns the initial session metadata, including `sessionId`, `status`, and `recentOutput`.
- `write()` sends input to the session PTY; use `\r` for Enter when sending shell commands.
- `onData()` streams incremental PTY output as `{ sessionId, data }` events.
- `onExit()` fires when the backing process exits as `{ sessionId, exitCode, signal }`.
- `get()` returns the latest known summary for one session, while `list()` returns all tracked sessions, including exited or closed state when available.

## Notes for production hardening

- Add application signing and notarization for macOS distribution.
- Replace the demo PTY WebSocket server with an authenticated, audited backend if web terminals are needed outside localhost.
- Consider workspace persistence in SQLite or a local JSON store if layouts should survive localStorage clearing.
- Add terminal session restoration if you need buffer/process persistence across app restarts.
