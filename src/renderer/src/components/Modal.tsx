import { useEffect, useRef, useState } from "react";
import type { WorkspaceSettings } from "../domain";

const BACKDROP =
  "surface-modal-scrim fixed inset-0 z-[100] grid place-items-center p-6 backdrop-blur-md";

const PANEL =
  "notch surface-modal-panel w-[min(440px,100%)] grid gap-3.5 p-6";

const PANEL_TITLE = "text-[14px] font-semibold tracking-[0.01em] text-fg";
const PANEL_LABEL = "text-muted text-[11px] tracking-[0.04em]";
const PANEL_MESSAGE = "text-muted-strong text-[13px] leading-[1.5]";
const PANEL_INPUT =
  "chamfer surface-input min-h-10 px-3 outline-none";
const PANEL_ACTIONS = "flex justify-end gap-2.5 mt-2";

const ACTION_BUTTON =
  "chamfer surface-btn-secondary min-h-9 px-4 text-[12px] tracking-[0.02em] cursor-pointer";

interface PromptModalProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal(props: PromptModalProps) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) return;
    setValue(props.initialValue ?? "");
  }, [props.open, props.initialValue]);

  useEffect(() => {
    if (!props.open) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [props.open]);

  if (!props.open) return null;

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    props.onSubmit(trimmed);
  }

  return (
    <div className={BACKDROP} role="presentation" onMouseDown={props.onCancel}>
      <div
        className={PANEL}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) =>
          event.stopPropagation()}
      >
        <div className={PANEL_TITLE}>{props.title}</div>
        {props.label && (
          <label className={PANEL_LABEL} htmlFor="modal-prompt-input">
            {props.label}
          </label>
        )}
        <input
          id="modal-prompt-input"
          ref={inputRef}
          className={PANEL_INPUT}
          type="text"
          value={value}
          onChange={(event) =>
            setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
        <div className={PANEL_ACTIONS}>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className="btn-primary blade min-h-9 px-4 text-[12px] tracking-[0.02em] whitespace-nowrap"
            onClick={submit}
            disabled={!value.trim()}
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface WorkspaceSettingsModalProps {
  open: boolean;
  workspaceName: string;
  initialSettings: WorkspaceSettings;
  onSubmit: (settings: WorkspaceSettings) => void;
  onCancel: () => void;
}

export function WorkspaceSettingsModal(props: WorkspaceSettingsModalProps) {
  const [startCommand, setStartCommand] = useState(
    props.initialSettings.startCommand ?? "",
  );
  const [defaultCwd, setDefaultCwd] = useState(
    props.initialSettings.defaultCwd ?? "",
  );
  const startInputRef = useRef<HTMLInputElement>(null);

  const canPickDirectory =
    typeof window !== "undefined" &&
    typeof window.oracleTerminal?.workspace?.pickDirectory === "function";

  useEffect(() => {
    if (!props.open) return;
    setStartCommand(props.initialSettings.startCommand ?? "");
    setDefaultCwd(props.initialSettings.defaultCwd ?? "");
  }, [props.open, props.initialSettings]);

  useEffect(() => {
    if (!props.open) return;
    const raf = requestAnimationFrame(() => {
      startInputRef.current?.focus();
      startInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [props.open]);

  if (!props.open) return null;

  function submit(): void {
    const next: WorkspaceSettings = {};
    const trimmedCommand = startCommand.trim();
    if (trimmedCommand) next.startCommand = trimmedCommand;
    const trimmedCwd = defaultCwd.trim();
    if (trimmedCwd) next.defaultCwd = trimmedCwd;
    props.onSubmit(next);
  }

  async function browseForDirectory(): Promise<void> {
    const bridge = window.oracleTerminal?.workspace;
    if (!bridge?.pickDirectory) return;
    const result = await bridge.pickDirectory();
    if (!result.canceled && result.path) {
      setDefaultCwd(result.path);
    }
  }

  return (
    <div className={BACKDROP} role="presentation" onMouseDown={props.onCancel}>
      <div
        className={PANEL}
        role="dialog"
        aria-modal="true"
        aria-label={`Workspace settings · ${props.workspaceName}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          }
        }}
      >
        <div className={PANEL_TITLE}>
          Workspace settings · {props.workspaceName}
        </div>

        <label className={PANEL_LABEL} htmlFor="workspace-start-command">
          Start command
        </label>
        <input
          id="workspace-start-command"
          ref={startInputRef}
          className={PANEL_INPUT}
          type="text"
          placeholder="e.g. claude"
          value={startCommand}
          onChange={(event) => setStartCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className={PANEL_MESSAGE}>
          Runs once inside each newly spawned terminal. Leave empty for a plain
          shell.
        </div>

        <label className={PANEL_LABEL} htmlFor="workspace-default-cwd">
          Default directory
        </label>
        <div className="flex gap-2">
          <input
            id="workspace-default-cwd"
            className={`${PANEL_INPUT} flex-1 min-w-0`}
            type="text"
            placeholder="Defaults to your home directory"
            value={defaultCwd}
            onChange={(event) => setDefaultCwd(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
          {canPickDirectory && (
            <button
              type="button"
              className={ACTION_BUTTON}
              onClick={() => void browseForDirectory()}
            >
              Browse…
            </button>
          )}
        </div>
        <div className={PANEL_MESSAGE}>
          ~, $VAR, and %VAR% are expanded. Invalid or missing paths fall back
          to your home directory.
        </div>

        <div className={PANEL_ACTIONS}>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary blade min-h-9 px-4 text-[12px] tracking-[0.02em] whitespace-nowrap"
            onClick={submit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal(props: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    const raf = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [props.open]);

  if (!props.open) return null;

  const confirmClass = props.destructive
    ? "btn-danger blade min-h-9 px-4 text-[12px] tracking-[0.02em] whitespace-nowrap"
    : "btn-primary blade min-h-9 px-4 text-[12px] tracking-[0.02em] whitespace-nowrap";

  return (
    <div className={BACKDROP} role="presentation" onMouseDown={props.onCancel}>
      <div
        className={PANEL}
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) =>
          event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          }
        }}
      >
        <div className={PANEL_TITLE}>{props.title}</div>
        <div className={PANEL_MESSAGE}>{props.message}</div>
        <div className={PANEL_ACTIONS}>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={confirmClass}
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
