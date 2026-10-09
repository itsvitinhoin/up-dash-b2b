import { ArrowRight, Building2, Store } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth, type DashboardMode } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const options: Array<{
  mode: DashboardMode;
  title: string;
  description: string;
  icon: typeof Building2;
  bullets: string[];
}> = [
  {
    mode: "B2B",
    title: "Painel B2B",
    description: "Clientes com UP Zero, vendedoras, WhatsApp e atribuição por campanhas.",
    icon: Building2,
    bullets: ["UP Zero", "Sellers", "WhatsApp", "UTM"],
  },
  {
    mode: "B2C",
    title: "Painel B2C",
    description: "Clientes Nuvemshop, com faturamento, pedidos pagos e eventos de ecommerce.",
    icon: Store,
    bullets: ["Nuvemshop", "Meta", "GA4", "E-commerce"],
  },
];

export default function WorkspaceSelectPage() {
  const [, setLocation] = useLocation();
  const { selectedDashboardMode, setSelectedDashboardMode } = useAuth();
  const { tx } = useI18n();

  function enter(mode: DashboardMode) {
    setSelectedDashboardMode(mode);
    setLocation("/dashboard");
  }

  return (
    <main className="up-workspace relative flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-4xl">
        <div className="mb-8">
          <img
            src={`${import.meta.env.BASE_URL}brand/up-group.png`}
            alt="Up Dash"
            className="mb-8 h-9 w-auto object-contain"
            draggable={false}
          />
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {tx("Escolha o ambiente")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {tx("Qual dashboard você quer acessar?")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {tx("Essa escolha filtra os clientes, ajusta o menu e evita misturar métricas B2B com B2C.")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {options.map((option) => {
            const Icon = option.icon;
            const active = selectedDashboardMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                onClick={() => enter(option.mode)}
                className={`up-glass-card group rounded-[20px] border p-6 text-left transition-colors hover:border-primary/60 hover:bg-accent/30 ${
                  active ? "border-primary/70" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-md border border-border bg-background p-2">
                    <Icon className="h-5 w-5 text-primary" />
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <h2 className="mt-5 text-lg font-semibold">{tx(option.title)}</h2>
                <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">
                  {tx(option.description)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {option.bullets.map((bullet) => (
                    <span
                      key={bullet}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                    >
                      {bullet}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={() => setLocation("/clients")}>
            {tx("Gerenciar clientes")}
          </Button>
        </div>
      </div>
    </main>
  );
}
