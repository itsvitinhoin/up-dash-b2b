import { useReducedMotion as useFramerReducedMotion, type Variants } from "framer-motion";

export function useReducedMotion(): boolean {
  return useFramerReducedMotion() ?? false;
}

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const cardEntry: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } },
};

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.16 } },
};

export function withReducedMotion<T extends Variants>(variants: T, reduced: boolean): T {
  if (!reduced) return variants;
  const flat = Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [
      k,
      { ...(v as object), transition: { duration: 0 } },
    ]),
  ) as T;
  return flat;
}
