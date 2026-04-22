import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminalClient } from "../services/terminalContext";
import { useThemeContext } from "../services/themeContext";
import type { AppliedTheme } from "../theme";

interface TerminalPaneProps {
  terminalId: string;
}

function buildXtermTheme(applied: AppliedTheme): Record<string, string> {
  if (applied === "light") {
    return {
      background: "#fbfaf7",
      foreground: "#1c1917",
      cursor: "#1c1917",
      cursorAccent: "#fbfaf7",
      selectionBackground: "#d6d3d1",
      black: "#1c1917",
      red: "#b91c1c",
      green: "#15803d",
      yellow: "#b45309",
      blue: "#1d4ed8",
      magenta: "#7c3aed",
      cyan: "#0e7490",
      white: "#44403c",
      brightBlack: "#57534e",
      brightRed: "#dc2626",
      brightGreen: "#16a34a",
      brightYellow: "#d97706",
      brightBlue: "#2563eb",
      brightMagenta: "#8b5cf6",
      brightCyan: "#0891b2",
      brightWhite: "#1c1917",
    };
  }

  return {
    background: "#0a0a0a",
    foreground: "#e7e5e4",
    cursor: "#fafaf9",
    cursorAccent: "#0a0a0a",
    selectionBackground: "#404040",
    black: "#0a0a0a",
    red: "#a8a29e",
    green: "#d6d3d1",
    yellow: "#e7e5e4",
    blue: "#a8a29e",
    magenta: "#d6d3d1",
    cyan: "#e7e5e4",
    white: "#f5f5f4",
    brightBlack: "#57534e",
    brightRed: "#d6d3d1",
    brightGreen: "#e7e5e4",
    brightYellow: "#fafaf9",
    brightBlue: "#d6d3d1",
    brightMagenta: "#e7e5e4",
    brightCyan: "#fafaf9",
    brightWhite: "#fafafa",
  };
}

export function TerminalPane({ terminalId }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const client = useTerminalClient();
  const { appliedTheme } = useThemeContext();
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: false,
      fontFamily:
        '"FiraCode Nerd Font Mono", "JetBrainsMono Nerd Font Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10000,
      allowProposedApi: false,
      theme: buildXtermTheme(appliedTheme),
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);

    const existingBuffer = client.getBuffer(terminalId);
    if (existingBuffer) terminal.write(existingBuffer);

    const fitAndResize = (): void => {
      try {
        fitAddon.fit();
        client.resize(terminalId, terminal.cols, terminal.rows);
      } catch {
        // Fit can throw while the element has no measurable layout.
      }
    };

    const dataDisposable = terminal.onData((data) =>
      client.write(terminalId, data)
    );
    const disposeData = client.onData((event) => {
      if (event.terminalId === terminalId) terminal.write(event.data);
    });
    const disposeExit = client.onExit((event) => {
      if (event.terminalId === terminalId) {
        terminal.write(
          `\r\n\x1b[2m[process exited${
            event.exitCode === null ? "" : ` with code ${event.exitCode}`
          } ]\x1b[0m`,
        );
      }
    });

    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(host);
    window.setTimeout(fitAndResize, 0);
    window.setTimeout(() => terminal.focus(), 50);

    // Mobile browsers shrink the visual viewport when the soft keyboard
    // opens. Refit shortly after so xterm recalculates rows and the
    // prompt line stays visible instead of sliding under the keyboard.
    const onViewportChange = (): void => {
      window.setTimeout(fitAndResize, 0);
    };
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      dataDisposable.dispose();
      disposeData();
      disposeExit();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [client, terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = buildXtermTheme(appliedTheme);
  }, [appliedTheme]);

  return (
    <div
      ref={hostRef}
      className="w-full h-full p-2.5 max-md:p-2"
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
