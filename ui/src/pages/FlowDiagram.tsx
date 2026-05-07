import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  BackgroundVariant,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@/components/ThemeProvider";
import { useAgentAssignments } from "@/hooks/useAgentAssignments";
import { useFSMMeta } from "@/hooks/useFSMMeta";
import { TOOL_LABELS } from "@/types";

// ── State metadata ──────────────────────────────────────────────────────────

type StateCategory = "active" | "success" | "fail" | "escalated";

const STATE_META: Record<string, { label: string; category: StateCategory }> = {
  draft:             { label: "draft",             category: "active" },
  planned:           { label: "planned",           category: "active" },
  implementing:      { label: "implementing",      category: "active" },
  reviewing:         { label: "reviewing",         category: "active" },
  changes_requested: { label: "changes_requested", category: "active" },
  approved:          { label: "approved",          category: "active" },
  conflict_detected: { label: "conflict_detected", category: "active" },
  merged:            { label: "merged",            category: "success" },
  abandoned:         { label: "abandoned",         category: "fail" },
  escalated:         { label: "escalated",         category: "escalated" },
};

// Default positions — wider spacing so edge labels have room to breathe.
// Gap between adjacent main-row nodes: ~130px (position delta 360, node width ~230).
const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  // Main lifecycle (left → right)
  draft:             { x: 0,    y: 200 },
  planned:           { x: 360,  y: 200 },
  implementing:      { x: 720,  y: 200 },
  reviewing:         { x: 1100, y: 200 },
  approved:          { x: 1460, y: 200 },
  merged:            { x: 1820, y: 80  },
  // Cycle states (below main row)
  changes_requested: { x: 920,  y: 490 },
  conflict_detected: { x: 1460, y: 490 },
  // Terminal states (bottom)
  abandoned:         { x: 720,  y: 750 },
  escalated:         { x: 1100, y: 750 },
};

const POSITIONS_KEY = "fsm-diagram-positions";

function loadSavedPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ── Style helpers ───────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<
  StateCategory,
  { border: string; headerColor: string; badge?: string }
> = {
  active:    { border: "hsl(var(--border))",                     headerColor: "hsl(var(--card-foreground))" },
  success:   { border: "hsl(var(--status-merged))",              headerColor: "hsl(var(--status-merged))",              badge: "TERMINAL" },
  fail:      { border: "hsl(var(--status-abandoned))",           headerColor: "hsl(var(--status-abandoned))",           badge: "TERMINAL" },
  escalated: { border: "hsl(var(--status-changes-requested))",   headerColor: "hsl(var(--status-changes-requested))",   badge: "TERMINAL" },
};

function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

// ── Custom node ─────────────────────────────────────────────────────────────

interface FSMNodeData extends Record<string, unknown> {
  state: string;
  category: StateCategory;
  assignments: Array<{ role: string; tool: string; model: string }>;
  isTerminal: boolean;
  abandonNote?: boolean;
  noAgent?: boolean; // active state with zero enabled assignments
}

