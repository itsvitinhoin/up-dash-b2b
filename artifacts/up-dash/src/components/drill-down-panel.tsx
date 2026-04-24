import { format, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Inbox, X } from "lucide-react";
import {
  useGetOrdersByDate,
  type OrderDrillRow,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import { useReducedMotion } from "@/lib/motion";
import { exportRowsAsCsv } from "@/lib/csv-export";

interface DrillDownPanelProps {
  date: string | null;
  onClose: () => void;
}

const STATUS_TINT: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  APPROVED: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  SHIPPED: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  DELIVERED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  CANCELED: "bg-red-500/15 text-red-400 border-red-500/20",
};

export function DrillDownPanel({ date, onClose }: DrillDownPanelProps) {
  const { user, selectedClientId } = useAuth();
  const reduced = useReducedMotion();
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading } = useGetOrdersByDate(
    {
      date: date ?? "1970-01-01",
      clientId,
      limit: 25,
    },
    {
      query: queryOpts({
        enabled: !!date && (user?.role === "CLIENT" || !!selectedClientId),
      }),
    },
  );

  const handleExport = () => {
    if (!data) return;
    exportRowsAsCsv<OrderDrillRow>(
      `orders-${data.date}.csv`,
      data.orders,
      [
        { header: "Order ID", accessor: (r) => r.id },
        { header: "Created", accessor: (r) => r.createdAt },
        { header: "Customer", accessor: (r) => r.customerName ?? "" },
        { header: "Email", accessor: (r) => r.customerEmail ?? "" },
        { header: "Seller", accessor: (r) => r.sellerName ?? "" },
        { header: "State", accessor: (r) => r.state ?? "" },
        { header: "City", accessor: (r) => r.city ?? "" },
        { header: "Status", accessor: (r) => r.status },
        { header: "Amount", accessor: (r) => r.amount },
      ],
    );
  };

  return (
    <Sheet open={!!date} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
        data-testid="drilldown-panel"
      >
        <SheetHeader>
          <SheetTitle>
            Orders on {date ? format(parseISO(date), "EEEE, MMM d, yyyy") : "—"}
          </SheetTitle>
          <SheetDescription>
            Top revenue orders for the selected day. Click any row to learn more.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3 mt-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !data || data.orders.length === 0 ? (
          <div className="mt-10 flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-10">
            <Inbox className="h-8 w-8 mb-3 opacity-50" />
            No orders recorded for this day.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <Stat label="Orders" value={data.totalOrders.toLocaleString()} />
              <Stat label="Revenue" value={formatCurrency(data.totalRevenue)} />
            </div>

            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Top {data.orders.length} orders
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                className="h-7 text-xs"
                data-testid="drilldown-export"
              >
                Export CSV
              </Button>
            </div>

            <ul className="mt-3 divide-y divide-border border-y border-border">
              <AnimatePresence initial={false}>
                {data.orders.map((row, idx) => (
                  <motion.li
                    key={row.id}
                    initial={reduced ? false : { opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: reduced ? 0 : Math.min(idx, 8) * 0.02 }}
                    className="py-3 flex items-center gap-3"
                    data-testid={`drill-row-${row.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {row.customerName ?? "Unknown customer"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.sellerName ?? "—"} · {row.city ?? "—"}, {row.state ?? "—"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${STATUS_TINT[row.status] ?? ""}`}
                    >
                      {row.status.toLowerCase()}
                    </Badge>
                    <span className="tabular-nums text-sm font-semibold">
                      {formatCurrency(row.amount)}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>

            <p className="mt-4 text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" />
              Showing the top {data.orders.length} of {data.totalOrders} orders by amount.
            </p>
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="absolute top-4 right-12 h-7 w-7 p-0"
          onClick={onClose}
          aria-label="Close drill-down"
        >
          <X className="h-4 w-4" />
        </Button>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-1">{value}</p>
    </div>
  );
}
