"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FloatingPathsBackgroundProps {
  /** Flips the horizontal direction the lines curve toward. Use 1 or -1. */
  position: number;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Soft, minimalist animated lines meant to sit behind page content.
 * Rendered in the NOX brand yellow at a low, steady opacity so the
 * animation stays subtle rather than calling attention to itself.
 */
export function FloatingPathsBackground({
  position,
  children,
  className,
}: FloatingPathsBackgroundProps) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
      380 - i * 5 * position
    } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
      152 - i * 5 * position
    } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.8 + i * 0.04,
    // Kept low so the lines read as a faint, minimalist texture rather
    // than a strong visual element, but still perceptible on white.
    opacity: 0.22 + i * 0.013,
    // Deterministic per-path duration (no Math.random) so server- and
    // client-rendered markup stay in sync during hydration.
    duration: 20 + (i % 10),
  }));

  return (
    <div className={cn("w-full relative", className)}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg
          className="h-full w-full"
          // Matches the actual bounding envelope of the generated curves
          // (not the original 696x316 demo crop) so the full sweep of
          // lines is visible instead of a small clipped corner.
          viewBox="-400 -420 1100 1320"
          fill="none"
          preserveAspectRatio="none"
        >
          {paths.map((path) => (
            <motion.path
              key={path.id}
              d={path.d}
              stroke="#FACC15"
              strokeWidth={path.width}
              strokeOpacity={path.opacity}
              initial={{ pathLength: 0.3, opacity: path.opacity * 0.7 }}
              animate={{
                pathLength: 1,
                opacity: [path.opacity * 0.6, path.opacity, path.opacity * 0.6],
                pathOffset: [0, 1, 0],
              }}
              transition={{
                duration: path.duration,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          ))}
        </svg>
      </div>
      {children}
    </div>
  );
}
