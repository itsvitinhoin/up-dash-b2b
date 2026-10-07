import { cn } from "@/lib/utils";

type DashLoaderProps = { className?: string; label?: string; description?: string; compact?: boolean };

/** Animação oficial UP, derivada do vídeo fornecido, com canal alfa. */
export function DashLoader({ className, label = "Carregando dados", description, compact = false }: DashLoaderProps) {
  const base = `${import.meta.env.BASE_URL}brand/`;
  return <div className={cn("flex flex-col items-center justify-center gap-3 text-center", compact ? "py-2" : "py-8", className)}>
    <picture aria-hidden="true"><source media="(prefers-reduced-motion: reduce)" srcSet={`${base}up-loader-poster.webp`} /><img src={`${base}up-loader.webp`} width="480" height="240" decoding="async" fetchPriority="high" className="up-loader-animation" alt="" /></picture>
    <div className="space-y-1"><p className="text-xs font-semibold text-foreground">{label}</p>{description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}</div>
  </div>;
}

export function DashLoadingCard({ className, label, description }: DashLoaderProps) {
  return <div className={cn("rounded-[20px] border border-border bg-card", className)}><DashLoader label={label} description={description} /></div>;
}
