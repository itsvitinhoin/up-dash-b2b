import { useMemo } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellRing, CheckCheck, AlertTriangle, Sparkles, TrendingUp } from "lucide-react";
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type Notification,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data } = useListNotifications(
    { clientId, limit: 12 },
    {
      query: queryOpts({
        enabled,
        refetchInterval: 60_000,
      }),
    },
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

  const variants = useMemo(() => withReducedMotion(fadeInUp, reduced), [reduced]);
  const unread = data?.unreadCount ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 hover:bg-accent"
          aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
          data-testid="notification-bell"
        >
          {unread > 0 ? (
            <motion.span
              animate={reduced ? undefined : { rotate: [0, -8, 8, -6, 6, 0] }}
              transition={{ duration: 0.7, repeat: 0 }}
              className="inline-flex"
            >
              <BellRing className="h-4 w-4" />
            </motion.span>
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
              data-testid="notification-unread-count"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 overflow-hidden"
        data-testid="notification-popover"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {unread > 0 ? `${unread} unread` : "You're all caught up"}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate({ params: { clientId } })}
            data-testid="notification-mark-all"
            className="h-7 text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
            Mark all read
          </Button>
        </div>

        <ScrollArea className="max-h-[420px]">
          {!data || data.data.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No notifications yet. Check back soon.
            </div>
          ) : (
            <ul>
              <AnimatePresence initial={false}>
                {data.data.map((n) => (
                  <motion.li
                    key={n.id}
                    layout={!reduced}
                    initial="hidden"
                    animate="visible"
                    exit={{ opacity: 0, x: 12 }}
                    variants={variants}
                  >
                    <NotificationRow
                      notification={n}
                      onMarkRead={() =>
                        markOne.mutate({
                          data: { notificationId: n.id },
                          params: { clientId },
                        })
                      }
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </ScrollArea>

        <div className="border-t border-border px-4 py-2 text-right">
          <Link
            href="/notifications"
            className="text-xs text-primary hover:underline"
            data-testid="notification-see-all"
          >
            See all notifications →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ICONS: Record<Notification["type"], typeof Sparkles> = {
  ANOMALY: AlertTriangle,
  TOP_MOVER: TrendingUp,
  SUMMARY: Sparkles,
  ALERT: AlertTriangle,
};

const SEVERITY_TINTS: Record<Notification["severity"], string> = {
  INFO: "bg-sky-500/15 text-sky-400",
  SUCCESS: "bg-emerald-500/15 text-emerald-400",
  WARNING: "bg-amber-500/15 text-amber-400",
};

interface NotificationRowProps {
  notification: Notification;
  onMarkRead: () => void;
}

function NotificationRow({ notification, onMarkRead }: NotificationRowProps) {
  const Icon = ICONS[notification.type] ?? Sparkles;
  return (
    <button
      type="button"
      onClick={() => {
        if (!notification.isRead) onMarkRead();
      }}
      className={cn(
        "w-full text-left flex gap-3 px-4 py-3 border-b border-border/60 hover:bg-accent/30 transition-colors",
        !notification.isRead && "bg-primary/5",
      )}
      data-testid={`notification-row-${notification.id}`}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          SEVERITY_TINTS[notification.severity],
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight truncate">{notification.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
          {notification.body}
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-1">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!notification.isRead && (
        <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />
      )}
    </button>
  );
}
