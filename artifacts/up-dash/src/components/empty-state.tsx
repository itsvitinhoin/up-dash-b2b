import { type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={variants}
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14 rounded-lg border border-dashed border-border/70 bg-card/40",
        className,
      )}
      data-testid="empty-state"
    >
      <div className="rounded-full bg-primary/10 p-4 mb-5 ring-1 ring-primary/15">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">{description}</p>
      {action && (
        <Button
          size="sm"
          className="mt-5"
          onClick={action.onClick}
          data-testid="empty-state-action"
        >
          {action.label}
        </Button>
      )}
    </motion.div>
  );
}
