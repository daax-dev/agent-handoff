import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { useTheme } from "@/contexts/ThemeContext";

export interface FSMEdgeData extends Record<string, unknown> {
  trigger: string;
  isHitl: boolean;
  isCircuitBreaker?: boolean;
}

function edgeColor(
  data: FSMEdgeData | undefined,
  selected: boolean,
  p: { amber: string; amberBright: string; blue: string; blueBright: string; red: string; redBright: string }
): string {
  if (selected) {
    if (data?.isCircuitBreaker) return p.redBright;
    if (data?.isHitl)           return p.blueBright;
    return p.amberBright;
  }
  if (data?.isCircuitBreaker) return p.red;
  if (data?.isHitl)           return p.blue;
  return p.amber;
}

const FSMEdgeInner = function FSMEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: EdgeProps<Edge<FSMEdgeData>>) {
  const { palette: p } = useTheme();
  const d     = data as FSMEdgeData | undefined;
  const color = edgeColor(d, selected ?? false, p);
  const strokeWidth = selected ? 2.5 : 1.5;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.2,
  });

  const strokeDasharray = d?.isCircuitBreaker ? "5 3" : undefined;
  const glowFilter      = selected ? `drop-shadow(0 0 5px ${color})` : undefined;

  return (
    <>
      {/* Wide invisible hit-target for easy clicking */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={24}
        stroke="transparent"
        style={{ cursor: "pointer" }}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth,
          strokeDasharray,
          filter: glowFilter,
          transition: "stroke 0.15s, stroke-width 0.15s, filter 0.15s",
        }}
        markerEnd={markerEnd}
      />

      {d?.trigger && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              cursor: "pointer",
              background: p.nodeBg,
              border: `1px solid ${color}44`,
              borderRadius: 5,
              padding: d.isHitl ? "2px 8px" : "1px 6px",
              fontSize: 10,
              fontFamily: "'SF Mono','Fira Code',monospace",
              color,
              fontWeight: d.isHitl ? 700 : 400,
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap" as const,
              boxShadow: selected ? `0 0 6px ${color}55` : undefined,
            }}
          >
            {d.isHitl && (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  color: p.blueBright,
                  background: "#1e3a8a44",
                  border: `1px solid ${p.blue}`,
                  borderRadius: 3,
                  padding: "0px 4px",
                  letterSpacing: "0.05em",
                }}
              >
                HUMAN
              </span>
            )}
            {d.trigger}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

FSMEdgeInner.displayName = "FSMEdge";
export const FSMEdge = memo(FSMEdgeInner);

export const fsmEdgeTypes = {
  fsmEdge: FSMEdge,
};
