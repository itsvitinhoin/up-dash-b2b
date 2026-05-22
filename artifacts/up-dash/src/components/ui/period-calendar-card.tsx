import { format, isAfter, isBefore, isSameDay, isSameMonth, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface PeriodCalendarCardProps {
  month?: Date;
  from?: Date;
  to?: Date;
  className?: string;
  onDaySelect?: (day: Date) => void;
}

function isInRange(day: Date, from?: Date, to?: Date): boolean {
  if (!from) return false;
  if (!to) return isSameDay(day, from);
  return (
    isSameDay(day, from) ||
    isSameDay(day, to) ||
    (isAfter(day, from) && isBefore(day, to))
  );
}

export function PeriodCalendarCard({
  month = new Date(),
  from,
  to,
  className,
  onDaySelect,
}: PeriodCalendarCardProps) {
  const visibleMonth = startOfMonth(month);
  const firstDayOfWeek = visibleMonth.getDay();
  const daysInMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0,
  ).getDate();
  const today = new Date();

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-card p-4",
        "transition-colors hover:border-primary/40 hover:bg-primary/5",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tl from-primary/10 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{format(visibleMonth, "MMMM yyyy")}</p>
            <p className="text-xs text-muted-foreground">Período do dashboard</p>
          </div>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
            {from && to ? `${format(from, "MMM d")} - ${format(to, "MMM d")}` : "Personalizado"}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {dayNames.map((day) => (
            <div key={day} className="flex h-7 items-center justify-center">
              <span className="text-[10px] font-medium text-muted-foreground">{day}</span>
            </div>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-7" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), i + 1);
            const selected = isInRange(day, from, to);
            const endpoint = Boolean(from && (isSameDay(day, from) || (to && isSameDay(day, to))));
            const muted = !isSameMonth(day, visibleMonth);
            return (
              <button
                type="button"
                key={day.toISOString()}
                onClick={() => onDaySelect?.(day)}
                disabled={!onDaySelect}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition-colors",
                  selected && endpoint && "bg-primary text-primary-foreground shadow-sm",
                  selected && !endpoint && "bg-primary/15 text-primary",
                  !selected && "text-muted-foreground",
                  onDaySelect && !selected && "hover:bg-accent hover:text-foreground",
                  !onDaySelect && "cursor-default",
                  isSameDay(day, today) && !selected && "ring-1 ring-primary/50 text-foreground",
                  muted && "opacity-40",
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
