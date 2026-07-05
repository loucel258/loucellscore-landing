"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Shield,
  UserCheck,
  Lock,
  BookOpen,
  Brain,
  PlayCircle,
  ClipboardList,
} from "lucide-react";

/**
 * TrustStackFlow — animated 7-layer diagram showing a message passing through
 * Loucells Core's Trust Stack. One layer "ignites" at a time on a 7-second loop,
 * mimicking the journey of a single request: Ingress → Identity → Governance →
 * Knowledge → Reasoning → Execution → Audit.
 *
 * Purpose: make the abstract "7-layer architecture" tangible without forcing
 * the visitor to read a wall of text. Pairs with the 3 pillar cards in the
 * Architecture section — diagram on left, pillars + CTA on right.
 */

type Layer = {
  id: string;
  name: string;
  short: string;
  icon: React.ReactNode;
  tint: "cyan" | "violet";
};

const LAYERS: Layer[] = [
  { id: "ingress",    name: "Secure Ingress",     short: "HMAC · rate limit",        icon: <Shield className="size-3.5" strokeWidth={1.8} />,          tint: "cyan"   },
  { id: "identity",   name: "Identity & Access",  short: "RBAC · workspace iso",     icon: <UserCheck className="size-3.5" strokeWidth={1.8} />,       tint: "violet" },
  { id: "governance", name: "Data Governance",    short: "DLP L1 + L2 · PII mask",   icon: <Lock className="size-3.5" strokeWidth={1.8} />,            tint: "cyan"   },
  { id: "knowledge",  name: "Knowledge & Context", short: "Curated KB · workspace-scoped", icon: <BookOpen className="size-3.5" strokeWidth={1.8} />,   tint: "violet" },
  { id: "reasoning",  name: "Agent Reasoning",    short: "Claude · confidence",      icon: <Brain className="size-3.5" strokeWidth={1.8} />,           tint: "cyan"   },
  { id: "execution",  name: "Action Execution",   short: "HITL · idempotent",        icon: <PlayCircle className="size-3.5" strokeWidth={1.8} />,      tint: "violet" },
  { id: "audit",      name: "Audit & Observability", short: "Append-only · hash chain", icon: <ClipboardList className="size-3.5" strokeWidth={1.8} />, tint: "cyan"   },
];

const LOOP_SECONDS = 7;
const STEP = LOOP_SECONDS / LAYERS.length;

export function TrustStackFlow() {
  const reduce = useReducedMotion();
  return (
    <div className="relative">
      <ol className="relative flex flex-col gap-2">
        {/* Spine — vertical line connecting all layers */}
        <div
          aria-hidden
          className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-cyan/30 via-violet/30 to-cyan/30"
        />
        {/* Traveling pulse — dot that slides down the spine */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="absolute left-[12px] z-10 size-4 rounded-full"
            style={{
              background:
                "radial-gradient(circle, #06B6D4 0%, rgba(6,182,212,0.5) 40%, transparent 70%)",
              boxShadow: "0 0 18px rgba(6,182,212,0.6)",
            }}
            initial={{ top: 0 }}
            animate={{ top: ["0%", "100%"] }}
            transition={{
              duration: LOOP_SECONDS,
              ease: "linear",
              repeat: Infinity,
            }}
          />
        )}

        {LAYERS.map((layer, i) => (
          <LayerRow key={layer.id} layer={layer} index={i} reduce={!!reduce} />
        ))}
      </ol>
    </div>
  );
}

function LayerRow({
  layer,
  index,
  reduce,
}: {
  layer: Layer;
  index: number;
  reduce: boolean;
}) {
  const tintCls =
    layer.tint === "cyan"
      ? {
          ring: "ring-cyan/60",
          bg: "bg-cyan/15",
          text: "text-cyan",
          glow: "shadow-[0_0_22px_-4px_rgba(6,182,212,0.7)]",
        }
      : {
          ring: "ring-violet/60",
          bg: "bg-violet/15",
          text: "text-violet",
          glow: "shadow-[0_0_22px_-4px_rgba(124,58,237,0.7)]",
        };

  return (
    <li className="relative flex items-center gap-3">
      <motion.span
        className={`relative z-[2] flex size-10 shrink-0 items-center justify-center rounded-full border border-border-soft bg-surface text-text-secondary`}
        animate={
          reduce
            ? {}
            : {
                borderColor: [
                  "rgb(var(--border-soft-rgb, 50 60 70))",
                  layer.tint === "cyan" ? "#06B6D4" : "#7C3AED",
                  "rgb(var(--border-soft-rgb, 50 60 70))",
                ],
                color: [
                  "var(--text-secondary)",
                  layer.tint === "cyan" ? "#06B6D4" : "#A78BFA",
                  "var(--text-secondary)",
                ],
                scale: [1, 1.08, 1],
              }
        }
        transition={{
          duration: 1.1,
          delay: index * STEP,
          repeat: Infinity,
          repeatDelay: LOOP_SECONDS - 1.1,
          ease: "easeInOut",
        }}
      >
        {layer.icon}
      </motion.span>

      <motion.div
        className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface/60 px-3.5 py-2.5 backdrop-blur-sm`}
        animate={
          reduce
            ? {}
            : {
                borderColor: [
                  "var(--border-soft)",
                  layer.tint === "cyan" ? "#06B6D466" : "#7C3AED66",
                  "var(--border-soft)",
                ],
                backgroundColor: [
                  "rgba(255,255,255,0.02)",
                  layer.tint === "cyan"
                    ? "rgba(6,182,212,0.08)"
                    : "rgba(124,58,237,0.08)",
                  "rgba(255,255,255,0.02)",
                ],
              }
        }
        transition={{
          duration: 1.1,
          delay: index * STEP,
          repeat: Infinity,
          repeatDelay: LOOP_SECONDS - 1.1,
          ease: "easeInOut",
        }}
      >
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold leading-tight text-text-primary">
            {layer.name}
          </span>
          <span className="font-mono text-[10px] text-text-secondary">
            {layer.short}
          </span>
        </div>
        <span
          className={`flex size-6 items-center justify-center rounded-md ${tintCls.bg} font-mono text-[10px] ${tintCls.text}`}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
      </motion.div>
    </li>
  );
}
