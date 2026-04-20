import type { ShellDescriptorDTO } from "@shared/terminal-types";

const PANEL_INPUT = "chamfer surface-input min-h-10 px-3 outline-none";

interface ShellPickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  shells: readonly ShellDescriptorDTO[];
  appDefaultLabel?: string;
  /**
   * When true, the picker renders a "Use app default (…)" row that selects
   * the literal value "". This is what the workspace settings modal uses to
   * represent "inherit from app-level preference".
   */
  includeAppDefaultRow?: boolean;
  /**
   * When true, the picker renders an "Auto-detect" row that selects the
   * literal value "auto". This is what the app preferences modal uses.
   */
  includeAutoRow?: boolean;
}

export function ShellPicker(props: ShellPickerProps) {
  return (
    <select
      id={props.id}
      className={PANEL_INPUT}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.includeAppDefaultRow && (
        <option value="">
          {props.appDefaultLabel
            ? `Use app default (${props.appDefaultLabel})`
            : "Use app default"}
        </option>
      )}
      {props.includeAutoRow && (
        <option value="auto">
          {props.appDefaultLabel
            ? `Auto-detect (${props.appDefaultLabel})`
            : "Auto-detect"}
        </option>
      )}
      {props.shells.map((shell) => (
        <option key={shell.id} value={shell.id}>
          {shell.label}
        </option>
      ))}
    </select>
  );
}
