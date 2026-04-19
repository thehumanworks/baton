import {
  type PointerEvent,
  useCallback,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import {
  clamp,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  type TerminalWindowState,
  type ViewportState,
  type WorkspaceState,
} from "../domain";
import { TerminalWindow } from "./TerminalWindow";

interface CanvasProps {
  workspace: WorkspaceState;
  terminalMode: "electron" | "websocket" | "demo";
  onViewportChange: (viewport: ViewportState) => void;
  onAddTerminal: (
    input: { x: number; y: number; width?: number; height?: number },
  ) => void;
  onPatchTerminal: (
    terminalWindowId: string,
    patch: Partial<TerminalWindowState>,
  ) => void;
  onCloseTerminal: (terminalWindowId: string) => void;
  onToggleTerminalMinimized: (terminalWindowId: string) => void;
  onBringTerminalToFront: (terminalWindowId: string) => void;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

export function Canvas(props: CanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const panState = useRef<PanState | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const viewport = props.workspace.viewport;

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    return {
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  function setViewport(next: ViewportState): void {
    props.onViewportChange({
      x: Math.round(next.x * 100) / 100,
      y: Math.round(next.y * 100) / 100,
      scale: Math.round(clamp(next.scale, MIN_ZOOM, MAX_ZOOM) * 1000) / 1000,
    });
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;

    const nextScale = clamp(viewport.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const worldX = (cursorX - viewport.x) / viewport.scale;
    const worldY = (cursorY - viewport.y) / viewport.scale;

    setViewport({
      scale: nextScale,
      x: cursorX - worldX * nextScale,
      y: cursorY - worldY * nextScale,
    });
  }

  function zoomFromCenter(factor: number): void {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function resetViewport(): void {
    setViewport({ x: 160, y: 120, scale: 1 });
  }

  function addTerminalAtCenter(): void {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;

    const center = clientToWorld(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const width = Math.min(
      DEFAULT_TERMINAL_WIDTH,
      Math.max(380, rect.width / viewport.scale - 96),
    );
    const height = Math.min(
      DEFAULT_TERMINAL_HEIGHT,
      Math.max(260, rect.height / viewport.scale - 120),
    );

    props.onAddTerminal({
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoomAt(event.clientX, event.clientY, factor);
      return;
    }

    setViewport({
      ...viewport,
      x: viewport.x - event.deltaX,
      y: viewport.y - event.deltaY,
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-terminal-window="true"]')) return;
    if (event.button !== 0 && event.button !== 1) return;

    panState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    setViewport({
      ...viewport,
      x: pan.startX + event.clientX - pan.startClientX,
      y: pan.startY + event.clientY - pan.startClientY,
    });
  }

  function stopPanning(event: PointerEvent<HTMLDivElement>): void {
    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null;
      setIsPanning(false);
    }
  }

  const modePillTone =
    props.terminalMode === "electron" || props.terminalMode === "websocket"
      ? "text-[#bbf7d0] border-[rgba(52,211,153,0.28)]"
      : props.terminalMode === "demo"
      ? "text-[#fde68a] border-[rgba(251,191,36,0.28)]"
      : "text-muted-strong border-[rgba(148,163,184,0.18)]";

  const segmentBtn =
    "min-w-[42px] min-h-9 px-3 border-0 border-r border-[rgba(148,163,184,0.14)] bg-transparent cursor-pointer hover:bg-[rgba(15,23,42,0.6)] last:border-r-0 max-md:min-h-10";

  return (
    <section className="relative flex-1 min-w-0 min-h-0 grid grid-rows-[1fr]">
      <div
        className="absolute top-4 left-4 z-20 flex items-center flex-wrap gap-2.5 pointer-events-auto max-md:left-[70px] max-md:right-2.5 max-md:top-2.5 max-md:gap-2"
        aria-label="Canvas controls"
      >
        <button
          className="btn-primary min-h-9 px-3 rounded-xl max-md:min-h-10"
          type="button"
          onClick={addTerminalAtCenter}
        >
          Spawn Terminal
        </button>
        <div
          className="flex items-center overflow-hidden rounded-xl border border-[rgba(148,163,184,0.18)] bg-[rgba(7,10,17,0.72)] backdrop-blur-md"
          role="group"
          aria-label="Zoom controls"
        >
          <button
            type="button"
            className={segmentBtn}
            onClick={() => zoomFromCenter(0.85)}
          >
            −
          </button>
          <button type="button" className={segmentBtn} onClick={resetViewport}>
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            className={segmentBtn}
            onClick={() => zoomFromCenter(1.18)}
          >
            +
          </button>
        </div>
        <span
          className={`inline-flex items-center min-h-8 px-[11px] rounded-full border bg-[rgba(7,10,17,0.72)] backdrop-blur-md text-xs font-bold max-md:hidden ${modePillTone}`}
        >
          {props.terminalMode === "electron"
            ? "local PTY"
            : props.terminalMode === "websocket"
            ? "remote PTY"
            : "demo terminal"}
        </span>
      </div>

      <div
        ref={frameRef}
        className={`canvas-grid relative overflow-hidden touch-none ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
      >
        <div
          className="absolute left-0 top-0 w-px h-px origin-top-left"
          style={{
            transform:
              `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {props.workspace.terminals.map((terminal) => (
            <TerminalWindow
              key={terminal.id}
              terminal={terminal}
              scale={viewport.scale}
              workspaceSettings={props.workspace.settings}
              onPatch={(patch) => props.onPatchTerminal(terminal.id, patch)}
              onClose={() => props.onCloseTerminal(terminal.id)}
              onToggleMinimized={() =>
                props.onToggleTerminalMinimized(terminal.id)}
              onBringToFront={() => props.onBringTerminalToFront(terminal.id)}
            />
          ))}
        </div>

        {props.workspace.terminals.length === 0 && (
          <div className="absolute inset-0 grid place-content-center gap-2 text-center text-muted pointer-events-none">
            <strong className="text-fg text-2xl">{props.workspace.name}</strong>
            <span>Spawn a terminal, then pan or zoom the canvas.</span>
          </div>
        )}
      </div>

      <div className="absolute left-[18px] bottom-4 z-20 px-3 py-2 rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(7,10,17,0.64)] text-muted text-xs backdrop-blur-md pointer-events-none max-md:hidden">
        Drag empty canvas to pan · Scroll to pan · Cmd/Ctrl/Alt + scroll to zoom
        · Double-click workspace to rename
      </div>
    </section>
  );
}
