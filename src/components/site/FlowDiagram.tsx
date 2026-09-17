"use client";

import { Icon, type IconName } from "@/components/site/icons";

export interface FlowNode {
  icon: IconName;
  label: string;
  /** The middle node in a supply flow is GommaRush; it carries the emphasis. */
  emphasis?: boolean;
}

/**
 * A minimal supply/logistics flow: nodes joined by arrows.
 *
 * Used for both "several suppliers -> GommaRush -> your business" and
 * "supplier -> GommaRush -> end customer". One component, because they are the
 * same diagram making the same structural point, and drawing them twice is how
 * two versions of one idea end up looking different.
 *
 * Horizontal from `sm`, vertical below it. The connector is a real element
 * rather than a border trick so its direction can rotate with the layout --
 * an arrow pointing right in a vertical stack is the kind of detail that makes
 * a diagram read as ported rather than designed.
 */
export function FlowDiagram({ nodes, tone = "dark" }: { nodes: FlowNode[]; tone?: "dark" | "light" }) {
  const isLight = tone === "light";

  return (
    <ol className="flex flex-col items-stretch gap-0 sm:flex-row sm:items-center">
      {nodes.map((node, index) => (
        <li key={node.label} className="flex flex-col items-center sm:flex-1 sm:flex-row">
          <div
            className={`flex w-full flex-col items-center gap-2.5 rounded-xl border px-4 py-5 text-center sm:flex-1 ${
              node.emphasis
                ? isLight
                  ? "border-white/25 bg-white/10"
                  : "border-accent/30 bg-accent-light"
                : isLight
                  ? "border-white/15"
                  : "border-steel-soft bg-white"
            }`}
          >
            <span
              className={
                node.emphasis
                  ? isLight
                    ? "text-white"
                    : "text-accent"
                  : isLight
                    ? "text-white/70"
                    : "text-steel"
              }
            >
              <Icon name={node.icon} className="h-5 w-5" />
            </span>
            <span
              className={`text-[14px] font-bold leading-tight ${
                isLight ? "text-white" : node.emphasis ? "text-accent-dark" : "text-ink"
              }`}
            >
              {node.label}
            </span>
          </div>

          {index < nodes.length - 1 && (
            <span
              aria-hidden="true"
              className={`flex flex-none items-center justify-center py-2 sm:px-3 sm:py-0 ${
                isLight ? "text-white/40" : "text-steel"
              }`}
            >
              {/* Rotated a quarter turn in the stacked layout so it always
                  points along the reading direction. */}
              <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-90 sm:rotate-0" fill="none">
                <path
                  d="M4 12h15m0 0l-5.5-5.5M19 12l-5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
