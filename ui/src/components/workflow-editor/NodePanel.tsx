import { useState, useEffect, useRef } from "react";
import { X, Save, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentAssignment, AgentTool } from "@/types";
import { TOOL_LABELS } from "@/types";
import { useStateAssignments, useUpdateStateAssignments } from "@/hooks/useStateAssignments";
import { useTheme } from "@/contexts/ThemeContext";

// ── Model catalogue ───────────────────────────────────────────────────────────

interface ModelOption { value: string; label: string }
interface ModelGroup  { group: string; options: ModelOption[] }

const MODEL_OPTIONS: ModelGroup[] = [
  { group: "Anthropic", options: [
    { value: "anthropic:claude-opus-4-7",    label: "Claude Opus 4.7"    },
    { value: "anthropic:claude-sonnet-4-6",  label: "Claude Sonnet 4.6"  },
    { value: "anthropic:claude-haiku-4-5",   label: "Claude Haiku 4.5"   },
  ]},
  { group: "OpenAI", options: [
    { value: "openai:gpt-4o",    label: "GPT-4o"    },
    { value: "openai:o3",        label: "o3"         },
    { value: "openai:o4-mini",   label: "o4-mini"    },
  ]},
  { group: "Google", options: [
    { value: "google:gemini-2.5-pro",   label: "Gemini 2.5 Pro"   },
    { value: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ]},
];

const AGENT_TOOLS = Object.entries(TOOL_LABELS) as [AgentTool, string][];

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelForModel(value: string | null): string {
  if (!value) return "Role default";
  for (const g of MODEL_OPTIONS) {
    const opt = g.options.find((o) => o.value === value);
    if (opt) return opt.label;
  }
  return value;
}

// ── AssignmentRow ─────────────────────────────────────────────────────────────

interface RowState {
  tool: AgentTool;
  model: string | null;
  auto_launch: boolean;
  prompt_override: string | null;
  mcps: string[] | null;
  enabled: boolean;
  promptOpen: boolean;
  mcpInput: string;
}

function initRow(a: AgentAssignment): RowState {
  return {
    tool: a.tool,
    model: a.model,
    auto_launch: a.auto_launch,
    prompt_override: a.prompt_override,
    mcps: a.mcps,
    enabled: a.enabled,
    promptOpen: false,
    mcpInput: "",
  };
}

interface AssignmentRowProps {
  assignment: AgentAssignment;
  state: RowState;
  onChange: (next: RowState) => void;
}

function AssignmentRow({ assignment, state, onChange }: AssignmentRowProps) {
  const { palette: p } = useTheme();

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: p.textMuted,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 5,
    display: "block",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    background: p.inputBg,
    border: `1px solid ${p.inputBorder}`,
    borderRadius: 6,
    color: p.text,
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
  };

  function addMcp() {
    const name = state.mcpInput.trim();
    if (!name) return;
    const current = state.mcps ?? [];
    if (!current.includes(name)) {
      onChange({ ...state, mcps: [...current, name], mcpInput: "" });
    } else {
      onChange({ ...state, mcpInput: "" });
    }
  }

  function removeMcp(name: string) {
    onChange({ ...state, mcps: (state.mcps ?? []).filter((m) => m !== name) });
  }

  return (
    <div
      style={{
        padding: "14px 0",
        borderBottom: `1px solid ${p.panelBorder}`,
      }}
    >
      {/* Role header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'SF Mono','Fira Code',monospace",
              color: p.amber,
            }}
          >
            {assignment.role}
          </span>
        </div>
        {/* Enabled checkbox */}
        <label
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: p.textMuted }}
        >
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => onChange({ ...state, enabled: e.target.checked })}
            style={{ cursor: "pointer" }}
          />
          enabled
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {/* Tool */}
        <div>
          <label style={labelStyle}>Tool</label>
          <select
            value={state.tool}
            onChange={(e) => onChange({ ...state, tool: e.target.value as AgentTool })}
            style={selectStyle}
          >
            {AGENT_TOOLS.map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label style={labelStyle}>Model</label>
          <select
            value={state.model ?? ""}
            onChange={(e) => onChange({ ...state, model: e.target.value || null })}
            style={selectStyle}
          >
            <option value="">Role default</option>
            {MODEL_OPTIONS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Auto-launch toggle */}
      <div
        style={{
          marginBottom: 10,
          padding: "9px 11px",
          background: state.auto_launch ? "#1e3a5f22" : p.inputBg,
          border: `1px solid ${state.auto_launch ? p.blue : p.inputBorder}`,
          borderRadius: 7,
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        onClick={() => onChange({ ...state, auto_launch: !state.auto_launch })}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: state.auto_launch ? p.blueBright : p.text }}>
            Auto-launch
          </div>
          <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>
            {state.auto_launch ? "Spawns agent when FSM enters this state" : "Manual spawn only"}
          </div>
        </div>
        <div
          style={{
            width: 34,
            height: 18,
            borderRadius: 9,
            background: state.auto_launch ? p.blue : "#374151",
            position: "relative",
            transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: state.auto_launch ? 18 : 2,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
            }}
          />
        </div>
      </div>

      {/* MCPs */}
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>MCP Servers</label>
        <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
          <input
            value={state.mcpInput}
            onChange={(e) => onChange({ ...state, mcpInput: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMcp(); } }}
            placeholder="server-name"
            style={{
              flex: 1,
              padding: "5px 8px",
              background: p.inputBg,
              border: `1px solid ${p.inputBorder}`,
              borderRadius: 5,
              color: p.text,
              fontSize: 11,
              fontFamily: "'SF Mono','Fira Code',monospace",
              outline: "none",
            }}
          />
          <button
            onClick={addMcp}
            style={{
              padding: "5px 10px",
              background: p.amber,
              border: "none",
              borderRadius: 5,
              color: "#000",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
        {state.mcps === null && (
          <div style={{ fontSize: 10, color: p.textMuted, fontStyle: "italic" }}>Using role defaults</div>
        )}
        {state.mcps !== null && state.mcps.length === 0 && (
          <div style={{ fontSize: 10, color: p.textMuted, fontStyle: "italic" }}>No MCP servers</div>
        )}
        {(state.mcps ?? []).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(state.mcps ?? []).map((m) => (
              <span
                key={m}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 7px",
                  background: `${p.amber}20`,
                  border: `1px solid ${p.amber}50`,
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: "'SF Mono','Fira Code',monospace",
                  color: p.amber,
                }}
              >
                {m}
                <button
                  onClick={() => removeMcp(m)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: p.textMuted, padding: 0, lineHeight: 1, fontSize: 11 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Prompt override (expandable) */}
      <div>
        <button
          onClick={() => onChange({ ...state, promptOpen: !state.promptOpen })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: p.textMuted,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {state.promptOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Prompt override
          {state.prompt_override && (
            <span style={{ fontSize: 9, padding: "1px 5px", background: `${p.amber}25`, borderRadius: 3, color: p.amber }}>
              set
            </span>
          )}
        </button>
        {state.promptOpen && (
          <textarea
            value={state.prompt_override ?? ""}
            onChange={(e) => onChange({ ...state, prompt_override: e.target.value || null })}
            rows={4}
            placeholder="Additional instructions appended to the role's base prompt…"
            style={{
              marginTop: 7,
              width: "100%",
              padding: "7px 9px",
              background: p.inputBg,
              border: `1px solid ${p.inputBorder}`,
              borderRadius: 6,
              color: p.text,
              fontSize: 11,
              resize: "vertical" as const,
              outline: "none",
              boxSizing: "border-box" as const,
              fontFamily: "inherit",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── NodePanel ─────────────────────────────────────────────────────────────────

interface NodePanelProps {
  fsmState: string;
  onClose: () => void;
}

export function NodePanel({ fsmState, onClose }: NodePanelProps) {
  const { palette: p } = useTheme();
  const { data: assignments = [], isLoading } = useStateAssignments(fsmState);
  const { saveAll, isPending } = useUpdateStateAssignments(fsmState);

  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Initialize rows when assignments first arrive or when fsmState changes.
  // Track the state we've already seeded to avoid re-seeding on refetch.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (assignments.length === 0) return;
    if (seededFor.current === fsmState) return;
    seededFor.current = fsmState;
    setRows(new Map(assignments.map((a) => [a.role, initRow(a)])));
  }, [assignments, fsmState]);

  function updateRow(role: string, next: RowState) {
    setRows((prev) => new Map(prev).set(role, next));
  }

  async function handleSave() {
    setSaveError(null);
    setSaveOk(false);
    const updated: AgentAssignment[] = assignments.map((a) => {
      const r = rows.get(a.role) ?? initRow(a);
      return { ...a, tool: r.tool, model: r.model, auto_launch: r.auto_launch, prompt_override: r.prompt_override, mcps: r.mcps, enabled: r.enabled };
    });
    try {
      await saveAll(updated);
      seededFor.current = null; // allow re-seed from fresh server data
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const hasAssignments = assignments.length > 0;

  return (
    <div
      style={{
        width: 300,
        background: p.panelBg,
        borderLeft: `1px solid ${p.panelBorder}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        color: p.text,
        fontFamily: "'Inter',-apple-system,sans-serif",
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: `1px solid ${p.panelBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <span style={{ fontWeight: 600, fontSize: 13 }}>State Config</span>
          <div
            style={{
              fontSize: 10,
              fontFamily: "'SF Mono','Fira Code',monospace",
              color: p.amber,
              marginTop: 2,
            }}
          >
            {fsmState}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: p.textMuted, display: "flex", padding: 2 }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
        {isLoading && (
          <div style={{ padding: "24px 0", textAlign: "center", color: p.textMuted, fontSize: 12 }}>
            Loading…
          </div>
        )}

        {!isLoading && !hasAssignments && (
          <div style={{ padding: "24px 0", textAlign: "center", color: p.textMuted, fontSize: 12 }}>
            No agent assignments for this state.
          </div>
        )}

        {!isLoading &&
          assignments.map((a) => {
            const rowState = rows.get(a.role) ?? initRow(a);
            return (
              <AssignmentRow
                key={a.role}
                assignment={a}
                state={rowState}
                onChange={(next) => updateRow(a.role, next)}
              />
            );
          })}
      </div>

      {/* Footer */}
      {hasAssignments && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${p.panelBorder}` }}>
          {saveError && (
            <div style={{ fontSize: 11, color: p.textRed, marginBottom: 6 }}>{saveError}</div>
          )}
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{
              width: "100%",
              padding: "7px 0",
              background: saveOk ? p.green + "33" : p.amber,
              border: `1px solid ${saveOk ? p.green : p.amber}`,
              borderRadius: 6,
              color: saveOk ? p.green : "#000",
              fontSize: 12,
              fontWeight: 700,
              cursor: isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "background 0.15s, color 0.15s",
              opacity: isPending ? 0.7 : 1,
            }}
          >
            <Save size={13} />
            {isPending ? "Saving…" : saveOk ? "Saved" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// Re-export for convenience
export { labelForModel };
