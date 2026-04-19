# Oracle Terminal Canvas

An Electron + React app for macOS with an infinite canvas of movable, resizable terminal windows. The same renderer also runs as a web/mobile-responsive app.

## What is included

- Infinite canvas with pan and zoom.
- Spawn terminal windows on the canvas.
- Move, resize, minimise, restore, and close terminal windows.
- Multiple named workspaces, each with its own canvas, viewport, and terminal layout.
- Collapsible vertical workspace panel on the left.
- macOS Electron runtime using real pseudo-terminals via `node-pty`.
- Web/mobile renderer with:
  - a safe browser demo terminal by default;
  - optional real terminal support through the included local WebSocket PTY bridge.

## Important runtime model

The Electron app can spawn real local shells because the Electron main process can use `node-pty`.

A normal web page or mobile browser cannot directly spawn a local macOS shell. For web/mobile, this project uses the same UI and falls back to a demo terminal unless `VITE_TERMINAL_WS_URL` points to a trusted terminal backend. A small local development backend is included in `server/pty-websocket.ts`.

Do not expose the PTY WebSocket server to an untrusted network. It gives clients shell access on the machine where the server runs.

## Prerequisites

- macOS 13+ recommended.
- Node.js 22+ recommended.
- Xcode command line tools for native module compilation:

```bash
xcode-select --install
```

## Install

```bash
npm install
```

`node-pty` is a native module. If installation or launch fails after changing Electron versions, rebuild native dependencies:

```bash
npx electron-builder install-app-deps
```

## Run the macOS Electron app

```bash
npm run dev
```

## Build a macOS app

```bash
npm run dist:mac
```

The packaged app is written to `release/`.

## Run the web/mobile renderer with the demo terminal

```bash
npm run web
```

Open the printed Vite URL in a desktop or mobile browser. Terminals in this mode are intentionally simulated.

## Run the web/mobile renderer with real terminals through the local PTY bridge

```bash
npm run web:terminal
```

This starts:

- `server/pty-websocket.ts` on `ws://127.0.0.1:8787`
- the Vite web app with `VITE_TERMINAL_WS_URL=ws://127.0.0.1:8787`

For testing on a phone on the same LAN, bind the terminal server explicitly and use a token:

```bash
TERMINAL_WS_HOST=0.0.0.0 TERMINAL_WS_TOKEN=change-me npm run terminal:server
VITE_TERMINAL_WS_URL=ws://YOUR_MAC_LAN_IP:8787 VITE_TERMINAL_WS_TOKEN=change-me npm run web
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

## Notes for production hardening

- Add application signing and notarization for macOS distribution.
- Replace the demo PTY WebSocket server with an authenticated, audited backend if web terminals are needed outside localhost.
- Consider workspace persistence in SQLite or a local JSON store if layouts should survive localStorage clearing.
- Add terminal session restoration if you need buffer/process persistence across app restarts.