function FSMNode({ data }: NodeProps) {
  const d = data as FSMNodeData;
  const styles = CATEGORY_STYLES[d.category];
  const borderColor = d.noAgent
    ? "hsl(var(--status-reviewing))"   // amber — warning
    : styles.border;

  const hasContent = d.assignments.length > 0 || d.abandonNote || d.noAgent;

  return (
    <div
      style={{
        background: "hsl(var(--card))",
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        minWidth: 200,
        maxWidth: 260,
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        fontSize: 12,
        color: "hsl(var(--card-foreground))",
      }}
    >
      {/* Invisible handles — source/target/top/bottom for flexible routing */}
      <Handle type="target" position={Position.Left}   style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} id="top" />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} id="bottom" />

      {/* Header row */}
      <div
        style={{
          padding: "8px 10px 6px",
          borderBottom: hasContent ? "1px solid hsl(var(--border))" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span style={{ fontWeight: 700, color: styles.headerColor, fontFamily: "monospace", fontSize: 11 }}>
          {d.state}
        </span>
        {styles.badge && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: styles.headerColor,
              border: `1px solid ${styles.border}`,
              borderRadius: 4,
              padding: "1px 4px",
              opacity: 0.8,
              whiteSpace: "nowrap",
            }}
          >
            {styles.badge}
          </span>
        )}
      </div>

      {/* Agent assignments */}
      {d.assignments.length > 0 && (
        <div style={{ padding: "6px 10px 8px" }}>
          {d.assignments.map((a) => (
            <div key={a.role} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 1 }}>
                {a.role}
              </div>
              <div style={{ color: "hsl(var(--muted-foreground))", paddingLeft: 8, lineHeight: 1.5 }}>
                {TOOL_LABELS[a.tool as keyof typeof TOOL_LABELS] ?? a.tool}
                {a.model && (
                  <span style={{ opacity: 0.75 }}> · {shortModel(a.model)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No-agent warning (active state only) */}
      {d.noAgent && (
        <div style={{ padding: "5px 10px 8px", color: "hsl(var(--status-reviewing))", fontSize: 11 }}>
          ⚠ no agent — will stall here
        </div>
      )}

      {/* Abandon note */}
      {d.abandonNote && (
        <div style={{ padding: "5px 10px 8px", color: "hsl(var(--muted-foreground))", fontStyle: "italic", fontSize: 10 }}>
          ← abandon from any active state
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { fsmNode: FSMNode };

// ── Main component ──────────────────────────────────────────────────────────

export function FlowDiagram() {
  const { theme } = useTheme();
  const { data: assignments = [] } = useAgentAssignments();
  const { data: meta, isLoading, isError } = useFSMMeta();

  // Controlled node state — required for drag persistence
  const [displayNodes, setDisplayNodes] = useState<Node[]>([]);

  // Group enabled assignments by fsm_state
  const assignmentsByState = useMemo(() => {
    const map: Record<string, Array<{ role: string; tool: string }>> = {};
    for (const a of assignments) {
      if (!a.enabled) continue;
      (map[a.fsm_state] ??= []).push({ role: a.role, tool: a.tool });
    }
    return map;
  }, [assignments]);

  // Compute base nodes from API data
  const baseNodes: Node[] = useMemo(() => {
    if (!meta || !Array.isArray(meta.transitions) || typeof meta.roles !== "object") return [];

    return Object.entries(STATE_META).map(([state, { category }]) => {
      const stateAssignments = (assignmentsByState[state] ?? []).map((a) => ({
        role: a.role,
        tool: a.tool,
        model: meta.roles[a.role]?.model ?? "",
      }));

      const noAgent = category === "active" && stateAssignments.length === 0;

      const nodeData: FSMNodeData = {
        state,
        category,
        assignments: stateAssignments,
        isTerminal: category !== "active",
        abandonNote: state === "abandoned",
        noAgent,
      };

      return {
        id: state,
        type: "fsmNode",
        position: DEFAULT_POSITIONS[state] ?? { x: 0, y: 0 },
        data: nodeData,
      } satisfies Node;
    });
  }, [meta, assignmentsByState]);

  // When base nodes change (API load or assignment change), merge with saved positions
  useEffect(() => {
    if (baseNodes.length === 0) return;
    const saved = loadSavedPositions();
    setDisplayNodes(
      baseNodes.map((n) => ({
        ...n,
        position: saved[n.id] ?? n.position,
      }))
    );
  }, [baseNodes]);

  // Handle drag — apply changes and persist positions when drag ends
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDisplayNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      const dragEnded = changes.some(
        (c) => c.type === "position" && !c.dragging
      );
      if (dragEnded) {
        const positions: Record<string, { x: number; y: number }> = {};
        for (const n of next) positions[n.id] = n.position;
        try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)); } catch {}
      }
      return next;
    });
  }, []);

  function resetLayout() {
    try { localStorage.removeItem(POSITIONS_KEY); } catch {}
    setDisplayNodes(baseNodes);
  }

  // Edges
  const edges: Edge[] = useMemo(() => {
    if (!meta || !Array.isArray(meta.transitions) || typeof meta.roles !== "object") return [];

    const hitlGated = new Set(meta.hitlGatedTriggers);
    const result: Edge[] = [];

    const coreTransitions = meta.transitions.filter((t) => t.trigger !== "abandon");

    for (const t of coreTransitions) {
      const isHitl = hitlGated.has(t.trigger);

      const usesBottomSource =
        (t.from === "reviewing" && t.to === "changes_requested") ||
        (t.from === "approved"  && t.to === "conflict_detected");
      const usesTopTarget =
        (t.from === "changes_requested" && t.to === "implementing") ||
        (t.from === "conflict_detected" && t.to === "implementing") ||
        (t.from === "conflict_detected" && t.to === "reviewing");

      result.push({
        id: `${t.from}-${t.to}-${t.trigger}`,
        source: t.from,
        target: t.to,
        sourceHandle: usesBottomSource ? "bottom" : undefined,
        targetHandle: usesTopTarget ? "top" : undefined,
        label: isHitl ? `🔒 ${t.trigger}` : t.trigger,
        labelStyle: { fontSize: 10, fontFamily: "monospace" },
        labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
        style: isHitl
          ? { stroke: "hsl(var(--status-hitl))", strokeWidth: 1.5 }
          : { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 },
        animated: !["merged", "abandoned", "escalated"].includes(t.to),
        markerEnd: { type: "arrowclosed" as const },
        type: "smoothstep",
      });
    }

    // Circuit-breaker pseudo-edge
    result.push({
      id: "cb-reviewing-escalated",
      source: "reviewing",
      target: "escalated",
      sourceHandle: "bottom",
      targetHandle: "top",
      label: `circuit_breaker (${meta.circuitBreakerThreshold}× request_changes)`,
      labelStyle: { fontSize: 10 },
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
      style: {
        stroke: "hsl(var(--status-changes-requested))",
        strokeDasharray: "5 3",
        strokeWidth: 1.5,
      },
      animated: false,
    });

    return result;
  }, [meta]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading FSM…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-destructive">
        Failed to load FSM metadata.
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card shrink-0">
        <div>
          <h1 className="text-base font-semibold">FSM Flow</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drag nodes to rearrange · positions are saved per browser
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                style={{
                  display: "inline-block",
                  width: 24,
                  borderTop: "1.5px dashed hsl(var(--status-changes-requested))",
                }}
              />
              circuit breaker
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ color: "hsl(var(--status-hitl))" }}>🔒</span>
              HITL gated
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ color: "hsl(var(--status-reviewing))" }}>⚠</span>
              no agent (will stall)
            </span>
          </div>
          <button
            onClick={resetLayout}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
          >
            Reset layout
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={2}
            nodeColor={(n) => {
              const cat = (n.data as FSMNodeData).category;
              const noAgent = (n.data as FSMNodeData).noAgent;
              if (noAgent)          return "hsl(var(--status-reviewing))";
              if (cat === "success")   return "hsl(var(--status-merged))";
              if (cat === "fail")      return "hsl(var(--status-abandoned))";
              if (cat === "escalated") return "hsl(var(--status-changes-requested))";
              return "hsl(var(--status-planned))";
            }}
            maskColor="hsl(var(--background) / 0.6)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
