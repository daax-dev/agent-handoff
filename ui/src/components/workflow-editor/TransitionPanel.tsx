import { useState, useEffect } from "react";
import { X, Trash2, User, Zap } from "lucide-react";
import type { Edge } from "@xyflow/react";
import type { FSMEdgeData } from "./FSMEdge";
import { useTheme } from "@/contexts/ThemeContext";

interface TransitionPanelProps {
  edge: Edge<FSMEdgeData>;
  allTriggers?: string[];
  onUpdate: (edgeId: string, updates: { trigger?: string; isHitl?: boolean }) => void;
  onDelete: (edgeId: string) => void;
  onClose: () => void;
}

export function TransitionPanel({
  edge,
  onUpdate,
  onDelete,
  onClose,
}: TransitionPanelProps) {
  const { palette: p } = useTheme();
  const d = edge.data as FSMEdgeData | undefined;
  const isCircuitBreaker = d?.isCircuitBreaker ?? false;

  const [triggerValue, setTriggerValue] = useState(d?.trigger ?? "");
  const [isHitl, setIsHitl] = useState(d?.isHitl ?? false);

  useEffect(() => {
    setTriggerValue(d?.trigger ?? "");
    setIsHitl(d?.isHitl ?? false);
  }, [edge.id, d?.trigger, d?.isHitl]);

  const parts     = edge.id.split("--");
  const fromState = parts[0] ?? edge.source;
  const toState   = parts[2] ?? edge.target;

  function commitTrigger() {
    if (triggerValue.trim() && triggerValue.trim() !== d?.trigger) {
      onUpdate(edge.id, { trigger: triggerValue.trim() });
    }
  }

  function toggleHitl() {
    const next = !isHitl;
    setIsHitl(next);
    onUpdate(edge.id, { isHitl: next });
  }

  return (
    <div
      style={{
        width: 280,
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
        <span style={{ fontWeight: 600, fontSize: 13 }}>Transition</span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: p.textMuted,
            display: "flex",
            padding: 2,
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ padding: "16px 14px", flex: 1, overflowY: "auto" as const }}>
        {/* From → To */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 10, fontWeight: 600, color: p.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
            Route
          </label>
          <div
            style={{
              marginTop: 6,
              padding: "7px 10px",
              background: p.inputBg,
              borderRadius: 6,
              border: `1px solid ${p.inputBorder}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              fontFamily: "'SF Mono','Fira Code',monospace",
              color: p.amber,
            }}
          >
            <span>{fromState}</span>
            <span style={{ color: p.textMuted }}>→</span>
            <span>{toState}</span>
          </div>
        </div>

        {/* Trigger name */}
        {!isCircuitBreaker && (
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: p.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
              Trigger
            </label>
            <input
              value={triggerValue}
              onChange={(e) => setTriggerValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitTrigger(); }}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "7px 10px",
                background: p.inputBg,
                border: `1px solid ${p.inputBorder}`,
                borderRadius: 6,
                color: p.text,
                fontSize: 11,
                fontFamily: "'SF Mono','Fira Code',monospace",
                outline: "none",
                boxSizing: "border-box" as const,
              }}
              placeholder="trigger_name"
              onFocus={(e) => { e.currentTarget.style.borderColor = p.amber; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = p.inputBorder; commitTrigger(); }}
            />
          </div>
        )}

        {/* HITL toggle */}
        {!isCircuitBreaker && (
          <div
            style={{
              marginBottom: 18,
              padding: "12px 12px",
              background: isHitl ? "#1e3a5f22" : p.inputBg,
              border: `1px solid ${isHitl ? p.blue : p.inputBorder}`,
              borderRadius: 8,
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
              onClick={toggleHitl}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isHitl
                  ? <User size={14} color={p.blueBright} />
                  : <Zap size={14} color={p.amber} />
                }
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: isHitl ? p.blueBright : p.text }}>
                    {isHitl ? "Human required" : "Agent handles"}
                  </div>
                  <div style={{ fontSize: 10, color: p.textMuted, marginTop: 1 }}>
                    {isHitl
                      ? "A human must approve before proceeding"
                      : "Agent proceeds automatically"}
                  </div>
                </div>
              </div>

              {/* Toggle switch */}
              <div
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: isHitl ? p.blue : "#374151",
                  position: "relative",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 3,
                    left: isHitl ? 19 : 3,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 0.2s",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Circuit breaker info */}
        {isCircuitBreaker && (
          <div
            style={{
              padding: "10px 12px",
              background: p.inputBg,
              border: `1px solid ${p.red}44`,
              borderRadius: 8,
              color: p.textRed,
              fontSize: 11,
            }}
          >
            Auto-escalates after repeated <code>request_changes</code> cycles.
            Not directly editable.
          </div>
        )}
      </div>

      {/* Footer — delete */}
      {!isCircuitBreaker && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${p.panelBorder}` }}>
          <button
            onClick={() => onDelete(edge.id)}
            style={{
              width: "100%",
              padding: "7px 0",
              background: "none",
              border: `1px solid ${p.red}`,
              borderRadius: 6,
              color: p.textRed,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${p.red}22`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            <Trash2 size={13} />
            Delete transition
          </button>
        </div>
      )}
    </div>
  );
}
