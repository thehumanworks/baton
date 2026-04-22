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

## Current persistence model

On the Electron desktop runtime, Baton now keeps PTYs in a detached local session host instead of inside Electron main. That means:

- switching workspaces keeps the same live shell session;
- quitting and reopening Baton reattaches to the same live shell session on the same machine/user account;
- closing a terminal window still kills that specific session;
- deleting a workspace still kills the sessions owned by that workspace.

Workspace/layout metadata is now persisted to an app-owned JSON store under Electron `userData` and mirrored into renderer `localStorage` as a cache for fast boot. The web/mobile WebSocket backend still behaves differently: it does not yet support attach/reattach of existing sessions across browser reconnects.

The design rationale and future hardening path are documented in `docs/adrs/0002-terminal-session-persistence.md`.

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

The workflow in `.github/workflows/build.yml` builds the app for macOS, Windows, and Linux on every push to `main` (and on pull requests targeting `main`). It now also runs `bun test`, `bun run typecheck`, and, on macOS/Linux, the Electron session-persistence verification before packaging. Each job uploads its installers as a workflow artifact (`baton-macos`, `baton-windows`, `baton-linux`) which you can download from the Actions run summary. The builds are unsigned; see "Notes for production hardening" below for signing and notarization.

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

- `server/pty-websocket.ts` bound to `0.0.0.0` on port `8787`
- the Vite web app with `VITE_TERMINAL_WS_URL=auto`

This exposes the development PTY bridge to your LAN while the command is running.
Open the Vite `Network` URL from the printed output on your phone. The browser client resolves `auto` to the same hostname that served the page, for example `ws://YOUR_MAC_LAN_IP:8787`. Do not use `0.0.0.0` as the browser WebSocket URL; it is only a server bind address.

For testing on a phone on the same LAN, bind the terminal server explicitly and use a token:

```bash
TERMINAL_WS_HOST=0.0.0.0 TERMINAL_WS_TOKEN=change-me bun run terminal:server
VITE_TERMINAL_WS_URL=auto VITE_TERMINAL_WS_TOKEN=change-me bun run web
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
src/main/                 Electron main process, detached session host, and JSON stores
src/preload/              Safe bridge between renderer and Electron IPC
src/renderer/             React canvas UI; also builds for web/mobile
src/shared/               Shared terminal/session protocol types
server/pty-websocket.ts   Optional WebSocket PTY bridge for web/mobile
scripts/verify-session-persistence.mjs  Built-runtime verification for Electron session reattach
```

## Notes for production hardening

- Add application signing and notarization for macOS distribution.
- Replace the demo PTY WebSocket server with an authenticated, audited backend if web terminals are needed outside localhost.
- Harden the detached session host further (crash recovery, TTL/GC, optional disk-backed scrollback, and WebSocket attach support); see `docs/adrs/0002-terminal-session-persistence.md`.
- Consider making the WebSocket backend share the same durable session model if browser reconnect reattach becomes a product requirement.
