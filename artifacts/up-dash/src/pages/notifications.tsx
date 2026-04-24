import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type Notification,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useReducedMotion, staggerContainer, fadeInUp, withReducedMotion } from "@/lib/motion";
import {
  AlertTriangle,
  BellOff,
  CheckCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const ICONS: Record<Notification["type"], typeof Sparkles> = {
  ANOMALY: AlertTriangle,
  TOP_MOVER: TrendingUp,
  SUMMARY: Sparkles,
  ALERT: AlertTriangle,
};

const SEVERITY_TINT: Record<Notification["severity"], string> = {
  INFO: "bg-sky-500/15 text-sky-400",
  SUCCESS: "bg-emerald-500/15 text-emerald-400",
  WARNING: "bg-amber-500/15 text-amber-400",
};

export default function NotificationsPage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data, isLoading } = useListNotifications(
    { clientId, limit: 50 },
    { query: queryOpts({ enabled }) },
  );

  const invalidateNotifications = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) && q.queryKey[0] === "/api/notifications",
    });

  const markAll = useMarkAllNotificationsRead({
    mutation: { onSuccess: invalidateNotifications },
  });
  const markOne = useMarkNotificationRead({
    mutation: { onSuccess: invalidateNotifications },
  });

  const variants = useMemo(() => withReducedMotion(staggerContainer, reduced), [reduced]);
  const itemVariants = useMemo(() => withReducedMotion(fadeInUp, reduced), [reduced]);

  return (
    <div className="space-y-5" data-testid="page-notifications">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {data?.unreadCount ?? 0} unread · {data?.data.length ?? 0} total
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate({ params: { clientId } })}
          disabled={!data?.unreadCount || markAll.isPending}
          data-testid="notifications-mark-all"
        >
          <CheckCheck className="h-4 w-4 mr-1.5" />
          Mark all as read
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications yet"
          description="Anomalies, top movers, and rollups will appear here as we detect them."
        />
      ) : (
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={variants}
          className="space-y-3"
        >
          {data.data.map((n) => {
            const Icon = ICONS[n.type] ?? Sparkles;
            return (
              <motion.li key={n.id} variants={itemVariants}>
                <Card
                  data-testid={`notification-${n.id}`}
                  className={`p-4 flex gap-4 transition-colors ${!n.isRead ? "border-primary/30 bg-primary/5" : "bg-card"}`}
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-md shrink-0 ${SEVERITY_TINT[n.severity]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{n.title}</p>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {n.type.replace("_", " ").toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{n.body}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                      {!n.isRead && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() =>
                            markOne.mutate({
                              data: { notificationId: n.id },
                              params: { clientId },
                            })
                          }
                        >
                          Mark as read
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}
