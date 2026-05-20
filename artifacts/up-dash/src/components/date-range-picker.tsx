import {
  addMonths,
  differenceInDays,
  endOfMonth,
  endOfYear,
  format,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PeriodCalendarCard } from "@/components/ui/period-calendar-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";

export interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

interface DraftDateRange {
  from?: Date;
  to?: Date;
}

interface Preset {
  id: string;
  label: string;
  getRange: () => DateRange;
}

function today(): Date {
  return startOfDay(new Date());
}

const presets: Preset[] = [
  {
    id: "7d",
    label: "7 dias",
    getRange: () => {
      const to = today();
      return { from: subDays(to, 6), to };
    },
  },
  {
    id: "14d",
    label: "14 dias",
    getRange: () => {
      const to = today();
      return { from: subDays(to, 13), to };
    },
  },
  {
    id: "30d",
    label: "30 dias",
    getRange: () => {
      const to = today();
      return { from: subDays(to, 29), to };
    },
  },
  {
    id: "this-month",
    label: "Este mês",
    getRange: () => {
      const to = today();
      return { from: startOfMonth(to), to };
    },
  },
  {
    id: "last-month",
    label: "Mês passado",
    getRange: () => {
      const lastMonth = subMonths(today(), 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
  {
    id: "this-year",
    label: "Este Ano",
    getRange: () => {
      const to = today();
      return { from: startOfYear(to), to };
    },
  },
  {
    id: "last-year",
    label: "Ano passado",
    getRange: () => {
      const lastYear = subYears(today(), 1);
      return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
    },
  },
];

function getMatchingPreset(range: DateRange): Preset | null {
  return presets.find((preset) => {
    const presetRange = preset.getRange();
    return isSameDay(range.from, presetRange.from) && isSameDay(range.to, presetRange.to);
  }) ?? null;
}

function getRangeLabel(range: DateRange): string {
  const preset = getMatchingPreset(range);
  if (preset) return preset.label;

  if (isSameDay(range.from, range.to)) {
    return format(range.from, "MMM d, yyyy");
  }
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(value.from));
  const [draftRange, setDraftRange] = useState<DraftDateRange>(() => ({
    from: value.from,
    to: value.to,
  }));
  const activePreset = getMatchingPreset(value);
  const isCustomActive = customMode || !activePreset;
  const label = getRangeLabel(value);
  const selectedFrom = draftRange.from ?? value.from;
  const selectedTo = draftRange.to ?? draftRange.from ?? value.to;
  const selectedDays = Math.max(1, differenceInDays(selectedTo, selectedFrom) + 1);

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (open) {
      setVisibleMonth(startOfMonth(value.from));
      setDraftRange({ from: value.from, to: value.to });
    }
  }

  function handleCustomDaySelect(day: Date) {
    const picked = startOfDay(day);
    const currentFrom = draftRange.from;
    const currentTo = draftRange.to;

    if (!currentFrom || currentTo || isBefore(picked, currentFrom)) {
      setCustomMode(true);
      setDraftRange({ from: picked });
      return;
    }

    const nextRange = isAfter(picked, currentFrom)
      ? { from: currentFrom, to: picked }
      : { from: picked, to: currentFrom };

    setCustomMode(true);
    setDraftRange(nextRange);
    onChange(nextRange);
    setIsOpen(false);
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-testid="date-range-trigger"
          className={cn(
            "h-9 gap-2 rounded-md border-border bg-card font-normal hover:bg-accent",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-[min(calc(100vw-2rem),540px)] flex-col p-0 md:flex-row"
        align="end"
      >
        <div className="w-full border-b border-border p-2 md:w-[190px] md:border-b-0 md:border-r">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.label}
              onClick={() => {
                setCustomMode(false);
                onChange(preset.getRange());
                setIsOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                activePreset?.id === preset.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span>{preset.label}</span>
              {activePreset?.id === preset.id && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustomMode(true);
              setVisibleMonth(startOfMonth(value.from));
              setDraftRange({ from: value.from, to: value.to });
            }}
            className={cn(
              "mt-1 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
              isCustomActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span>Período personalizado</span>
            {isCustomActive && <Check className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="w-full p-3 md:w-[350px]">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <p className="text-sm font-medium">Período personalizado</p>
              <p className="text-xs text-muted-foreground">
                {draftRange.from && !draftRange.to
                  ? "Selecione a data final"
                  : `${selectedDays} dia${selectedDays === 1 ? "" : "s"} selecionado${selectedDays === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                aria-label="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                aria-label="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <PeriodCalendarCard
            className="mx-auto w-full max-w-[290px]"
            month={visibleMonth}
            from={draftRange.from}
            to={draftRange.to}
            onDaySelect={handleCustomDaySelect}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
