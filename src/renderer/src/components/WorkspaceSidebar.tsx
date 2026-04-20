import type { CSSProperties } from "react";
import type { WorkspaceState } from "../domain";
import { useTitlebarInset } from "../services/windowChrome";
import { ThemeToggle } from "./ThemeToggle";

interface WorkspaceSidebarProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceSettings: (workspaceId: string) => void;
}

const SIDEBAR_BASE =
  "surface-sidebar flex flex-col h-full grow-0 shrink-0 z-30 border-r border-panel-border backdrop-blur-2xl transition-[width,flex-basis] duration-150 ease-out max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:basis-auto max-md:shadow-[24px_0_80px_rgba(0,0,0,0.25)]";

const SIDEBAR_COLLAPSED = "w-[66px] basis-[66px] max-md:w-[58px]";
const SIDEBAR_COLLAPSED_MAC = "w-[96px] basis-[96px] max-md:w-[88px]";
const SIDEBAR_EXPANDED = "w-[286px] basis-[286px] max-md:w-[min(82vw,286px)]";

const ICON_BUTTON =
  "app-region-no-drag chamfer surface-btn-secondary inline-flex items-center justify-center w-9 h-9 min-h-9 px-0 cursor-pointer";

const SECONDARY_BUTTON =
  "app-region-no-drag chamfer surface-btn-secondary min-h-9 min-w-0 px-1.5 text-[10px] font-medium tracking-[0.01em] text-center cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis";

const ITEM_BASE =
  "app-region-no-drag pill-rounded w-full flex items-center gap-3 p-2.5 mb-2 text-left border relative";

const ITEM_COLLAPSED =
  "app-region-no-drag pill-rounded flex items-center justify-center w-11 h-11 mx-auto mb-2 border";

const ITEM_INACTIVE = "surface-item-inactive";
const ITEM_ACTIVE = "surface-item-active";

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const activeWorkspace = props.workspaces.find((workspace) =>
    workspace.id === props.activeWorkspaceId
  );

  const isMacDesktop =
    typeof window !== "undefined" &&
    window.baton?.platform === "darwin";
  const titlebarInset = useTitlebarInset();
  const hasTitlebarInset = titlebarInset > 0;

  let headerClass: string;
  let headerStyle: CSSProperties | undefined;
  if (isMacDesktop) {
    if (props.collapsed) {
      headerClass = hasTitlebarInset
        ? "app-region-drag flex items-center justify-center h-[96px] px-2 pt-[44px] pb-[18px] border-b border-panel-border"
        : "app-region-drag flex items-center justify-center h-[72px] px-2 pt-[22px] pb-[18px] border-b border-panel-border";
    } else {
      headerClass =
        "app-region-drag flex items-center gap-3 h-[72px] pr-3.5 pt-[22px] pb-2 border-b border-panel-border";
      headerStyle = { paddingLeft: `calc(var(--titlebar-inset, 0px) + 0.875rem)` };
    }
  } else {
    headerClass =
      "app-region-drag flex items-center gap-3 h-[88px] px-3.5 pt-[28px] pb-[18px] border-b border-panel-border";
  }

  const collapsedSidebarClass = isMacDesktop && hasTitlebarInset
    ? SIDEBAR_COLLAPSED_MAC
    : SIDEBAR_COLLAPSED;

  return (
    <aside
      className={`${SIDEBAR_BASE} ${
        props.collapsed ? collapsedSidebarClass : SIDEBAR_EXPANDED
      }`}
    >
      <div className={headerClass} style={headerStyle}>
        <button
          className={ICON_BUTTON}
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Toggle workspace panel"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: props.collapsed ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 150ms ease-out",
            }}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
        {!props.collapsed && (
          <div className="grid gap-0.5 min-w-0">
            <strong className="text-sm font-semibold tracking-[0.01em] text-fg">
              Baton
            </strong>
            <span className="text-muted text-[10px] tracking-[0.24em] uppercase">
              Orchestrate terminals
            </span>
          </div>
        )}
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto p-3"
        role="list"
        aria-label="Workspaces"
      >
        {props.workspaces.map((workspace) => {
          const selected = workspace.id === props.activeWorkspaceId;
          const shellClass = props.collapsed ? ITEM_COLLAPSED : ITEM_BASE;
          return (
            <button
              key={workspace.id}
              className={`${shellClass} ${
                selected ? ITEM_ACTIVE : ITEM_INACTIVE
              }`}
              type="button"
              onClick={() => props.onSelectWorkspace(workspace.id)}
              onDoubleClick={() => props.onRenameWorkspace(workspace.id)}
              title={workspace.name}
            >
              {selected && !props.collapsed && (
                <span
                  aria-hidden
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-[2px] bg-fg"
                />
              )}
              <span className="chamfer surface-item-avatar grid place-items-center shrink-0 grow-0 basis-9 w-9 h-9 font-semibold tracking-wide">
                {workspace.name.slice(0, 1).toUpperCase()}
              </span>
              {!props.collapsed && (
                <span className="grid min-w-0">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium tracking-tight">
                    {workspace.name}
                  </span>
                  <span className="text-muted text-[11px] tracking-[0.04em]">
                    {workspace.terminals.length}{" "}
                    term{workspace.terminals.length === 1 ? "" : "s"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={`grid gap-2.5 border-t border-panel-border ${
          props.collapsed ? "p-2 justify-items-center" : "p-3.5"
        }`}
      >
        <button
          className={`app-region-no-drag btn-primary ${
            props.collapsed
              ? "blade-compact text-lg leading-none w-11 max-w-full"
              : "blade px-3 text-[12px] tracking-[0.02em] w-full"
          } min-h-9 overflow-hidden whitespace-nowrap`}
          type="button"
          onClick={props.onAddWorkspace}
          title="New workspace"
        >
          {props.collapsed ? "+" : "New workspace"}
        </button>
        {!props.collapsed && activeWorkspace && (
          <div className="grid grid-cols-3 gap-2">
            <button
              className={SECONDARY_BUTTON}
              type="button"
              onClick={() => props.onOpenWorkspaceSettings(activeWorkspace.id)}
            >
              Settings
            </button>
            <button
              className={SECONDARY_BUTTON}
              type="button"
              onClick={() => props.onRenameWorkspace(activeWorkspace.id)}
            >
              Rename
            </button>
            <button
              className={SECONDARY_BUTTON}
              type="button"
              onClick={() => props.onDeleteWorkspace(activeWorkspace.id)}
              disabled={props.workspaces.length === 1}
            >
              Delete
            </button>
          </div>
        )}
        <div className={props.collapsed ? "grid place-items-center" : "grid gap-1.5"}>
          {!props.collapsed && (
            <span className="text-muted text-[10px] tracking-[0.12em] uppercase">
              Theme
            </span>
          )}
          <ThemeToggle compact={props.collapsed} />
        </div>
      </div>
    </aside>
  );
}
