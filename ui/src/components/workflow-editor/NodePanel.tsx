import { useState, useEffect, useRef } from "react";
import { X, Save } from "lucide-react";
import type { AgentAssignment, AgentTool } from "@/types";
import { TOOL_LABELS } from "@/types";
import { useStateAssignments, useUpdateStateAssignments } from "@/hooks/useStateAssignments";
import { useMcpServers } from "@/hooks/useMcpServers";
import { useSkills } from "@/hooks/useSkills";
import { useTheme } from "@/contexts/ThemeContext";
import { AGENT_MODEL_MAP } from "@/lib/agent-model-map";

// ── Model catalogue (filtered per tool via AGENT_MODEL_MAP) ───────────────────

interface ModelOption { value: string; label: string }
interface ModelGroup  { group: string; options: ModelOption[] }

const ALL_MODEL_OPTIONS: ModelGroup[] = [
  { group: "Anthropic", options: [
    { value: "anthropic:claude-opus-4-7",           label: "Claude Opus 4.7"   },
    { value: "anthropic:claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
    { value: "anthropic:claude-haiku-4-5-20251001", label: "Claude Haiku 4.5"  },
  ]},
  { group: "OpenAI", options: [
    { value: "openai:gpt-5.5",       label: "GPT-5.5"        },
    { value: "openai:gpt-5.4",       label: "GPT-5.4"        },
    { value: "openai:gpt-5.4-mini",  label: "GPT-5.4 Mini"   },
    { value: "openai:gpt-5.3-codex", label: "GPT-5.3 Codex"  },
    { value: "openai:gpt-5.2",       label: "GPT-5.2"        },
  ]},
  { group: "Google", options: [
    { value: "google:gemini-3-pro-preview",   label: "Gemini 3 Pro (preview)"   },
    { value: "google:gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    { value: "google:gemini-2.5-pro",         label: "Gemini 2.5 Pro"           },
    { value: "google:gemini-2.5-flash",       label: "Gemini 2.5 Flash"         },
    { value: "google:gemini-2.5-flash-lite",  label: "Gemini 2.5 Flash Lite"    },
  ]},
];

function modelOptionsForTool(tool: AgentTool): ModelGroup[] {
  const entry = AGENT_MODEL_MAP[tool];
  if (entry.modelSelection === "not_applicable") return [];
  const valid = new Set(entry.models);
  return ALL_MODEL_OPTIONS
    .map((g) => ({ ...g, options: g.options.filter((o) => valid.has(o.value)) }))
    .filter((g) => g.options.length > 0);
}

const AGENT_TOOLS = Object.entries(TOOL_LABELS) as [AgentTool, string][];

// ── RowState ──────────────────────────────────────────────────────────────────

interface RowState {
  tool: AgentTool;
  model: string | null;
  auto_launch: boolean;
  prompt_override: string | null;
  mcps: string[] | null;
  skills: string[] | null;
  enabled: boolean;
  mcpInput: string;
}

function initRow(a: AgentAssignment): RowState {
  return {
    tool: a.tool,
    model: a.model,
    auto_launch: a.auto_launch,
    prompt_override: a.prompt_override,
    mcps: a.mcps,
    skills: a.skills,
    enabled: a.enabled,
    mcpInput: "",
  };
}

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_BADGE_COLORS: Record<string, string> = {
  "claude-global": "#6366f1",
  "claude-local":  "#0ea5e9",
  "mcp-global":    "#f59e0b",
  "cursor":        "#a855f7",
  "codex":         "#22c55e",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <span style={{
      fontSize: 9,
      padding: "1px 5px",
      borderRadius: 3,
      background: `${SOURCE_BADGE_COLORS[source] ?? "#6b7280"}22`,
      color: SOURCE_BADGE_COLORS[source] ?? "#6b7280",
      border: `1px solid ${SOURCE_BADGE_COLORS[source] ?? "#6b7280"}44`,
      fontFamily: "'SF Mono','Fira Code',monospace",
    }}>
      {source}
    </span>
  );
}

// ── Tab content components ────────────────────────────────────────────────────

interface TabProps {
  assignment: AgentAssignment;
  state: RowState;
  onChange: (next: RowState) => void;
  palette: ReturnType<typeof useTheme>["palette"];
}

function ConfigTab({ assignment: _assignment, state, onChange, palette: p }: TabProps) {
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: p.textMuted,
    letterSpacing: "0.08em", textTransform: "uppercase",
    marginBottom: 5, display: "block",
  };
  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px",
    background: p.inputBg, border: `1px solid ${p.inputBorder}`,
    borderRadius: 6, color: p.text, fontSize: 12,
    cursor: "pointer", outline: "none",
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Tool</label>
          <select
            value={state.tool}
            onChange={(e) => {
              const newTool = e.target.value as AgentTool;
              const validModels = AGENT_MODEL_MAP[newTool].models;
              const modelStillValid = state.model !== null && validModels.includes(state.model);
              onChange({ ...state, tool: newTool, model: modelStillValid ? state.model : null });
            }}
            style={selectStyle}
          >
            {AGENT_TOOLS.map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Model</label>
          {AGENT_MODEL_MAP[state.tool].modelSelection === "not_applicable" ? (
            <div style={{ ...selectStyle, display: "flex", alignItems: "center", color: p.textMuted, fontStyle: "italic" }}>
              N/A
            </div>
          ) : (
            <select
              value={state.model ?? ""}
              onChange={(e) => onChange({ ...state, model: e.target.value || null })}
              style={selectStyle}
            >
              <option value="">Role default</option>
              {modelOptionsForTool(state.tool).map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Auto-launch */}
      <div
        onClick={() => onChange({ ...state, auto_launch: !state.auto_launch })}
        style={{
          marginBottom: 10, padding: "9px 11px", cursor: "pointer",
          background: state.auto_launch ? "#1e3a5f22" : p.inputBg,
          border: `1px solid ${state.auto_launch ? p.blue : p.inputBorder}`,
          borderRadius: 7, transition: "border-color 0.15s, background 0.15s",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: state.auto_launch ? p.blueBright : p.text }}>
            Auto-launch
          </div>
          <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>
            {state.auto_launch ? "Spawns agent when FSM enters this state" : "Manual spawn only"}
          </div>
        </div>
        <div style={{ width: 34, height: 18, borderRadius: 9, background: state.auto_launch ? p.blue : "#374151", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: 2, left: state.auto_launch ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </div>
      </div>

      {/* Enabled */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: p.text }}>
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => onChange({ ...state, enabled: e.target.checked })}
          style={{ cursor: "pointer" }}
        />
        Enabled
      </label>
    </div>
  );
}

function PromptTab({ assignment, state, onChange, palette: p }: TabProps) {
  const [baseOpen, setBaseOpen] = useState(true);
  const [basePrompt, setBasePrompt] = useState<string | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);

  const API = import.meta.env.VITE_API_URL ?? "";

  useEffect(() => {
    setBaseLoading(true);
    fetch(`${API}/api/roles/${assignment.role}/prompt`)
      .then((r) => r.ok ? r.json() as Promise<{ content: string }> : null)
      .then((d) => setBasePrompt(d?.content ?? null))
      .catch(() => setBasePrompt(null))
      .finally(() => setBaseLoading(false));
  }, [assignment.role]);

  return (
    <div>
      {/* Base prompt collapsible */}
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={() => setBaseOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 4, background: "none",
            border: "none", cursor: "pointer", padding: 0, color: p.textMuted,
            fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
            marginBottom: baseOpen ? 6 : 0,
          }}
        >
          <span style={{ display: "inline-block", transition: "transform 0.15s", transform: baseOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          Base prompt
        </button>
        {baseOpen && (
          <div style={{
            maxHeight: 200, overflowY: "auto", padding: "8px 10px",
            background: p.inputBg, border: `1px solid ${p.inputBorder}`,
            borderRadius: 6, fontSize: 11,
            fontFamily: "'SF Mono','Fira Code',monospace",
            color: p.textMuted, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {baseLoading ? "Loading…" : basePrompt ?? "(no prompt file found)"}
          </div>
        )}
      </div>

      {/* Prompt override */}
      <div>
        <label style={{ fontSize: 10, fontWeight: 600, color: p.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5, display: "block" }}>
          Append to base prompt
        </label>
        <textarea
          value={state.prompt_override ?? ""}
          onChange={(e) => onChange({ ...state, prompt_override: e.target.value || null })}
          rows={5}
          placeholder="Additional instructions appended to the role's base prompt…"
          style={{
            width: "100%", padding: "7px 9px",
            background: p.inputBg, border: `1px solid ${p.inputBorder}`,
            borderRadius: 6, color: p.text, fontSize: 11,
            resize: "vertical" as const, outline: "none",
            boxSizing: "border-box" as const, fontFamily: "inherit",
          }}
        />
      </div>
    </div>
  );
}

function McpsTab({ assignment: _assignment, state, onChange, palette: p }: TabProps) {
  const { data: mcpServers = [], isLoading } = useMcpServers();

  if (state.tool === "human") {
    return (
      <div style={{ color: p.textMuted, fontSize: 12, fontStyle: "italic", padding: "12px 0" }}>
        MCPs not applicable for Human
      </div>
    );
  }

  const overriding = state.mcps !== null;

  function toggleOverride() {
    onChange({ ...state, mcps: overriding ? null : [] });
  }

  function toggleServer(name: string) {
    const current = state.mcps ?? [];
    const next = current.includes(name)
      ? current.filter((m) => m !== name)
      : [...current, name];
    onChange({ ...state, mcps: next });
  }

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
    <div>
      {/* Override toggle */}
      <div
        onClick={toggleOverride}
        style={{
          marginBottom: 10, padding: "8px 11px", cursor: "pointer",
          background: overriding ? "#1e3a5f22" : p.inputBg,
          border: `1px solid ${overriding ? p.blue : p.inputBorder}`,
          borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: overriding ? p.blueBright : p.text }}>
            Override defaults
          </div>
          <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>
            {overriding ? "Explicit MCP list" : "Role defaults apply"}
          </div>
        </div>
        <div style={{ width: 34, height: 18, borderRadius: 9, background: overriding ? p.blue : "#374151", position: "relative", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: 2, left: overriding ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </div>
      </div>

      {overriding && (
        <div>
          {/* Checkbox list from discovered servers */}
          {!isLoading && mcpServers.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {mcpServers.map((s) => (
                <label key={s.name} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12, color: p.text }}>
                  <input
                    type="checkbox"
                    checked={(state.mcps ?? []).includes(s.name)}
                    onChange={() => toggleServer(s.name)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontFamily: "'SF Mono','Fira Code',monospace", fontSize: 11 }}>{s.name}</span>
                  <SourceBadge source={s.source} />
                </label>
              ))}
            </div>
          )}

          {/* Freeform fallback (always shown to allow manual additions) */}
          <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
            <input
              value={state.mcpInput}
              onChange={(e) => onChange({ ...state, mcpInput: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMcp(); } }}
              placeholder="server-name"
              style={{
                flex: 1, padding: "5px 8px", background: p.inputBg,
                border: `1px solid ${p.inputBorder}`, borderRadius: 5,
                color: p.text, fontSize: 11,
                fontFamily: "'SF Mono','Fira Code',monospace", outline: "none",
              }}
            />
            <button
              onClick={addMcp}
              style={{ padding: "5px 10px", background: p.amber, border: "none", borderRadius: 5, color: "#000", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              +
            </button>
          </div>

          {/* Tags for manually added / selected servers */}
          {(state.mcps ?? []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {(state.mcps ?? []).map((m) => {
                const discovered = mcpServers.find((s) => s.name === m);
                return discovered ? null : (
                  <span key={m} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 7px",
                    background: `${p.amber}20`, border: `1px solid ${p.amber}50`,
                    borderRadius: 4, fontSize: 10,
                    fontFamily: "'SF Mono','Fira Code',monospace", color: p.amber,
                  }}>
                    {m}
                    <button onClick={() => removeMcp(m)} style={{ background: "none", border: "none", cursor: "pointer", color: p.textMuted, padding: 0, lineHeight: 1, fontSize: 11 }}>×</button>
                  </span>
                );
              })}
            </div>
          )}

          {(state.mcps ?? []).length === 0 && (
            <div style={{ fontSize: 10, color: p.textMuted, fontStyle: "italic" }}>No MCP servers selected</div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillsTab({ assignment: _assignment, state, onChange, palette: p }: TabProps) {
  const { data: skills = [], isLoading } = useSkills(state.tool);

  if (state.tool !== "claude-code") {
    return (
      <div style={{ color: p.textMuted, fontSize: 12, fontStyle: "italic", padding: "12px 0" }}>
        Skills not supported by {TOOL_LABELS[state.tool]}
      </div>
    );
  }

  const overriding = state.skills !== null;

  function toggleOverride() {
    onChange({ ...state, skills: overriding ? null : [] });
  }

  function toggleSkill(name: string) {
    const current = state.skills ?? [];
    const next = current.includes(name)
      ? current.filter((s) => s !== name)
      : [...current, name];
    onChange({ ...state, skills: next });
  }

  return (
    <div>
      {/* Override toggle */}
      <div
        onClick={toggleOverride}
        style={{
          marginBottom: 10, padding: "8px 11px", cursor: "pointer",
          background: overriding ? "#1e3a5f22" : p.inputBg,
          border: `1px solid ${overriding ? p.blue : p.inputBorder}`,
          borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: overriding ? p.blueBright : p.text }}>
            Override defaults
          </div>
          <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>
            {overriding ? "Explicit skill list" : "Role defaults apply"}
          </div>
        </div>
        <div style={{ width: 34, height: 18, borderRadius: 9, background: overriding ? p.blue : "#374151", position: "relative", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: 2, left: overriding ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </div>
      </div>

      {overriding && (
        <div>
          {isLoading && <div style={{ fontSize: 11, color: p.textMuted }}>Loading…</div>}
          {!isLoading && skills.map((s) => (
            <label key={s.name} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 7, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={(state.skills ?? []).includes(s.name)}
                onChange={() => toggleSkill(s.name)}
                style={{ cursor: "pointer", marginTop: 2, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 12, color: p.text, fontFamily: "'SF Mono','Fira Code',monospace" }}>/{s.name}</div>
                <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>{s.description}</div>
              </div>
            </label>
          ))}
          {!isLoading && skills.length === 0 && (
            <div style={{ fontSize: 11, color: p.textMuted, fontStyle: "italic" }}>No skills available</div>
          )}
          {overriding && (state.skills ?? []).length === 0 && (
            <div style={{ fontSize: 10, color: p.textMuted, fontStyle: "italic", marginTop: 4 }}>No skills selected (explicitly none)</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AssignmentBlock ───────────────────────────────────────────────────────────

type Tab = "config" | "prompt" | "mcps" | "skills";

interface AssignmentBlockProps {
  assignment: AgentAssignment;
  state: RowState;
  onChange: (next: RowState) => void;
  activeTab: Tab;
}

function AssignmentBlock({ assignment, state, onChange, activeTab }: AssignmentBlockProps) {
  const { palette: p } = useTheme();

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${p.panelBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'SF Mono','Fira Code',monospace", color: p.amber }}>
          {assignment.role}
        </span>
      </div>
      {activeTab === "config"  && <ConfigTab  assignment={assignment} state={state} onChange={onChange} palette={p} />}
      {activeTab === "prompt"  && <PromptTab  assignment={assignment} state={state} onChange={onChange} palette={p} />}
      {activeTab === "mcps"    && <McpsTab    assignment={assignment} state={state} onChange={onChange} palette={p} />}
      {activeTab === "skills"  && <SkillsTab  assignment={assignment} state={state} onChange={onChange} palette={p} />}
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
  const [activeTab, setActiveTab] = useState<Tab>("config");

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
      return { ...a, tool: r.tool, model: r.model, auto_launch: r.auto_launch, prompt_override: r.prompt_override, mcps: r.mcps, skills: r.skills, enabled: r.enabled };
    });
    try {
      await saveAll(updated);
      seededFor.current = null;
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const hasAssignments = assignments.length > 0;
  const TABS: { id: Tab; label: string }[] = [
    { id: "config",  label: "Config"  },
    { id: "prompt",  label: "Prompt"  },
    { id: "mcps",    label: "MCPs"    },
    { id: "skills",  label: "Skills"  },
  ];

  return (
    <div style={{
      width: 400,
      background: p.panelBg,
      borderLeft: `1px solid ${p.panelBorder}`,
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      color: p.text,
      fontFamily: "'Inter',-apple-system,sans-serif",
      fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px",
        borderBottom: `1px solid ${p.panelBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13 }}>State Config</span>
          <div style={{ fontSize: 10, fontFamily: "'SF Mono','Fira Code',monospace", color: p.amber, marginTop: 2 }}>
            {fsmState}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: p.textMuted, display: "flex", padding: 2 }}>
          <X size={15} />
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `1px solid ${p.panelBorder}`, background: p.panelBg }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: "8px 0", background: "none",
              border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
              color: activeTab === t.id ? p.amber : p.textMuted,
              borderBottom: `2px solid ${activeTab === t.id ? p.amber : "transparent"}`,
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
        {isLoading && (
          <div style={{ padding: "24px 0", textAlign: "center", color: p.textMuted, fontSize: 12 }}>Loading…</div>
        )}
        {!isLoading && !hasAssignments && (
          <div style={{ padding: "24px 0", textAlign: "center", color: p.textMuted, fontSize: 12 }}>
            No agent assignments for this state.
          </div>
        )}
        {!isLoading && assignments.map((a) => (
          <AssignmentBlock
            key={a.role}
            assignment={a}
            state={rows.get(a.role) ?? initRow(a)}
            onChange={(next) => updateRow(a.role, next)}
            activeTab={activeTab}
          />
        ))}
      </div>

      {/* Footer */}
      {hasAssignments && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${p.panelBorder}` }}>
          {saveError && <div style={{ fontSize: 11, color: p.textRed, marginBottom: 6 }}>{saveError}</div>}
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{
              width: "100%", padding: "7px 0",
              background: saveOk ? p.green + "33" : p.amber,
              border: `1px solid ${saveOk ? p.green : p.amber}`,
              borderRadius: 6, color: saveOk ? p.green : "#000",
              fontSize: 12, fontWeight: 700,
              cursor: isPending ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6, transition: "background 0.15s, color 0.15s",
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

export { };
