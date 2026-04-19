import { type PointerEvent, useEffect, useRef } from "react";
import {
  MIN_TERMINAL_HEIGHT,
  MIN_TERMINAL_WIDTH,
  type TerminalWindowState,
  type WorkspaceSettings,
} from "../domain";
import { useTerminalClient } from "../services/terminalContext";
import { TerminalPane } from "./TerminalPane";

interface TerminalWindowProps {
  terminal: TerminalWindowState;
  scale: number;
  workspaceSettings: WorkspaceSettings;
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
  const hasStartedRef = useRef(false);
  const onPatchRef = useRef(props.onPatch);
  const settingsRef = useRef(props.workspaceSettings);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const terminal = props.terminal;

  useEffect(() => {
    onPatchRef.current = props.onPatch;
  }, [props.onPatch]);

  useEffect(() => {
    settingsRef.current = props.workspaceSettings;
  }, [props.workspaceSettings]);

  useEffect(() => {
    if (
      terminal.terminalId || hasStartedRef.current ||
      terminal.status === "exited"
    ) return;
    hasStartedRef.current = true;

    let cancelled = false;

    const settings = settingsRef.current;
    const cwd = settings.defaultCwd?.trim() || undefined;
    const startCommand = settings.startCommand?.trim() || undefined;

    client.createTerminal({ cols: 100, rows: 30, cwd })
      .then((response) => {
        if (cancelled) {
          void client.close(response.terminalId);
          return;
        }

        onPatchRef.current({
          terminalId: response.terminalId,
          title: `${response.shell} · ${response.cwd ?? "~"}`,
          status: "running",
        });

        if (startCommand) {
          window.setTimeout(() => {
            if (cancelled) return;
            client.write(response.terminalId, `${startCommand}\r`);
          }, 0);
        }
      })
      .catch((error: unknown) => {
        hasStartedRef.current = false;
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
  }, [client, terminal.status, terminal.terminalId]);

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
      className={`absolute left-0 top-0 flex flex-col overflow-hidden border border-[rgba(148,163,184,0.20)] bg-[rgba(7,10,17,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)] cursor-default ${
        terminal.minimized ? "rounded-2xl" : "rounded-[18px]"
      }`}
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
        className="terminal-header-grad shrink-0 grow-0 basis-11 h-11 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 border-b border-[rgba(148,163,184,0.14)] cursor-grab select-none active:cursor-grabbing max-md:h-12 max-md:basis-12"
        onPointerDown={startDrag}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="flex gap-[7px]">
          <button
            className="w-[13px] h-[13px] p-0 border-0 rounded-full cursor-pointer bg-[#ff5f57]"
            type="button"
            onClick={props.onClose}
            aria-label="Close terminal"
          />
          <button
            className="w-[13px] h-[13px] p-0 border-0 rounded-full cursor-pointer bg-[#febc2e]"
            type="button"
            onClick={props.onToggleMinimized}
            aria-label="Minimise terminal"
          />
          <button
            className="w-[13px] h-[13px] p-0 border-0 rounded-full cursor-pointer bg-[#28c840]"
            type="button"
            onClick={props.onToggleMinimized}
            aria-label="Restore terminal"
          />
        </div>
        <div
          className="overflow-hidden whitespace-nowrap text-ellipsis text-[#dbe4f0] text-xs font-bold"
          title={terminal.title}
        >
          {terminal.title}
        </div>
        <div className={`text-[11px] tabular-nums ${statusColor}`}>
          {statusLabel}
        </div>
      </div>

      {!terminal.minimized && (
        <div className="min-h-0 flex-1 relative bg-[#090d15]">
          {terminal.terminalId
            ? <TerminalPane terminalId={terminal.terminalId} />
            : (
              <div className="h-full grid place-items-center text-muted text-[13px]">
                Starting terminal…
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
