import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  nextFocusedTerminalId,
  resolveFocusedTerminalIndex,
  type TerminalWindowState,
  type WorkspaceSettings,
} from "../domain";
import { useTerminalClient } from "../services/terminalContext";
import { TerminalPane } from "./TerminalPane";
import { createTerminalStartupGate } from "./terminal-startup";

interface FocusModeViewProps {
  terminals: TerminalWindowState[];
  focusedTerminalId: string | null;
  workspaceSettings: WorkspaceSettings;
  workspaceName: string;
  appDefaultShellId: string;
  onFocusChange: (terminalId: string) => void;
  onPatchTerminal: (
    terminalWindowId: string,
    patch: Partial<TerminalWindowState>,
  ) => void;
  onCloseTerminal: (terminalWindowId: string) => void;
  onAddTerminal: () => void;
}

const SWIPE_THRESHOLD_PX = 60;
const WHEEL_FLUSH_MS = 240;

export function FocusModeView(props: FocusModeViewProps) {
  const { terminals, focusedTerminalId } = props;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const pointerState = useRef<
    | {
        pointerId: number;
        startClientX: number;
        startClientY: number;
        active: boolean;
      }
    | null
  >(null);
  const wheelAccum = useRef(0);
  const wheelFlushTimer = useRef<number | null>(null);

  const activeIndex = resolveFocusedTerminalIndex(terminals, focusedTerminalId);

  const goTo = useCallback(
    (direction: 1 | -1) => {
      const nextId = nextFocusedTerminalId(terminals, focusedTerminalId, direction);
      if (nextId && nextId !== focusedTerminalId) {
        props.onFocusChange(nextId);
      }
    },
    [terminals, focusedTerminalId, props],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".xterm")) return;
      if (target?.closest("input, textarea, select")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(".xterm")) return;
    if (target.closest("button, a, input, textarea, select")) return;
    // On desktop we only start a drag from outside the active card so clicks
    // near the terminal chrome don't get captured; on touch / pen we let the
    // whole surface be swipeable since screens are small.
    if (event.pointerType === "mouse") {
      if (target.closest("[data-focus-card-active=\"true\"]")) {
        if (!target.closest("[data-focus-peek=\"true\"]")) return;
      }
      if (event.button !== 0) return;
    }
    pointerState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      active: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId || !state.active) return;
    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 24) {
      // Treat as a vertical scroll, release capture
      state.active = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDragOffset(0);
      return;
    }
    setDragOffset(dx);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    pointerState.current = null;
    const dx = event.clientX - state.startClientX;
    setDragOffset(0);
    if (!state.active) return;
    if (dx <= -SWIPE_THRESHOLD_PX) goTo(1);
    else if (dx >= SWIPE_THRESHOLD_PX) goTo(-1);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerState.current?.pointerId === event.pointerId) {
      pointerState.current = null;
      setDragOffset(0);
    }
  };

  const flushWheel = useCallback(() => {
    const value = wheelAccum.current;
    wheelAccum.current = 0;
    if (wheelFlushTimer.current !== null) {
      window.clearTimeout(wheelFlushTimer.current);
      wheelFlushTimer.current = null;
    }
    if (Math.abs(value) < 40) return;
    goTo(value > 0 ? 1 : -1);
  }, [goTo]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".xterm")) return;
    const dx = event.deltaX;
    const dy = event.deltaY;
    // Only intercept when the user is clearly scrolling horizontally.
    if (Math.abs(dx) <= Math.abs(dy)) return;
    event.preventDefault();
    wheelAccum.current += dx;
    if (wheelFlushTimer.current !== null) {
      window.clearTimeout(wheelFlushTimer.current);
    }
    wheelFlushTimer.current = window.setTimeout(flushWheel, WHEEL_FLUSH_MS);
    if (Math.abs(wheelAccum.current) > 120) {
      flushWheel();
    }
  };

  useEffect(() => {
    return () => {
      if (wheelFlushTimer.current !== null) {
        window.clearTimeout(wheelFlushTimer.current);
      }
    };
  }, []);

  const hasTerminals = terminals.length > 0;
  const multi = terminals.length > 1;

  const trackStyle = useMemo<React.CSSProperties>(() => {
    if (!hasTerminals) return { transform: "none" };
    return {
      transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
      transition: dragOffset === 0 ? "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
    };
  }, [activeIndex, dragOffset, hasTerminals]);

  return (
    <div
      className="focus-mode-surface absolute inset-0 overflow-hidden select-none"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {hasTerminals ? (
        <div
          ref={trackRef}
          className="focus-mode-track absolute inset-0 flex"
          style={trackStyle}
        >
          {terminals.map((terminal, index) => {
            const offset = index - activeIndex;
            const isActive = index === activeIndex;
            return (
              <FocusedTerminalCard
                key={terminal.id}
                terminal={terminal}
                active={isActive}
                offset={offset}
                workspaceSettings={props.workspaceSettings}
                appDefaultShellId={props.appDefaultShellId}
                onActivate={() => {
                  if (!isActive) props.onFocusChange(terminal.id);
                }}
                onPatch={(patch) => props.onPatchTerminal(terminal.id, patch)}
                onClose={() => props.onCloseTerminal(terminal.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="absolute inset-0 grid place-content-center gap-3 text-center text-muted">
          <span className="text-muted text-[11px] tracking-[0.08em]">
            Focused mode
          </span>
          <strong className="text-fg text-3xl font-semibold tracking-tight">
            {props.workspaceName}
          </strong>
          <span className="text-[13px]">
            Spawn a terminal to focus it here.
          </span>
          <button
            type="button"
            className="mt-3 justify-self-center flex items-center gap-2 text-muted hover:text-fg hover:bg-[var(--surface-item-hover-bg)] transition-colors min-h-9 rounded-[10px] px-3.5 text-[12px] tracking-[0.02em]"
            onClick={props.onAddTerminal}
          >
            Spawn Terminal
          </button>
        </div>
      )}

      {hasTerminals && (
        <button
          type="button"
          className="focus-mode-spawn"
          onClick={props.onAddTerminal}
          aria-label="Spawn Terminal"
          title="Spawn Terminal"
        >
          Spawn Terminal
        </button>
      )}

      {multi && (
        <>
          <button
            type="button"
            className="focus-mode-nav focus-mode-nav--prev"
            aria-label="Previous terminal"
            onClick={() => goTo(-1)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className="focus-mode-nav focus-mode-nav--next"
            aria-label="Next terminal"
            onClick={() => goTo(1)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {multi && (
        <div
          className="focus-mode-dots"
          role="tablist"
          aria-label="Terminal focus selector"
        >
          {terminals.map((terminal, index) => (
            <button
              key={terminal.id}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Focus ${terminal.title}`}
              className={`focus-mode-dot ${index === activeIndex ? "is-active" : ""}`}
              onClick={() => props.onFocusChange(terminal.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FocusedTerminalCardProps {
  terminal: TerminalWindowState;
  active: boolean;
  offset: number;
  workspaceSettings: WorkspaceSettings;
  appDefaultShellId: string;
  onActivate: () => void;
  onPatch: (patch: Partial<TerminalWindowState>) => void;
  onClose: () => void;
}

function FocusedTerminalCard(props: FocusedTerminalCardProps) {
  const client = useTerminalClient();
  const startupGateRef = useRef<ReturnType<typeof createTerminalStartupGate> | null>(null);
  const onPatchRef = useRef(props.onPatch);
  const settingsRef = useRef(props.workspaceSettings);
  const appDefaultShellIdRef = useRef(props.appDefaultShellId);
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
      client
        .attachTerminal(terminal.terminalId)
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
            title:
              error instanceof Error
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

    client
      .createTerminal({
        cols: 100,
        rows: 30,
        cwd,
        ...(effectiveShellId ? { shellId: effectiveShellId } : {}),
        ...(wslDistro ? { wslDistro } : {}),
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
        if (startCommand) {
          window.setTimeout(() => {
            if (cancelled) return;
            client.write(response.terminalId, `${startCommand}\r`);
          }, 0);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          startupGate.finish(startupKey);
          return;
        }
        startupGate.finish(startupKey);
        onPatchRef.current({
          status: "error",
          title:
            error instanceof Error ? error.message : "Terminal failed to start",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, startupGate, terminal.status, terminal.terminalId]);

  const statusLabel =
    terminal.status === "running"
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

  const statusColor =
    terminal.status === "running"
      ? "text-success"
      : terminal.status === "starting"
      ? "text-warning"
      : terminal.status === "exited" || terminal.status === "error"
      ? "text-danger"
      : "text-muted";

  // When the slide is far off-screen we skip rendering the terminal pane to
  // avoid wasted layout work, but we keep the outer card so the session (held
  // by the parent's mounted <TerminalPane>) can remount when it returns.
  // The session itself lives on the server/PTY, so unmounting <TerminalPane>
  // for distant slides is safe — the buffer is replayed on reattach.
  const isNeighbor = Math.abs(props.offset) <= 1;

  return (
    <div
      className="focus-mode-slide"
      aria-hidden={!props.active}
      data-focus-card-active={props.active ? "true" : "false"}
      onPointerDownCapture={(event) => {
        if (!props.active && event.pointerType !== "mouse") {
          props.onActivate();
        }
      }}
      onClick={() => {
        if (!props.active) props.onActivate();
      }}
    >
      <article
        className={`focus-mode-window surface-window ${
          props.active ? "is-active" : "is-peek"
        }`}
        data-terminal-window="true"
      >
        <div className="terminal-header-grad surface-window-divider shrink-0 grow-0 basis-11 h-11 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 pl-3 pr-5 select-none max-md:h-12 max-md:basis-12">
          <div className="traffic-lights group flex items-center gap-[8px]">
            <button
              className="traffic-light traffic-light--close"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onClose();
              }}
              aria-label="Close terminal"
              disabled={!props.active}
            >
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" />
              </svg>
            </button>
            <span
              className="traffic-light traffic-light--minimize"
              aria-hidden="true"
            />
            <span
              className="traffic-light traffic-light--zoom"
              aria-hidden="true"
            />
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

        <div
          className="min-h-0 flex-1 relative"
          style={{ background: "var(--terminal-bg)" }}
        >
          {terminal.terminalId && terminal.status !== "starting" && isNeighbor ? (
            <TerminalPane terminalId={terminal.terminalId} />
          ) : (
            <div className="h-full grid place-items-center text-muted text-[12px] tracking-[0.02em]">
              {terminal.status === "error"
                ? "Terminal unavailable"
                : terminal.status === "starting"
                ? "Starting terminal…"
                : ""}
            </div>
          )}
          {!props.active && (
            <div
              className="focus-mode-peek-scrim"
              data-focus-peek="true"
              aria-hidden="true"
            />
          )}
        </div>
      </article>
    </div>
  );
}
