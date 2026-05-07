import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  ConnectionMode,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  type OnReconnect,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Save, RotateCcw, Plus, Sun, Moon } from "lucide-react";
import { useAgentAssignments } from "@/hooks/useAgentAssignments";
import {
  useWorkflowConfig,
  useSaveWorkflowConfig,
  type WorkflowConfig,
  type StateCategory,
} from "@/hooks/useWorkflowConfig";
import { fsmNodeTypes, type FSMNodeData } from "@/components/workflow-editor/FSMNode";
import { fsmEdgeTypes, type FSMEdgeData } from "@/components/workflow-editor/FSMEdge";
import { TransitionPanel } from "@/components/workflow-editor/TransitionPanel";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";

// ── State catalogue ───────────────────────────────────────────────────────────

const STATE_META: Record<string, { category: StateCategory }> = {
  draft:             { category: "active"    },
  planned:           { category: "active"    },
  implementing:      { category: "active"    },
  reviewing:         { category: "active"    },
  changes_requested: { category: "active"    },
  approved:          { category: "active"    },
  conflict_detected: { category: "active"    },
  merged:            { category: "success"   },
  abandoned:         { category: "fail"      },
  escalated:         { category: "escalated" },
};

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  draft:             { x: 0,    y: 150 },
  planned:           { x: 310,  y: 150 },
  implementing:      { x: 620,  y: 150 },
  reviewing:         { x: 940,  y: 150 },
  approved:          { x: 1260, y: 150 },
  merged:            { x: 1580, y: 50  },
  abandoned:         { x: 0,    y: 430 },
  changes_requested: { x: 620,  y: 450 },
  escalated:         { x: 940,  y: 540 },
  conflict_detected: { x: 1260, y: 450 },
};

const CIRCUIT_BREAKER_THRESHOLD = 3;

// ── Edge builder helpers ──────────────────────────────────────────────────────

function handles(from: string, to: string): { sourceHandle?: string; targetHandle?: string } {
  if (
    (from === "reviewing" && (to === "changes_requested" || to === "escalated")) ||
    (from === "approved"  && to === "conflict_detected")
  ) {
    return { sourceHandle: "bottom" };
  }
  if (
    (from === "changes_requested" && to === "implementing") ||
    (from === "conflict_detected" && (to === "implementing" || to === "reviewing"))
  ) {
    return { targetHandle: "bottom" };
  }
  return {};
}

function buildEdges(
  config: WorkflowConfig,
  selectedId: string | null
): Edge<FSMEdgeData>[] {
  const hitl   = new Set(config.hitlGatedTriggers);
  const result: Edge<FSMEdgeData>[] = [];

  for (const t of config.transitions) {
    if (t.trigger === "abandon") continue;
    const isHitl = hitl.has(t.trigger);
    const color  = isHitl ? "#2563eb" : "#d97706";
    const h      = handles(t.from, t.to);

    result.push({
      id: `${t.from}--${t.trigger}--${t.to}`,
      source: t.from,
      target: t.to,
      ...h,
      type: "fsmEdge",
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: { trigger: t.trigger, isHitl, isCircuitBreaker: false } as FSMEdgeData,
      selected: `${t.from}--${t.trigger}--${t.to}` === selectedId,
    });
  }

  result.push({
    id: "cb-reviewing-escalated",
    source: "reviewing",
    target: "escalated",
    sourceHandle: "bottom",
    type: "fsmEdge",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#b91c1c" },
    data: {
      trigger: `circuit_breaker (${CIRCUIT_BREAKER_THRESHOLD}× request_changes)`,
      isHitl: false,
      isCircuitBreaker: true,
    } as FSMEdgeData,
    selected: "cb-reviewing-escalated" === selectedId,
  });

  return result;
}

// ── Public export — wraps with ThemeProvider ──────────────────────────────────

export function FlowDiagram() {
  return (
    <ThemeProvider>
      <FlowDiagramInner />
    </ThemeProvider>
  );
}

// ── Inner component ───────────────────────────────────────────────────────────

