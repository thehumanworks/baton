import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "./components/Canvas";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import {
  AppPreferencesModal,
  ConfirmModal,
  FirstRunShellPrompt,
  PromptModal,
  WorkspaceSettingsModal,
} from "./components/Modal";
import {
  createTerminalWindow,
  createWorkspace,
  type TerminalWindowState,
  type ViewportState,
  type WorkspaceSettings,
  type WorkspaceState,
} from "./domain";
import { hydrateAppState, loadAppState, saveAppState } from "./persistence";
import { TerminalClientContext, useTerminalClient } from "./services/terminalContext";
import { createBufferedTerminalClient } from "./services/terminalClient";
import { ThemeProvider } from "./services/themeContext";
import { PreferencesProvider, usePreferences } from "./services/preferencesContext";
import { resolveDefaultShellLabel, shouldShowFirstRunPrompt } from "./services/preferences";
import type { ThemePreference } from "./theme";

export function App() {
  const terminalClient = useMemo(() => createBufferedTerminalClient(), []);

  return (
    <TerminalClientContext.Provider value={terminalClient}>
      <PreferencesProvider>
        <AppShell />
      </PreferencesProvider>
    </TerminalClientContext.Provider>
  );
}

function AppShell() {
  const initialState = useMemo(loadAppState, []);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>(
    initialState.workspaces,
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    initialState.activeWorkspaceId,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialState.sidebarCollapsed,
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    initialState.themePreference,
  );
  const [createPromptOpen, setCreatePromptOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [settingsTargetId, setSettingsTargetId] = useState<string | null>(null);
  const [appPreferencesOpen, setAppPreferencesOpen] = useState(false);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

  const terminalClient = useTerminalClient();
  const {
    preferences,
    shells,
    backendDefaultShellId,
    wasFreshlyCreated,
    setPreferences,
  } = usePreferences();

  const platform = window.baton?.platform ?? "darwin";
  const showFirstRunPrompt = !firstRunDismissed && shouldShowFirstRunPrompt({
    platform,
    wasFreshlyCreated,
    preferences,
  });
  const appDefaultShellLabel = resolveDefaultShellLabel(
    preferences,
    shells,
    backendDefaultShellId,
  );

  const [storageHydrated, setStorageHydrated] = useState(
    !window.baton?.appState,
  );

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
      workspaces[0];

  useEffect(() => {
    let cancelled = false;

    void hydrateAppState()
      .then((hydrated) => {
        if (cancelled || !hydrated) return;
        setWorkspaces(hydrated.workspaces);
        setActiveWorkspaceId(hydrated.activeWorkspaceId);
        setSidebarCollapsed(hydrated.sidebarCollapsed);
        setThemePreference(hydrated.themePreference);
      })
      .finally(() => {
        if (!cancelled) setStorageHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;

    const handle = window.setTimeout(() => {
      saveAppState({
        workspaces,
        activeWorkspaceId,
        sidebarCollapsed,
        themePreference,
      });
    }, 120);

    return () => {
      window.clearTimeout(handle);
    };
  }, [storageHydrated, workspaces, activeWorkspaceId, sidebarCollapsed, themePreference]);

  const handleThemeChange = useCallback((next: ThemePreference) => {
    setThemePreference(next);
  }, []);

  useEffect(() => {
    return terminalClient.onExit((event) => {
      setWorkspaces((current) =>
        current.map((workspace) => ({
          ...workspace,
          terminals: workspace.terminals.map((terminal) =>
            terminal.terminalId === event.terminalId
              ? { ...terminal, status: "exited", exitCode: event.exitCode }
              : terminal
          ),
        }))
      );
    });
  }, [terminalClient]);

  function updateWorkspace(
    workspaceId: string,
    update: (workspace: WorkspaceState) => WorkspaceState,
  ): void {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === workspaceId
          ? { ...update(workspace), updatedAt: Date.now() }
          : workspace
      )
    );
  }

  function openAddWorkspace(): void {
    setCreatePromptOpen(true);
  }

  function commitAddWorkspace(name: string): void {
    const workspace = createWorkspace(name);
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceId(workspace.id);
    setCreatePromptOpen(false);
  }

  function openRenameWorkspace(workspaceId: string): void {
    if (!workspaces.some((item) => item.id === workspaceId)) return;
    setRenameTargetId(workspaceId);
  }

  function commitRenameWorkspace(name: string): void {
    if (!renameTargetId) return;
    updateWorkspace(renameTargetId, (current) => ({ ...current, name }));
    setRenameTargetId(null);
  }

  function openWorkspaceSettings(workspaceId: string): void {
    if (!workspaces.some((item) => item.id === workspaceId)) return;
    setSettingsTargetId(workspaceId);
  }

  function commitWorkspaceSettings(settings: WorkspaceSettings): void {
    if (!settingsTargetId) return;
    updateWorkspace(settingsTargetId, (current) => ({ ...current, settings }));
    setSettingsTargetId(null);
  }

  function openDeleteWorkspace(workspaceId: string): void {
    if (workspaces.length === 1) return;
    if (!workspaces.some((item) => item.id === workspaceId)) return;
    setDeleteTargetId(workspaceId);
  }

  function commitDeleteWorkspace(): void {
    const workspaceId = deleteTargetId;
    if (!workspaceId) return;
    if (workspaces.length === 1) {
      setDeleteTargetId(null);
      return;
    }

    const workspace = workspaces.find((item) => item.id === workspaceId);
    const terminalsToClose = workspace?.terminals.map((terminal) =>
      terminal.terminalId
    ).filter(Boolean) as string[] | undefined;
    terminalsToClose?.forEach((terminalId) =>
      void terminalClient.close(terminalId)
    );

    const remaining = workspaces.filter((item) => item.id !== workspaceId);
    setWorkspaces(remaining);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId(remaining[0].id);
    }
    setDeleteTargetId(null);
  }

  function updateViewport(workspaceId: string, viewport: ViewportState): void {
    updateWorkspace(workspaceId, (workspace) => ({ ...workspace, viewport }));
  }

  function addTerminal(
    workspaceId: string,
    input: { x: number; y: number; width?: number; height?: number },
  ): void {
    updateWorkspace(workspaceId, (workspace) => {
      const nextZ = Math.max(
        0,
        ...workspace.terminals.map((terminal) => terminal.z),
      ) + 1;
      const terminal = createTerminalWindow({
        ...input,
        z: nextZ,
        index: workspace.terminals.length + 1,
      });

      return {
        ...workspace,
        terminals: [...workspace.terminals, terminal],
      };
    });
  }

  function patchTerminal(
    workspaceId: string,
    terminalWindowId: string,
    patch: Partial<TerminalWindowState>,
  ): void {
    updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === terminalWindowId ? { ...terminal, ...patch } : terminal
      ),
    }));
  }

  function closeTerminal(workspaceId: string, terminalWindowId: string): void {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const terminal = workspace?.terminals.find((item) =>
      item.id === terminalWindowId
    );
    if (terminal?.terminalId) void terminalClient.close(terminal.terminalId);

    updateWorkspace(workspaceId, (current) => ({
      ...current,
      terminals: current.terminals.filter((item) =>
        item.id !== terminalWindowId
      ),
    }));
  }

  function toggleTerminalMinimized(
    workspaceId: string,
    terminalWindowId: string,
  ): void {
    updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === terminalWindowId
          ? { ...terminal, minimized: !terminal.minimized }
          : terminal
      ),
    }));
  }

  function bringTerminalToFront(
    workspaceId: string,
    terminalWindowId: string,
  ): void {
    updateWorkspace(workspaceId, (workspace) => {
      const current = workspace.terminals.find((terminal) =>
        terminal.id === terminalWindowId
      );
      const nextZ = Math.max(
        0,
        ...workspace.terminals.map((terminal) => terminal.z),
      ) + 1;
      if (!current || current.z === nextZ) return workspace;

      return {
        ...workspace,
        terminals: workspace.terminals.map((terminal) =>
          terminal.id === terminalWindowId
            ? { ...terminal, z: nextZ }
            : terminal
        ),
      };
    });
  }

  if (!activeWorkspace) return null;

  const renameTarget = renameTargetId
    ? workspaces.find((item) => item.id === renameTargetId) ?? null
    : null;
  const deleteTarget = deleteTargetId
    ? workspaces.find((item) => item.id === deleteTargetId) ?? null
    : null;
  const settingsTarget = settingsTargetId
    ? workspaces.find((item) => item.id === settingsTargetId) ?? null
    : null;

  return (
    <ThemeProvider
      preference={themePreference}
      onPreferenceChange={handleThemeChange}
    >
      <main className="app-bg flex w-full h-full min-w-0 min-h-0">
        <WorkspaceSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace.id}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onSelectWorkspace={setActiveWorkspaceId}
          onAddWorkspace={openAddWorkspace}
          onRenameWorkspace={openRenameWorkspace}
          onDeleteWorkspace={openDeleteWorkspace}
          onOpenWorkspaceSettings={openWorkspaceSettings}
          onOpenAppPreferences={() => setAppPreferencesOpen(true)}
        />
        <Canvas
          workspace={activeWorkspace}
          terminalMode={terminalClient.mode}
          appDefaultShellId={preferences.terminal.defaultShellId}
          onViewportChange={(viewport) =>
            updateViewport(activeWorkspace.id, viewport)}
          onAddTerminal={(input) => addTerminal(activeWorkspace.id, input)}
          onPatchTerminal={(terminalWindowId, patch) =>
            patchTerminal(activeWorkspace.id, terminalWindowId, patch)}
          onCloseTerminal={(terminalWindowId) =>
            closeTerminal(activeWorkspace.id, terminalWindowId)}
          onToggleTerminalMinimized={(terminalWindowId) =>
            toggleTerminalMinimized(activeWorkspace.id, terminalWindowId)}
          onBringTerminalToFront={(terminalWindowId) =>
            bringTerminalToFront(activeWorkspace.id, terminalWindowId)}
        />
      </main>
      <PromptModal
        open={createPromptOpen}
        title="New workspace"
        label="Workspace name"
        initialValue={`Workspace ${workspaces.length + 1}`}
        confirmLabel="Create"
        onSubmit={commitAddWorkspace}
        onCancel={() => setCreatePromptOpen(false)}
      />
      <PromptModal
        open={Boolean(renameTarget)}
        title="Rename workspace"
        label="Workspace name"
        initialValue={renameTarget?.name ?? ""}
        confirmLabel="Rename"
        onSubmit={commitRenameWorkspace}
        onCancel={() => setRenameTargetId(null)}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete workspace"
        message={`Delete workspace "${
          deleteTarget?.name ?? "Untitled"
        }"? Running terminals in that workspace will be closed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={commitDeleteWorkspace}
        onCancel={() => setDeleteTargetId(null)}
      />
      <WorkspaceSettingsModal
        open={Boolean(settingsTarget)}
        workspaceName={settingsTarget?.name ?? ""}
        initialSettings={settingsTarget?.settings ?? {}}
        shells={shells}
        appDefaultShellLabel={appDefaultShellLabel}
        onSubmit={commitWorkspaceSettings}
        onCancel={() => setSettingsTargetId(null)}
      />
      <AppPreferencesModal
        open={appPreferencesOpen}
        preferences={preferences}
        shells={shells}
        backendDefaultShellId={backendDefaultShellId}
        onSubmit={async (next) => {
          await setPreferences(next);
          setAppPreferencesOpen(false);
        }}
        onCancel={() => setAppPreferencesOpen(false)}
      />
      <FirstRunShellPrompt
        open={showFirstRunPrompt}
        shells={shells}
        backendDefaultShellId={backendDefaultShellId}
        onSubmit={async (defaultShellId) => {
          await setPreferences({
            version: 1,
            terminal: { defaultShellId },
          });
          setFirstRunDismissed(true);
        }}
        onDecideLater={() => setFirstRunDismissed(true)}
      />
    </ThemeProvider>
  );
}
