import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { AlertTriangle, GitMerge, XCircle, User, Zap } from "lucide-react";
import { useTheme, type FSMPalette } from "@/contexts/ThemeContext";

// Semantic border colors — unchanged between light and dark
const BORDER_AMBER  = "#d97706";
const BORDER_DIM    = "#78350f";
const BORDER_GREEN  = "#15803d";
const BORDER_RED    = "#b91c1c";
const BORDER_ORANGE = "#c2410c";
const BORDER_BLUE   = "#1d4ed8";

export type StateCategory = "active" | "success" | "fail" | "escalated";

export interface FSMNodeData extends Record<string, unknown> {
  state: string;
  category: StateCategory;
  assignments: Array<{ role: string; tool: string; model: string }>;
  isTerminal: boolean;
  noAgent: boolean;
  abandonNote?: boolean;
}

function borderFor(d: FSMNodeData, selected: boolean): string {
  if (selected) return "#f59e0b";
  if (d.category === "success")   return BORDER_GREEN;
  if (d.category === "fail")      return BORDER_RED;
  if (d.category === "escalated") return BORDER_ORANGE;
  if (d.noAgent)                  return BORDER_DIM;
  return BORDER_AMBER;
}

function textColorFor(d: FSMNodeData, p: FSMPalette): string {
  if (d.category === "success")   return p.textGreen;
  if (d.category === "fail")      return p.textRed;
  if (d.category === "escalated") return p.textOrange;
  return p.textAmber;
}

function IconFor({ d, color }: { d: FSMNodeData; color: string }) {
  const size = 11;
  if (d.category === "success")   return <GitMerge size={size} color={color} />;
  if (d.category === "fail")      return <XCircle size={size} color={color} />;
  if (d.category === "escalated") return <AlertTriangle size={size} color={color} />;
  if (d.noAgent)                  return <AlertTriangle size={size} color={color} />;
  return <Zap size={size} color={color} />;
}

export const FSMNode = memo(function FSMNode({
  data,
  selected,
}: NodeProps<Node<FSMNodeData>>) {
  const { palette: p } = useTheme();
  const d = data as FSMNodeData;
  const border    = borderFor(d, selected ?? false);
  const textColor = textColorFor(d, p);
  const hasBody   = d.assignments.length > 0 || d.noAgent || d.abandonNote;

  return (
    <div
      style={{
        background: p.nodeBg,
        border: `2px solid ${border}`,
        borderRadius: 10,
        minWidth: 170,
        maxWidth: 240,
        boxShadow: selected
          ? `0 0 0 1px ${border}, 0 0 20px ${p.glow}`
          : "0 2px 8px rgba(0,0,0,0.18)",
        color: p.text,
        fontSize: 12,
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
    >
      {/* Invisible handles — all four sides for flexible routing */}
      <Handle type="target" position={Position.Left}   style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} id="top" />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} id="bottom" />

      {/* Header */}
      <div
        style={{
          padding: "8px 10px 7px",
          display: "flex",
          alignItems: "center",
          gap: 7,
          borderBottom: hasBody ? `1px solid ${p.nodeDivider}` : undefined,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: `${border}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconFor d={d} color={textColor} />
        </div>
        <span
          style={{
            fontWeight: 700,
            color: textColor,
            fontSize: 11,
            fontFamily: "'SF Mono','Fira Code',monospace",
            flex: 1,
            wordBreak: "break-all" as const,
          }}
        >
          {d.state}
        </span>
        {d.isTerminal && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: textColor,
              border: `1px solid ${border}`,
              borderRadius: 3,
              padding: "1px 4px",
              opacity: 0.75,
              whiteSpace: "nowrap" as const,
            }}
          >
            TERMINAL
          </span>
        )}
      </div>

      {/* Agent rows */}
      {d.assignments.length > 0 && (
        <div style={{ padding: "6px 10px 8px" }}>
          {d.assignments.map((a) => (
            <div key={a.role} style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 600, color: p.text, fontSize: 11 }}>
                {a.role}
              </div>
              <div style={{ color: p.textMuted, paddingLeft: 8, fontSize: 10, lineHeight: 1.5 }}>
                {a.tool}
                {a.model && (
                  <span style={{ opacity: 0.75 }}>
                    {" "}· {a.model.replace(/^claude-/, "")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No-agent warning */}
      {d.noAgent && (
        <div
          style={{
            padding: "5px 10px 8px",
            color: p.textAmber,
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <AlertTriangle size={10} />
          no agent — will stall here
        </div>
      )}

      {/* Abandon note */}
      {d.abandonNote && (
        <div
          style={{
            padding: "4px 10px 7px",
            color: p.textMuted,
            fontStyle: "italic",
            fontSize: 10,
          }}
        >
          ← abandon from any active state
        </div>
      )}
    </div>
  );
});

export const HumanGateNode = memo(function HumanGateNode({ selected }: NodeProps) {
  const { palette: p } = useTheme();
  const border = selected ? p.blueBright : BORDER_BLUE;
  return (
    <div
      style={{
        background: p.nodeBg,
        border: `2px solid ${border}`,
        borderRadius: 10,
        padding: "8px 14px",
        boxShadow: selected
          ? `0 0 0 1px ${p.blueBright}, 0 0 18px rgba(59,130,246,0.25)`
          : "0 2px 8px rgba(0,0,0,0.18)",
        color: p.textBlue,
        fontSize: 12,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 7,
        whiteSpace: "nowrap" as const,
        fontFamily: "'SF Mono','Fira Code',monospace",
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <User size={13} color={p.blueBright} />
      Human Approval
    </div>
  );
});

export const fsmNodeTypes = {
  fsmStateNode: FSMNode,
  humanGateNode: HumanGateNode,
};
