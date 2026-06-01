import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion, useReducedMotion } from "framer-motion";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Eye,
  EyeOff,
  Sparkles,
  TrendingUp,
  Users,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { formatCurrencySmart } from "@/lib/formatters";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const SEED_SERIES = [
  18, 22, 19, 28, 31, 27, 35, 41, 38, 46, 52, 49, 58, 65, 61, 72, 79, 75, 86,
];

function buildSeries(base: number, drift: number, variance: number, len = 19) {
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < len; i++) {
    v += drift + (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * variance;
    out.push(Math.max(1, Math.round(v)));
  }
  return out;
}

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const loginMutation = useLogin();
  const reduced = useReducedMotion();

  const [showPassword, setShowPassword] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2200);
    return () => window.clearInterval(id);
  }, [reduced]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          login(res.accessToken, res.refreshToken, res.user);
          setLocation(res.user.role === "ADMIN" ? "/workspace-select" : "/dashboard");
        },
      },
    );
  };

  // Live-feeling KPI tiles
  const liveStats = useMemo(() => {
    const seed = tick;
    return [
      {
        label: "Revenue today",
        value: 184230 + seed * 137,
        delta: 12.4,
        icon: TrendingUp,
        color: "hsl(var(--chart-1))",
        format: (v: number) => formatCurrencySmart(v),
        series: buildSeries(40, 1.4, 4),
      },
      {
        label: "Live orders",
        value: 1284 + seed * 3,
        delta: 8.1,
        icon: ShoppingBag,
        color: "hsl(var(--chart-2))",
        format: (v: number) => Math.round(v).toLocaleString(),
        series: buildSeries(20, 0.9, 3),
      },
      {
        label: "Conversion",
        value: 3.42 + (seed % 5) * 0.04,
        delta: 0.8,
        icon: Zap,
        color: "hsl(var(--chart-3))",
        format: (v: number) => `${v.toFixed(2)}%`,
        series: SEED_SERIES,
      },
      {
        label: "Active users",
        value: 8743 + seed * 11,
        delta: 4.6,
        icon: Users,
        color: "hsl(var(--chart-4))",
        format: (v: number) => Math.round(v).toLocaleString(),
        series: buildSeries(30, 1.1, 5),
      },
    ];
  }, [tick]);

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    visible: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, delay: reduced ? 0 : i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
    }),
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#05060a] text-white">
      {/* ── Background layers ─────────────────────────────────────────── */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full blur-3xl opacity-50"
        style={{ background: "radial-gradient(circle, hsl(var(--chart-1) / 0.45), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 -right-32 h-[600px] w-[600px] rounded-full blur-3xl opacity-40"
        style={{ background: "radial-gradient(circle, hsl(var(--chart-3) / 0.45), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.25]"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(120,140,255,0.18), transparent 60%)",
        }}
      />

      {/* Floating orbs */}
      {!reduced &&
        [0, 1, 2].map((i) => (
          <motion.div
            key={i}
            aria-hidden
            className="absolute rounded-full blur-2xl"
            style={{
              width: 220 - i * 40,
              height: 220 - i * 40,
              left: `${15 + i * 28}%`,
              top: `${30 + i * 12}%`,
              background: `hsl(var(--chart-${i + 1}) / 0.18)`,
            }}
            animate={{
              y: [0, -22, 0, 18, 0],
              x: [0, 14, 0, -10, 0],
            }}
            transition={{ duration: 14 + i * 3, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-6 md:px-10 py-6">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          className="flex items-center gap-2.5"
        >
          <img
            src="/up-dash-logo.png"
            alt="Up Dash"
            className="h-9 w-auto object-contain"
            draggable={false}
          />
          <span className="hidden sm:inline-flex ml-2 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/70">
            v2.4 · live
          </span>
        </motion.div>

        <motion.a
          initial="hidden"
          animate="visible"
          custom={1}
          variants={fadeUp}
          href="https://updash.com"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors"
        >
          About UP Dash <ArrowUpRight className="h-3.5 w-3.5" />
        </motion.a>
      </div>

      {/* ── Main grid ─────────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 pb-12 md:grid-cols-[1.15fr_1fr] md:gap-16 md:px-10 md:pb-20 md:pt-6">
        {/* LEFT — pitch + live KPIs */}
        <div className="flex flex-col justify-center">
          <motion.div initial="hidden" animate="visible" custom={1} variants={fadeUp}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-white/70 backdrop-blur">
              <Sparkles className="h-3 w-3 text-primary" />
              D2C intelligence platform
            </span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={2}
            variants={fadeUp}
            className="mt-5 text-4xl md:text-5xl font-bold tracking-tight leading-[1.05]"
          >
            Where fashion brands{" "}
            <span className="bg-gradient-to-r from-white via-white to-primary bg-clip-text text-transparent">
              decode their data.
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={3}
            variants={fadeUp}
            className="mt-5 max-w-lg text-base md:text-lg text-white/65 leading-relaxed"
          >
            Unify sales, customer behavior, and product signals into one live
            command center. Spot anomalies the second they happen — not next
            quarter.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={4}
            variants={fadeUp}
            className="mt-10 grid grid-cols-2 gap-3 max-w-xl"
          >
            {liveStats.map((s, i) => (
              <LiveTile key={s.label} {...s} delay={i * 0.08} reduced={!!reduced} />
            ))}
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={6}
            variants={fadeUp}
            className="mt-8 flex items-center gap-4 text-xs text-white/45"
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Real-time pipeline
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">Trusted by fashion D2C teams</span>
          </motion.div>
        </div>

        {/* RIGHT — auth card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-center md:justify-end"
        >
          <div className="relative w-full max-w-md">
            {/* Glow ring */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary) / 0.6), transparent 40%, hsl(var(--chart-3) / 0.5) 100%)",
                filter: "blur(0.5px)",
              }}
            />
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl backdrop-blur-xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
                  <p className="mt-1 text-sm text-white/55">
                    Access your live brand dashboard
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
              </div>

              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  {loginMutation.isError && (
                    <Alert
                      variant="destructive"
                      className="border-red-500/40 bg-red-500/10 text-red-100"
                    >
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {loginMutation.error?.status === 401
                          ? "Invalid credentials. Please try again."
                          : "An error occurred during login."}
                      </AlertDescription>
                    </Alert>
                  )}

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/80 text-xs uppercase tracking-wider font-medium">
                          Work email
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="you@brand.com"
                            autoComplete="email"
                            {...field}
                            data-testid="input-email"
                            className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/35 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-white/80 text-xs uppercase tracking-wider font-medium">
                          Password
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              autoComplete="current-password"
                              {...field}
                              data-testid="input-password"
                              className="h-11 pr-10 bg-white/5 border-white/10 text-white placeholder:text-white/35 focus-visible:ring-primary/50 focus-visible:border-primary/50"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((s) => !s)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-white/50 hover:text-white"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              tabIndex={-1}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
                    <Button
                      type="submit"
                      className="group relative w-full h-11 overflow-hidden bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-[0_0_30px_-8px_hsl(var(--primary))]"
                      disabled={loginMutation.isPending}
                      data-testid="button-submit"
                    >
                      <span className="relative z-10 flex items-center justify-center gap-1.5">
                        {loginMutation.isPending ? (
                          <>
                            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                            Signing in…
                          </>
                        ) : (
                          <>
                            Sign in
                            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                          </>
                        )}
                      </span>
                      {!reduced && !loginMutation.isPending && (
                        <span
                          aria-hidden
                          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                        />
                      )}
                    </Button>
                  </motion.div>
                </form>
              </Form>

            </div>

            <p className="mt-5 text-center text-xs text-white/40">
              © {new Date().getFullYear()} UP Dash Inc. · Built for fashion D2C teams.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

interface LiveTileProps {
  label: string;
  value: number;
  delta: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  format: (v: number) => string;
  series: number[];
  delay: number;
  reduced: boolean;
}

function LiveTile({
  label,
  value,
  delta,
  icon: Icon,
  color,
  format,
  series,
  delay,
  reduced,
}: LiveTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: reduced ? 0 : 0.45 + delay, ease: [0.22, 1, 0.36, 1] }}
      className="group relative rounded-xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur-md hover:bg-white/[0.06] transition-colors overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-30 blur-2xl"
        style={{ background: color }}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/55 font-medium">
          {label}
        </span>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-white/10"
          style={{ background: `${color.replace(")", " / 0.18)")}` }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-2">
        <CountUp
          value={value}
          format={format}
          duration={900}
          className="text-xl md:text-2xl font-semibold tracking-tight tabular-nums"
        />
        <span className="text-[11px] font-medium text-emerald-400 inline-flex items-center gap-0.5">
          <ArrowUpRight className="h-3 w-3" />
          {delta.toFixed(1)}%
        </span>
      </div>
      <div className="relative mt-2 h-7 -mx-1">
        <Sparkline
          values={series}
          width={180}
          height={28}
          stroke={color}
          fill={`${color.replace(")", " / 0.15)")}`}
          className="w-full h-full"
        />
      </div>
    </motion.div>
  );
}