function FlowDiagramInner() {
  const { palette: p, isDark, toggleTheme } = useTheme();
  const { data: assignments = [] }          = useAgentAssignments();
  const { data: serverConfig, isLoading, isError } = useWorkflowConfig();
  const saveWorkflow = useSaveWorkflowConfig();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FSMNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<FSMEdgeData>>([]);
  const [localConfig, setLocalConfig]    = useState<WorkflowConfig | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isDirty, setIsDirty]           = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [showAddState, setShowAddState] = useState(false);

  // Sync server config → local on first load (or server refresh)
  useEffect(() => {
    if (serverConfig && !isDirty) setLocalConfig(serverConfig);
  }, [serverConfig, isDirty]);

  // Group enabled assignments by fsm_state
  const assignmentsByState = useMemo(() => {
    const map: Record<string, Array<{ role: string; tool: string; model: string }>> = {};
    for (const a of assignments) {
      if (!a.enabled) continue;
      (map[a.fsm_state] ??= []).push({ role: a.role, tool: a.tool, model: "" });
    }
    return map;
  }, [assignments]);

  // Build nodes whenever config or assignments change
  useEffect(() => {
    if (!localConfig) return;
    const saved        = localConfig.layout ?? {};
    const customStates = localConfig.states ?? {};

    const allStates: Record<string, { category: StateCategory }> = {
      ...STATE_META,
      ...Object.fromEntries(
        Object.entries(customStates).map(([s, v]) => [s, { category: v.category as StateCategory }])
      ),
    };

    const newNodes: Node<FSMNodeData>[] = Object.entries(allStates).map(
      ([state, { category }]) => {
        const stateAssignments = assignmentsByState[state] ?? [];
        const noAgent = category === "active" && stateAssignments.length === 0;
        return {
          id: state,
          type: "fsmStateNode",
          position: saved[state] ?? DEFAULT_POSITIONS[state] ?? { x: 0, y: 0 },
          data: {
            state,
            category,
            assignments: stateAssignments,
            isTerminal: category !== "active",
            noAgent,
            abandonNote: state === "abandoned",
          } as FSMNodeData,
        };
      }
    );
    setNodes(newNodes);
  }, [localConfig, assignmentsByState, setNodes]);

  // Build edges whenever config or selection changes
  useEffect(() => {
    if (!localConfig) return;
    setEdges(buildEdges(localConfig, selectedEdgeId));
  }, [localConfig, selectedEdgeId, setEdges]);

  // ── Node drag → save layout ───────────────────────────────────────────────
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<FSMNodeData>>[]) => {
      onNodesChange(changes);
      const dragEnded = changes.some(
        (c) => c.type === "position" && !c.dragging && c.position
      );
      if (dragEnded && localConfig) {
        const updatedLayout = { ...localConfig.layout };
        for (const c of changes) {
          if (c.type === "position" && !c.dragging && c.position) {
            updatedLayout[c.id] = c.position;
          }
        }
        setLocalConfig({ ...localConfig, layout: updatedLayout });
        setIsDirty(true);
      }
    },
    [onNodesChange, localConfig]
  );

  // ── Edge reconnect → update transition ────────────────────────────────────
  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds) as Edge<FSMEdgeData>[]);
      if (!localConfig) return;
      const parts = oldEdge.id.split("--");
      if (parts.length !== 3) return;
      const [from, trigger, to] = parts;
      const updated = {
        ...localConfig,
        transitions: localConfig.transitions.map((t) =>
          t.from === from && t.trigger === trigger && t.to === to
            ? { from: newConnection.source!, trigger, to: newConnection.target! }
            : t
        ),
      };
      const newId = `${newConnection.source}--${trigger}--${newConnection.target}`;
      setEdges((eds) =>
        eds.map((e) => (e.id === oldEdge.id ? { ...e, id: newId } : e))
      );
      setLocalConfig(updated);
      setIsDirty(true);
      if (selectedEdgeId === oldEdge.id) setSelectedEdgeId(newId);
    },
    [setEdges, localConfig, selectedEdgeId]
  );

  // ── New connection → add transition ───────────────────────────────────────
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const trigger = "new_trigger";
      const newId   = `${connection.source}--${trigger}--${connection.target}`;
      const newEdge: Edge<FSMEdgeData> = {
        id: newId,
        source: connection.source,
        target: connection.target,
        type: "fsmEdge",
        markerEnd: { type: MarkerType.ArrowClosed, color: p.amber },
        data: { trigger, isHitl: false, isCircuitBreaker: false },
      };
      setEdges((eds) => addEdge(newEdge, eds) as Edge<FSMEdgeData>[]);
      if (localConfig) {
        setLocalConfig({
          ...localConfig,
          transitions: [
            ...localConfig.transitions,
            { from: connection.source, to: connection.target, trigger },
          ],
        });
        setIsDirty(true);
      }
      setSelectedEdgeId(newId);
    },
    [setEdges, localConfig, p.amber]
  );

  // ── Panel callbacks ────────────────────────────────────────────────────────
  const handleTransitionUpdate = useCallback(
    (edgeId: string, updates: { trigger?: string; isHitl?: boolean }) => {
      if (!localConfig) return;
      const parts = edgeId.split("--");
      if (parts.length !== 3) return;
      const [from, oldTrigger, to] = parts;
      const newTrigger = updates.trigger ?? oldTrigger;

      let updated = { ...localConfig };

      if (updates.trigger && updates.trigger !== oldTrigger) {
        updated = {
          ...updated,
          transitions: updated.transitions.map((t) =>
            t.from === from && t.trigger === oldTrigger && t.to === to
              ? { ...t, trigger: newTrigger }
              : t
          ),
          hitlGatedTriggers: updated.hitlGatedTriggers.map((ht) =>
            ht === oldTrigger ? newTrigger : ht
          ),
        };
      }

      if (updates.isHitl !== undefined) {
        const already = updated.hitlGatedTriggers.includes(newTrigger);
        updated = {
          ...updated,
          hitlGatedTriggers: updates.isHitl
            ? already ? updated.hitlGatedTriggers : [...updated.hitlGatedTriggers, newTrigger]
            : updated.hitlGatedTriggers.filter((t) => t !== newTrigger),
        };
      }

      setLocalConfig(updated);
      setIsDirty(true);
      if (updates.trigger && updates.trigger !== oldTrigger) {
        setSelectedEdgeId(`${from}--${newTrigger}--${to}`);
      }
    },
    [localConfig]
  );

  const handleTransitionDelete = useCallback(
    (edgeId: string) => {
      if (!localConfig) return;
      const parts = edgeId.split("--");
      if (parts.length !== 3) return;
      const [from, trigger, to] = parts;
      setLocalConfig({
        ...localConfig,
        transitions: localConfig.transitions.filter(
          (t) => !(t.from === from && t.trigger === trigger && t.to === to)
        ),
      });
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setIsDirty(true);
      setSelectedEdgeId(null);
    },
    [localConfig, setEdges]
  );

  // ── Add new state node ────────────────────────────────────────────────────
  const existingStates = useMemo(
    () => new Set([
      ...Object.keys(STATE_META),
      ...Object.keys(localConfig?.states ?? {}),
      ...(localConfig?.transitions.flatMap((t) => [t.from, t.to]) ?? []),
    ]),
    [localConfig]
  );

  const commitAddState = useCallback(
    (name: string, category: StateCategory) => {
      if (!localConfig) return;
      const customCount = Object.keys(localConfig.states ?? {}).length;
      const x = 200 + (customCount % 4) * 260;
      const y = 700 + Math.floor(customCount / 4) * 140;
      setLocalConfig({
        ...localConfig,
        layout: { ...localConfig.layout, [name]: { x, y } },
        states: { ...(localConfig.states ?? {}), [name]: { category } },
      });
      setIsDirty(true);
      setShowAddState(false);
    },
    [localConfig]
  );

  // ── Save & Reset ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!localConfig) return;
    setSaveError(null);
    try {
      await saveWorkflow.mutateAsync(localConfig);
      setIsDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  }, [localConfig, saveWorkflow]);

  const handleResetLayout = useCallback(() => {
    if (!localConfig) return;
    // Only reset built-in states; preserve custom state positions
    const customLayout: Record<string, { x: number; y: number }> = {};
    for (const [id, pos] of Object.entries(localConfig.layout)) {
      if (!(id in STATE_META)) customLayout[id] = pos;
    }
    setLocalConfig({ ...localConfig, layout: customLayout });
    setIsDirty(true);
  }, [localConfig]);

  // ── Selected edge for panel ───────────────────────────────────────────────
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [selectedEdgeId, edges]
  );

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ height: "calc(100vh - 48px)", display: "flex", alignItems: "center", justifyContent: "center", background: p.canvasBg, color: p.textMuted, fontSize: 13 }}>
        Loading workflow…
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ height: "calc(100vh - 48px)", display: "flex", alignItems: "center", justifyContent: "center", background: p.canvasBg, color: p.textRed, fontSize: 13 }}>
        Failed to load workflow config.
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column", background: p.canvasBg }}>

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px",
          height: 48,
          background: p.headerBg,
          borderBottom: `1px solid ${p.headerBorder}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontWeight: 700, color: p.text, fontSize: 13 }}>
            FSM Workflow
          </span>

          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: p.textMuted }}>
            <LegendItem color={p.amber}   label="agent transition" />
            <LegendItem color={p.blue}    label="HUMAN required"   solid />
            <LegendItem color="#b91c1c"   label="circuit breaker"  dashed />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saveError && (
            <span style={{ fontSize: 11, color: p.textRed }}>{saveError}</span>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              background: "none",
              border: `1px solid ${p.headerBorder}`,
              borderRadius: 6,
              color: p.textMuted,
              cursor: "pointer",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = p.amber;
              e.currentTarget.style.color = p.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = p.headerBorder;
              e.currentTarget.style.color = p.textMuted;
            }}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <ToolButton onClick={() => setShowAddState(true)} title="Add state node">
            <Plus size={14} />
            Add State
          </ToolButton>

          <ToolButton onClick={handleResetLayout} title="Reset to default positions">
            <RotateCcw size={14} />
            Reset layout
          </ToolButton>

          <button
            onClick={handleSave}
            disabled={!isDirty || saveWorkflow.isPending}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              background: isDirty ? p.amber : p.inputBg,
              border: `1px solid ${isDirty ? p.amber : p.headerBorder}`,
              borderRadius: 6,
              color: isDirty ? "#000" : p.textMuted,
              fontSize: 12,
              fontWeight: 600,
              cursor: isDirty ? "pointer" : "not-allowed",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            <Save size={13} />
            {saveWorkflow.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* ── Canvas + side panel ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative" as const }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            nodeTypes={fsmNodeTypes}
            edgeTypes={fsmEdgeTypes}
            connectionMode={ConnectionMode.Loose}
            edgesReconnectable
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.15}
            maxZoom={2.5}
            colorMode={p.rfColorMode}
            proOptions={{ hideAttribution: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color={p.bgDots}
            />
            <Controls
              position="bottom-left"
              style={{
                background: p.headerBg,
                border: `1px solid ${p.headerBorder}`,
                borderRadius: 8,
              }}
            />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as FSMNodeData;
                if (d.category === "success")   return "#15803d";
                if (d.category === "fail")      return "#b91c1c";
                if (d.category === "escalated") return "#c2410c";
                if (d.noAgent)                  return "#78350f";
                return "#d97706";
              }}
              maskColor={p.minimapMask}
              style={{
                background: p.minimapBg,
                border: `1px solid ${p.headerBorder}`,
                borderRadius: 8,
              }}
            />
          </ReactFlow>
        </div>

        {selectedEdge && (
          <TransitionPanel
            edge={selectedEdge as Edge<FSMEdgeData>}
            onUpdate={handleTransitionUpdate}
            onDelete={handleTransitionDelete}
            onClose={() => setSelectedEdgeId(null)}
          />
        )}
      </div>

      {showAddState && (
        <AddStateDialog
          existingStates={existingStates}
          onConfirm={commitAddState}
          onClose={() => setShowAddState(false)}
        />
      )}
    </div>
  );
}

// ── Small helper components ───────────────────────────────────────────────────

function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  solid?: boolean;
  dashed?: boolean;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          display: "inline-block",
          width: 22,
          height: 0,
          borderTop: `1.5px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      {label}
    </span>
  );
}

function ToolButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  const { palette: p } = useTheme();
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        background: "none",
        border: `1px solid ${p.headerBorder}`,
        borderRadius: 6,
        color: p.textMuted,
        fontSize: 12,
        cursor: "pointer",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = p.inputBorder;
        e.currentTarget.style.color = p.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = p.headerBorder;
        e.currentTarget.style.color = p.textMuted;
      }}
    >
      {children}
    </button>
  );
}

// ── Add State dialog ──────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: Array<{ value: StateCategory; label: string; color: string; desc: string }> = [
  { value: "active",    label: "Active",    color: "#d97706", desc: "Normal workflow state; agents can run here" },
  { value: "success",   label: "Success",   color: "#15803d", desc: "Terminal — workflow completed successfully" },
  { value: "fail",      label: "Fail",      color: "#b91c1c", desc: "Terminal — workflow abandoned or failed" },
  { value: "escalated", label: "Escalated", color: "#c2410c", desc: "Terminal — requires manual intervention" },
];

function AddStateDialog({
  existingStates,
  onConfirm,
  onClose,
}: {
  existingStates: Set<string>;
  onConfirm: (name: string, category: StateCategory) => void;
  onClose: () => void;
}) {
  const { palette: p } = useTheme();
  const [name, setName]         = useState("");
  const [category, setCategory] = useState<StateCategory>("active");
  const [error, setError]       = useState<string | null>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleNameChange(v: string) {
    setName(v.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+/, ""));
    setError(null);
  }

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) { setError("State name is required."); return; }
    if (existingStates.has(trimmed)) { setError(`"${trimmed}" already exists.`); return; }
    onConfirm(trimmed, category);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: p.panelBg,
          border: `1px solid ${p.panelBorder}`,
          borderRadius: 12,
          width: 380,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          color: p.text,
          fontFamily: "'Inter',-apple-system,sans-serif",
          fontSize: 13,
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${p.panelBorder}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Add state</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: p.textMuted, fontSize: 18, lineHeight: 1, padding: "0 2px" }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 18px 6px" }}>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: p.textMuted, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
              State name
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder="my_state_name"
              style={{
                width: "100%",
                padding: "8px 10px",
                background: p.inputBg,
                border: `1px solid ${error ? p.red : p.inputBorder}`,
                borderRadius: 7,
                color: p.text,
                fontSize: 13,
                fontFamily: "'SF Mono','Fira Code',monospace",
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = p.amber; }}
              onBlur={(e) => { if (!error) e.currentTarget.style.borderColor = p.inputBorder; }}
            />
            {error && <p style={{ marginTop: 5, fontSize: 11, color: p.textRed }}>{error}</p>}
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: p.textMuted, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
              Category
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "9px 12px",
                    background: category === opt.value ? `${opt.color}14` : p.inputBg,
                    border: `1px solid ${category === opt.value ? opt.color : p.inputBorder}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: opt.color, flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: category === opt.value ? opt.color : p.text }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: p.textMuted, marginTop: 1 }}>{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 18px 16px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              background: "none",
              border: `1px solid ${p.inputBorder}`,
              borderRadius: 7,
              color: p.textMuted,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!name.trim()}
            style={{
              padding: "7px 18px",
              background: name.trim() ? p.amber : p.inputBg,
              border: `1px solid ${name.trim() ? p.amber : p.inputBorder}`,
              borderRadius: 7,
              color: name.trim() ? "#000" : p.textMuted,
              fontSize: 13,
              fontWeight: 700,
              cursor: name.trim() ? "pointer" : "not-allowed",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            Add state
          </button>
        </div>
      </div>
    </div>
  );
}
