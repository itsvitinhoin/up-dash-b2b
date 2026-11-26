import { Link, useSearch } from "wouter";
import { ChartNoAxesCombined, Megaphone } from "lucide-react";
import { DASHBOARD_CONTEXT_QUERY_KEYS } from "@/lib/dashboard-context-url";
import { cn } from "@/lib/utils";

const channels = [
  { key: "meta", name: "Meta Ads", href: "/performance/anuncios/meta-ads", icon: Megaphone },
  { key: "google", name: "Google Ads", href: "/performance/anuncios/google-ads", icon: ChartNoAxesCombined },
] as const;

export function AdsNavigation({ active }: { active: (typeof channels)[number]["key"] }) {
  const currentParams = new URLSearchParams(useSearch());
  const params = new URLSearchParams();
  for (const key of DASHBOARD_CONTEXT_QUERY_KEYS) {
    const value = currentParams.get(key);
    if (value) params.set(key, value);
  }
  const search = params.size ? "?" + params.toString() : "";

  return (
    <nav aria-label="Plataforma de anúncios" className="inline-flex max-w-full gap-1 rounded-xl border bg-muted/60 p-1">
      {channels.map(({ key, name, href, icon: Icon }) => (
        <Link
          key={key}
          href={href + search}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {name}
        </Link>
      ))}
    </nav>
  );
}
