import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminalClient } from "../services/terminalContext";

interface TerminalPaneProps {
  terminalId: string;
}

export function TerminalPane({ terminalId }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const client = useTerminalClient();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: false,
      fontFamily:
        '"Terminess Nerd Font Mono", "JetBrainsMono Nerd Font Mono", "FiraCode Nerd Font Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10000,
      allowProposedApi: false,
      theme: {
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
      },
    });

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

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      disposeData();
      disposeExit();
      terminal.dispose();
    };
  }, [client, terminalId]);

  return (
    <div
      ref={hostRef}
      className="w-full h-full p-2.5 max-md:p-2"
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
