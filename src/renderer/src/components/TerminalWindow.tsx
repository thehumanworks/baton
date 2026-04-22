import { type PointerEvent, useEffect, useRef } from "react";
import {
  MIN_TERMINAL_HEIGHT,
  MIN_TERMINAL_WIDTH,
  type TerminalWindowState,
  type WorkspaceSettings,
} from "../domain";
import { useTerminalClient } from "../services/terminalContext";
import { TerminalPane } from "./TerminalPane";
import { createTerminalStartupGate } from "./terminal-startup";

interface TerminalWindowProps {
  terminal: TerminalWindowState;
  scale: number;
  workspaceSettings: WorkspaceSettings;
  appDefaultShellId: string;
  onPatch: (patch: Partial<TerminalWindowState>) => void;
  onClose: () => void;
  onToggleMinimized: () => void;
  onBringToFront: () => void;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

interface ResizeState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
}

export function TerminalWindow(props: TerminalWindowProps) {
  const client = useTerminalClient();
  const startupGateRef = useRef<ReturnType<typeof createTerminalStartupGate> | null>(null);
  const onPatchRef = useRef(props.onPatch);
  const settingsRef = useRef(props.workspaceSettings);
  const appDefaultShellIdRef = useRef(props.appDefaultShellId);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const terminal = props.terminal;

  if (!startupGateRef.current) {
    startupGateRef.current = createTerminalStartupGate();
  }
  const startupGate = startupGateRef.current;

  useEffect(() => {
    onPatchRef.current = props.onPatch;
  }, [props.onPatch]);

  useEffect(() => {
    settingsRef.current = props.workspaceSettings;
  }, [props.workspaceSettings]);

  useEffect(() => {
    appDefaultShellIdRef.current = props.appDefaultShellId;
  }, [props.appDefaultShellId]);

  useEffect(() => {
    const startupKey = startupGate.begin(terminal);
    if (!startupKey) return;

    let cancelled = false;

    if (terminal.terminalId) {
      client.attachTerminal(terminal.terminalId)
        .then((response) => {
          if (cancelled) {
            startupGate.finish(startupKey);
            return;
          }
          startupGate.finish(startupKey);

          onPatchRef.current({
            title: `${response.shell} · ${response.cwd ?? "~"}`,
            status: response.status,
            exitCode: response.exitCode,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            startupGate.finish(startupKey);
            return;
          }
          startupGate.finish(startupKey);
          onPatchRef.current({
            status: "error",
            title: error instanceof Error
              ? error.message
              : "Terminal session is unavailable",
          });
        });

      return () => {
        cancelled = true;
      };
    }

    const settings = settingsRef.current;
    const cwd = settings.defaultCwd?.trim() || undefined;
    const startCommand = settings.startCommand?.trim() || undefined;
    const effectiveShellId = settings.shellId || appDefaultShellIdRef.current || undefined;
    const wslDistro = settings.wslDistro || undefined;

    client.createTerminal({
      cols: 100,
      rows: 30,
      cwd,
      ...(effectiveShellId ? { shellId: effectiveShellId } : {}),
      ...(wslDistro ? { wslDistro } : {}),
      ...(startCommand ? { startCommand } : {}),
    })
      .then((response) => {
        if (cancelled) {
          startupGate.finish(startupKey);
          void client.close(response.terminalId);
          return;
        }

        startupGate.finish(startupKey);
        onPatchRef.current({
          terminalId: response.terminalId,
          title: `${response.shell} · ${response.cwd ?? "~"}`,
          status: "running",
          exitCode: null,
        });

      })
      .catch((error: unknown) => {
        if (cancelled) {
          startupGate.finish(startupKey);
          return;
        }
        startupGate.finish(startupKey);
        onPatchRef.current({
          status: "error",
          title: error instanceof Error
            ? error.message
            : "Terminal failed to start",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, startupGate, terminal.status, terminal.terminalId]);

  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;

    props.onBringToFront();
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: terminal.x,
      startY: terminal.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleHeaderPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    props.onPatch({
      x: Math.round(
        drag.startX + (event.clientX - drag.startClientX) / props.scale,
      ),
      y: Math.round(
        drag.startY + (event.clientY - drag.startClientY) / props.scale,
      ),
    });
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>): void {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
    }
  }

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    props.onBringToFront();
    resizeState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: terminal.width,
      startHeight: terminal.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizeMove(event: PointerEvent<HTMLDivElement>): void {
    const resize = resizeState.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    props.onPatch({
      width: Math.max(
        MIN_TERMINAL_WIDTH,
        Math.round(
          resize.startWidth +
            (event.clientX - resize.startClientX) / props.scale,
        ),
      ),
      height: Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.round(
          resize.startHeight +
            (event.clientY - resize.startClientY) / props.scale,
        ),
      ),
    });
  }

  function stopResize(event: PointerEvent<HTMLDivElement>): void {
    if (resizeState.current?.pointerId === event.pointerId) {
      resizeState.current = null;
    }
  }

  const statusLabel = terminal.status === "running"
    ? "running"
    : terminal.status === "starting"
    ? "starting"
    : terminal.status === "exited"
    ? `exited${
      terminal.exitCode === null || terminal.exitCode === undefined
        ? ""
        : ` ${terminal.exitCode}`
    }`
    : "error";

  const statusColor = terminal.status === "running"
    ? "text-success"
    : terminal.status === "starting"
    ? "text-warning"
    : terminal.status === "exited" || terminal.status === "error"
    ? "text-danger"
    : "text-muted";

  return (
    <article
      className="notch surface-window absolute left-0 top-0 flex flex-col overflow-hidden cursor-default"
      data-terminal-window="true"
      style={{
        transform: `translate(${terminal.x}px, ${terminal.y}px)`,
        width: terminal.width,
        height: terminal.minimized ? 44 : terminal.height,
        zIndex: terminal.z,
      }}
      onPointerDown={props.onBringToFront}
    >
      <div
        className="terminal-header-grad surface-window-divider shrink-0 grow-0 basis-11 h-11 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pl-3 pr-5 cursor-grab select-none active:cursor-grabbing max-md:h-12 max-md:basis-12"
        onPointerDown={startDrag}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="traffic-lights group flex items-center gap-[8px]">
          <button
            className="traffic-light traffic-light--close"
            type="button"
            onClick={props.onClose}
            aria-label="Close terminal"
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" />
            </svg>
          </button>
          <button
            className="traffic-light traffic-light--minimize"
            type="button"
            onClick={props.onToggleMinimized}
            aria-label={terminal.minimized ? "Restore terminal" : "Minimise terminal"}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5 H8" />
            </svg>
          </button>
          <button
            className="traffic-light traffic-light--zoom"
            type="button"
            onClick={props.onToggleMinimized}
            aria-label={terminal.minimized ? "Restore terminal" : "Zoom terminal"}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5 H7.5 V7.5 Z M7.5 7.5 H2.5 V2.5 Z" />
            </svg>
          </button>
        </div>
        <div
          className="overflow-hidden whitespace-nowrap text-ellipsis text-fg text-[12px] font-medium tracking-wide"
          title={terminal.title}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {terminal.title}
        </div>
        <div
          className={`text-[11px] tracking-[0.02em] tabular-nums ${statusColor}`}
        >
          {statusLabel}
        </div>
      </div>

      {!terminal.minimized && (
        <div className="min-h-0 flex-1 relative" style={{ background: "var(--terminal-bg)" }}>
          {terminal.terminalId && terminal.status !== "starting"
            ? <TerminalPane terminalId={terminal.terminalId} />
            : (
              <div className="h-full grid place-items-center text-muted text-[12px] tracking-[0.02em]">
                {terminal.status === "error" ? "Terminal unavailable" : "Starting terminal…"}
              </div>
            )}
        </div>
      )}

      {!terminal.minimized && (
        <div
          className="resize-handle absolute right-0 bottom-0 w-[22px] h-[22px] cursor-nwse-resize"
          onPointerDown={startResize}
          onPointerMove={handleResizeMove}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          aria-hidden="true"
        />
      )}
    </article>
  );
}
