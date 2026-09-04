import { motion, useReducedMotion } from 'framer-motion';

import { cn } from '@/lib/utils';

const floatingPaths = [
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `forward-${index}`,
    d: `M -180 ${36 + index * 38} C ${190 + index * 8} ${-118 + index * 25}, ${672 - index * 7} ${498 + index * 8}, 1600 ${96 + index * 27}`,
    opacity: 0.09 + index * 0.004,
    width: 0.55 + index * 0.025,
    duration: 21 + (index % 6) * 1.8,
    delay: -(index % 7) * 1.4,
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `reverse-${index}`,
    d: `M -140 ${660 - index * 43} C ${322 - index * 7} ${792 - index * 35}, ${840 + index * 11} ${10 + index * 30}, 1580 ${570 - index * 31}`,
    opacity: 0.075 + index * 0.0035,
    width: 0.5 + index * 0.025,
    duration: 24 + (index % 5) * 2,
    delay: -(index % 6) * 1.7,
  })),
];

export function FloatingPathsBackground({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 z-0 overflow-hidden', className)}
      style={{
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
        maskImage:
          'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
      }}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 700"
        fill="none"
        preserveAspectRatio="none"
      >
        {floatingPaths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="#FACC15"
            strokeLinecap="round"
            strokeWidth={path.width}
            vectorEffect="non-scaling-stroke"
            initial={
              reduceMotion
                ? false
                : { pathLength: 0.28, pathOffset: 0, opacity: path.opacity * 0.4 }
            }
            animate={
              reduceMotion
                ? { pathLength: 1, opacity: path.opacity * 0.65 }
                : {
                    pathLength: [0.28, 1, 0.28],
                    pathOffset: [0, 1, 0],
                    opacity: [path.opacity * 0.35, path.opacity, path.opacity * 0.35],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: path.duration,
                    delay: path.delay,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: 'linear',
                  }
            }
          />
        ))}
      </svg>
    </div>
  );
}
