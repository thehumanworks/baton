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
        'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.18,
      scrollback: 10000,
      allowProposedApi: false,
      theme: {
        background: "#090d15",
        foreground: "#d7dde8",
        cursor: "#f2f5f8",
        selectionBackground: "#34445f",
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
