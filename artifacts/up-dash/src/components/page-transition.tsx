import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotion, pageVariants, withReducedMotion } from "@/lib/motion";

export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(pageVariants, reduced);
  return (
    <motion.div
      key={routeKey}
      initial="initial"
      animate="enter"
      variants={variants}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}
