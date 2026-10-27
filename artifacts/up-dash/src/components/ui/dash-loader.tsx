import { useState } from "react";
import { cn } from "@/lib/utils";

// Logo "up platform" em movimento (WebP animado, 24 quadros/s, 5 s em repetição). Quem pediu menos movimento no sistema vê um quadro parado.
const LOADER_ANIMATED = `${import.meta.env.BASE_URL}brand/up-loader.webp`;
const LOADER_STILL = `${import.meta.env.BASE_URL}brand/up-loader-static.webp`;

function LoaderLogo({ compact }: { compact: boolean }) {
  const [ready, setReady] = useState(false);
  // O espaço é reservado (proporção 2:1 do arquivo) e o logo aparece suavemente quando chega; enquanto isso um bloco pulsante ocupa o lugar,
  // para o carregamento nunca parecer quebrado (o arquivo tem ~1,1 MB).
  const size = compact ? "h-14 w-28" : "h-24 w-48";
  return (
    <div className={cn("relative", size)} aria-hidden="true">
      {!ready && <div className="absolute inset-3 animate-pulse rounded-xl bg-primary/10" />}
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet={LOADER_STILL} />
        <img
          ref={(img) => {
            if (img?.complete) setReady(true);
          }}
          src={LOADER_ANIMATED}
          alt=""
          width={480}
          height={240}
          draggable={false}
          decoding="async"
          onLoad={() => setReady(true)}
          className={cn("absolute inset-0 h-full w-full select-none object-contain transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
        />
      </picture>
    </div>
  );
}

type DashLoaderProps = {
  className?: string;
  label?: string;
  description?: string;
  compact?: boolean;
};

export function DashLoader({ className, label = "Carregando dados", description, compact = false }: DashLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 text-center", compact ? "py-4" : "min-h-[260px] py-8", className)}>
      <LoaderLogo compact={compact} />
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
