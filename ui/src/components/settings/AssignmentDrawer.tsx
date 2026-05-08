import { useState, useEffect } from "react";
import { X, Save, ChevronRight } from "lucide-react";
import type { AgentAssignment, AgentTool } from "@/types";
import { TOOL_LABELS } from "@/types";
import { useUpdateAssignment } from "@/hooks/useAgentAssignments";
import { useMcpServers } from "@/hooks/useMcpServers";
import { useSkills } from "@/hooks/useSkills";
import { AGENT_MODEL_MAP } from "@/lib/agent-model-map";

const API = import.meta.env.VITE_API_URL ?? "";

// ── Model catalogue ───────────────────────────────────────────────────────────

const ALL_MODEL_OPTIONS = [
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

function modelOptionsForTool(tool: AgentTool) {
  const entry = AGENT_MODEL_MAP[tool];
  if (entry.modelSelection === "not_applicable") return [];
  const valid = new Set(entry.models);
  return ALL_MODEL_OPTIONS
    .map((g) => ({ ...g, options: g.options.filter((o) => valid.has(o.value)) }))
    .filter((g) => g.options.length > 0);
}

const AGENT_TOOLS = Object.entries(TOOL_LABELS) as [AgentTool, string][];
const SOURCE_BADGE: Record<string, string> = {
  "claude-global": "#6366f1",
  "claude-local":  "#0ea5e9",
  "mcp-global":    "#f59e0b",
  "cursor":        "#a855f7",
  "codex":         "#22c55e",
};

// ── Local form state ──────────────────────────────────────────────────────────

interface FormState {
  tool: AgentTool;
  model: string | null;
  enabled: boolean;
  auto_launch: boolean;
  prompt_override: string | null;
  mcps: string[] | null;
  skills: string[] | null;
  mcpInput: string;
}

function initForm(a: AgentAssignment): FormState {
  return {
    tool: a.tool,
    model: a.model,
    enabled: a.enabled,
    auto_launch: a.auto_launch,
    prompt_override: a.prompt_override,
    mcps: a.mcps,
    skills: a.skills,
    mcpInput: "",
  };
}

type Tab = "config" | "prompt" | "mcps" | "skills";

// ── AssignmentDrawer ──────────────────────────────────────────────────────────

interface Props {
  assignment: AgentAssignment;
  onClose: () => void;
}

export function AssignmentDrawer({ assignment, onClose }: Props) {
  const update = useUpdateAssignment();
  const { data: mcpServers = [] } = useMcpServers();
  const [form, setForm] = useState<FormState>(() => initForm(assignment));
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset form when assignment changes
  useEffect(() => {
    setForm(initForm(assignment));
    setSaveOk(false);
    setSaveError(null);
  }, [assignment.id]);

  const { data: skills = [] } = useSkills(form.tool);

  // Base prompt fetch
  const [basePrompt, setBasePrompt] = useState<string | null>(null);
  const [baseOpen, setBaseOpen] = useState(true);
  useEffect(() => {
    setBasePrompt(null);
    fetch(`${API}/api/roles/${assignment.role}/prompt`)
      .then((r) => (r.ok ? (r.json() as Promise<{ content: string }>) : null))
      .then((d) => setBasePrompt(d?.content ?? null))
      .catch(() => setBasePrompt(null));
  }, [assignment.role]);

  async function handleSave() {
    setSaveError(null);
    setSaveOk(false);
    try {
      await update.mutateAsync({
        fsmState: assignment.fsm_state,
        role: assignment.role,
        tool: form.tool,
        enabled: form.enabled,
        model: form.model,
        prompt_override: form.prompt_override,
        mcps: form.mcps,
        auto_launch: form.auto_launch,
        skills: form.skills,
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "config",  label: "Config"  },
    { id: "prompt",  label: "Prompt"  },
    { id: "mcps",    label: "MCPs"    },
    { id: "skills",  label: "Skills"  },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-40"
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[440px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-mono text-amber-500 dark:text-amber-400 truncate">
              {assignment.fsm_state}
            </div>
            <div className="text-sm font-semibold mt-0.5 truncate">{assignment.role}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === t.id
                  ? "text-amber-500 dark:text-amber-400 border-amber-500 dark:border-amber-400"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Config ── */}
          {activeTab === "config" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Tool</label>
                  <select
                    value={form.tool}
                    onChange={(e) => {
                      const t = e.target.value as AgentTool;
                      const validModels = AGENT_MODEL_MAP[t].models;
                      setForm((f) => ({ ...f, tool: t, model: f.model && validModels.includes(f.model) ? f.model : null }));
                    }}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {AGENT_TOOLS.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Model</label>
                  {AGENT_MODEL_MAP[form.tool].modelSelection === "not_applicable" ? (
                    <div className="flex items-center h-[30px] text-xs text-muted-foreground italic">N/A</div>
                  ) : (
                    <select
                      value={form.model ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value || null }))}
                      className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Role default</option>
                      {modelOptionsForTool(form.tool).map((g) => (
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
              <button
                onClick={() => setForm((f) => ({ ...f, auto_launch: !f.auto_launch }))}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors text-left ${
                  form.auto_launch ? "border-blue-500 bg-blue-500/10" : "border-border bg-muted/20"
                }`}
              >
                <div>
                  <div className={`text-xs font-semibold ${form.auto_launch ? "text-blue-400" : "text-foreground"}`}>Auto-launch</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {form.auto_launch ? "Spawns agent when FSM enters this state" : "Manual spawn only"}
                  </div>
                </div>
                <div className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${form.auto_launch ? "bg-blue-500" : "bg-muted"}`}>
                  <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${form.auto_launch ? "left-5" : "left-1"}`} />
                </div>
              </button>

              {/* Enabled */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <span className="text-sm text-foreground">Enabled</span>
              </label>
            </div>
          )}

          {/* ── Prompt ── */}
          {activeTab === "prompt" && (
            <div className="space-y-4">
              <div>
                <button
                  onClick={() => setBaseOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                >
                  <ChevronRight size={11} className={`transition-transform ${baseOpen ? "rotate-90" : ""}`} />
                  Base prompt
                </button>
                {baseOpen && (
                  <pre className="max-h-48 overflow-y-auto text-[11px] leading-relaxed font-mono text-muted-foreground bg-muted/30 border border-border rounded-md p-3 whitespace-pre-wrap break-words">
                    {basePrompt ?? "(no prompt file for this role)"}
                  </pre>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Append to base prompt
                </label>
                <textarea
                  value={form.prompt_override ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, prompt_override: e.target.value || null }))}
                  rows={6}
                  placeholder="Additional instructions appended to the role's base prompt…"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                />
              </div>
            </div>
          )}

          {/* ── MCPs ── */}
          {activeTab === "mcps" && (
            <div className="space-y-3">
              {form.tool === "human" ? (
                <p className="text-xs text-muted-foreground italic">MCPs not applicable for Human</p>
              ) : (
                <>
                  {/* Override toggle */}
                  <button
                    onClick={() => setForm((f) => ({ ...f, mcps: f.mcps !== null ? null : [] }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors text-left ${
                      form.mcps !== null ? "border-blue-500 bg-blue-500/10" : "border-border bg-muted/20"
                    }`}
                  >
                    <div>
                      <div className={`text-xs font-semibold ${form.mcps !== null ? "text-blue-400" : "text-foreground"}`}>Override defaults</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {form.mcps !== null ? "Explicit MCP list" : "Role defaults apply"}
                      </div>
                    </div>
                    <div className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${form.mcps !== null ? "bg-blue-500" : "bg-muted"}`}>
                      <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${form.mcps !== null ? "left-5" : "left-1"}`} />
                    </div>
                  </button>

                  {form.mcps !== null && (
                    <>
                      {/* Discovered servers */}
                      {mcpServers.length > 0 && (
                        <div className="space-y-2">
                          {mcpServers.map((s) => (
                            <label key={s.name} className="flex items-center gap-2.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(form.mcps ?? []).includes(s.name)}
                                onChange={() => setForm((f) => {
                                  const cur = f.mcps ?? [];
                                  return { ...f, mcps: cur.includes(s.name) ? cur.filter((m) => m !== s.name) : [...cur, s.name] };
                                })}
                                className="w-4 h-4 accent-primary cursor-pointer"
                              />
                              <span className="text-xs font-mono text-foreground">{s.name}</span>
                              <span style={{
                                fontSize: 9, padding: "1px 5px", borderRadius: 3,
                                background: `${SOURCE_BADGE[s.source] ?? "#6b7280"}22`,
                                color: SOURCE_BADGE[s.source] ?? "#6b7280",
                                border: `1px solid ${SOURCE_BADGE[s.source] ?? "#6b7280"}44`,
                              }}>
                                {s.source}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* Manual add */}
                      <div className="flex gap-2">
                        <input
                          value={form.mcpInput}
                          onChange={(e) => setForm((f) => ({ ...f, mcpInput: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const name = form.mcpInput.trim();
                              if (!name) return;
                              setForm((f) => {
                                const cur = f.mcps ?? [];
                                return { ...f, mcps: cur.includes(name) ? cur : [...cur, name], mcpInput: "" };
                              });
                            }
                          }}
                          placeholder="server-name"
                          className="flex-1 bg-background border border-border rounded px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          onClick={() => {
                            const name = form.mcpInput.trim();
                            if (!name) return;
                            setForm((f) => {
                              const cur = f.mcps ?? [];
                              return { ...f, mcps: cur.includes(name) ? cur : [...cur, name], mcpInput: "" };
                            });
                          }}
                          className="px-3 py-1.5 bg-amber-500 text-black text-xs font-bold rounded hover:bg-amber-400 transition-colors"
                        >+</button>
                      </div>

                      {/* Tags for non-discovered */}
                      {(form.mcps ?? []).filter((m) => !mcpServers.find((s) => s.name === m)).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(form.mcps ?? [])
                            .filter((m) => !mcpServers.find((s) => s.name === m))
                            .map((m) => (
                              <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-500">
                                {m}
                                <button onClick={() => setForm((f) => ({ ...f, mcps: (f.mcps ?? []).filter((x) => x !== m) }))} className="opacity-60 hover:opacity-100">×</button>
                              </span>
                            ))}
                        </div>
                      )}

                      {(form.mcps ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No MCP servers selected</p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Skills ── */}
          {activeTab === "skills" && (
            <div className="space-y-3">
              {form.tool !== "claude-code" ? (
                <p className="text-xs text-muted-foreground italic">Skills not supported by {TOOL_LABELS[form.tool]}</p>
              ) : (
                <>
                  {/* Override toggle */}
                  <button
                    onClick={() => setForm((f) => ({ ...f, skills: f.skills !== null ? null : [] }))}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors text-left ${
                      form.skills !== null ? "border-blue-500 bg-blue-500/10" : "border-border bg-muted/20"
                    }`}
                  >
                    <div>
                      <div className={`text-xs font-semibold ${form.skills !== null ? "text-blue-400" : "text-foreground"}`}>Override defaults</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {form.skills !== null ? "Explicit skill list" : "Role defaults apply"}
                      </div>
                    </div>
                    <div className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${form.skills !== null ? "bg-blue-500" : "bg-muted"}`}>
                      <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${form.skills !== null ? "left-5" : "left-1"}`} />
                    </div>
                  </button>

                  {form.skills !== null && (
                    <div className="space-y-2.5">
                      {skills.map((s) => (
                        <label key={s.name} className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(form.skills ?? []).includes(s.name)}
                            onChange={() => setForm((f) => {
                              const cur = f.skills ?? [];
                              return { ...f, skills: cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name] };
                            })}
                            className="w-4 h-4 accent-primary cursor-pointer mt-0.5 shrink-0"
                          />
                          <div>
                            <div className="text-xs font-mono text-foreground">/{s.name}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{s.description}</div>
                          </div>
                        </label>
                      ))}
                      {(form.skills ?? []).length === 0 && skills.length > 0 && (
                        <p className="text-[10px] text-muted-foreground italic">No skills selected (explicitly none)</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          {saveError && <p className="text-xs text-red-500 mb-2">{saveError}</p>}
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-60 ${
              saveOk
                ? "bg-green-500/20 border border-green-500 text-green-500"
                : "bg-amber-500 hover:bg-amber-400 text-black border border-amber-500"
            }`}
          >
            <Save size={13} />
            {update.isPending ? "Saving…" : saveOk ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
