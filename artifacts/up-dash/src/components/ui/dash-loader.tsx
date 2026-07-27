import { cn } from "@/lib/utils";

type DashLoaderProps = {
  className?: string;
  label?: string;
  description?: string;
  compact?: boolean;
};

export function DashLoader({ className, label = "Carregando dados", description, compact = false }: DashLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 text-center", compact ? "py-4" : "min-h-[260px] py-8", className)}>
      <div className="loader" aria-hidden="true">
        <div className="box box0">
          <div />
        </div>
        <div className="box box1">
          <div />
        </div>
        <div className="box box2">
          <div />
        </div>
        <div className="box box3">
          <div />
        </div>
        <div className="box box4">
          <div />
        </div>
        <div className="box box5">
          <div />
        </div>
        <div className="box box6">
          <div />
        </div>
        <div className="box box7">
          <div />
        </div>
        <div className="ground">
          <div />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{label}</p>
        {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

export function DashLoadingCard({ className, label, description }: DashLoaderProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <DashLoader label={label} description={description} />
    </div>
  );
}
