import type { WorkspaceState } from "../domain";

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
  "flex flex-col h-full grow-0 shrink-0 z-30 border-r border-panel-border bg-[rgba(7,10,17,0.86)] backdrop-blur-2xl transition-[width,flex-basis] duration-150 ease-out max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:basis-auto max-md:shadow-[24px_0_80px_rgba(0,0,0,0.35)]";

const SIDEBAR_COLLAPSED = "w-[66px] basis-[66px] max-md:w-[58px]";
const SIDEBAR_COLLAPSED_MAC = "w-[96px] basis-[96px] max-md:w-[88px]";
const SIDEBAR_EXPANDED = "w-[286px] basis-[286px] max-md:w-[min(82vw,286px)]";

const ICON_BUTTON =
  "app-region-no-drag inline-flex items-center justify-center w-9 h-9 min-h-9 px-0 text-xl rounded-xl border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.78)] cursor-pointer hover:border-[rgba(125,211,252,0.46)] hover:bg-[rgba(15,23,42,0.98)]";

const SECONDARY_BUTTON =
  "app-region-no-drag min-h-9 px-3 rounded-xl border border-[rgba(148,163,184,0.18)] bg-[rgba(15,23,42,0.78)] cursor-pointer hover:border-[rgba(125,211,252,0.46)] hover:bg-[rgba(15,23,42,0.98)] disabled:opacity-45 disabled:cursor-not-allowed";

const ITEM_BASE =
  "app-region-no-drag w-full flex items-center gap-3 p-2.5 mb-2 text-left rounded-2xl border";

const ITEM_COLLAPSED =
  "app-region-no-drag flex items-center justify-center w-11 h-11 mx-auto mb-2 rounded-2xl border";

const ITEM_INACTIVE =
  "text-muted-strong border-transparent bg-transparent hover:bg-[rgba(30,41,59,0.56)]";
const ITEM_ACTIVE =
  "text-fg border-[rgba(125,211,252,0.24)] bg-[rgba(14,165,233,0.15)]";

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const activeWorkspace = props.workspaces.find((workspace) =>
    workspace.id === props.activeWorkspaceId
  );

  const isMacDesktop =
    typeof window !== "undefined" &&
    window.oracleTerminal?.platform === "darwin";
  const headerClass = isMacDesktop
    ? "app-region-drag flex items-center gap-3 h-[96px] px-3.5 pt-[44px] pb-[18px] border-b border-panel-border"
    : "app-region-drag flex items-center gap-3 h-[72px] px-3.5 py-[18px] border-b border-panel-border";

  const collapsedSidebarClass = isMacDesktop
    ? SIDEBAR_COLLAPSED_MAC
    : SIDEBAR_COLLAPSED;

  return (
    <aside
      className={`${SIDEBAR_BASE} ${
        props.collapsed ? collapsedSidebarClass : SIDEBAR_EXPANDED
      }`}
    >
      <div className={headerClass}>
        <button
          className={ICON_BUTTON}
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Toggle workspace panel"
        >
          {props.collapsed ? "›" : "‹"}
        </button>
        {!props.collapsed && (
          <div className="grid gap-0.5 min-w-0">
            <span className="text-muted text-[11px] uppercase tracking-[0.16em]">
              Oracle
            </span>
            <strong className="text-sm tracking-[0.02em]">
              Terminal Canvas
            </strong>
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
              <span className="grid place-items-center shrink-0 grow-0 basis-9 w-9 h-9 rounded-xl bg-[rgba(148,163,184,0.13)] text-fg font-extrabold">
                {workspace.name.slice(0, 1).toUpperCase()}
              </span>
              {!props.collapsed && (
                <span className="grid min-w-0">
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                    {workspace.name}
                  </span>
                  <span className="text-muted text-xs">
                    {workspace.terminals.length}{" "}
                    terminal{workspace.terminals.length === 1 ? "" : "s"}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-2.5 p-3.5 border-t border-panel-border">
        <button
          className="app-region-no-drag btn-primary min-h-9 px-3 rounded-xl"
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
      </div>
    </aside>
  );
}
