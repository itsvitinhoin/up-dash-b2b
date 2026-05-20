import {
  differenceInDays,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { Calendar as CalendarIcon, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
  const activePreset = getMatchingPreset(value);
  const isCustomActive = customMode || !activePreset;
  const label = getRangeLabel(value);
  const selectedDays = Math.max(1, differenceInDays(value.to, value.from) + 1);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
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
        className="flex w-[min(calc(100vw-2rem),760px)] flex-col p-0 md:flex-row"
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
            onClick={() => setCustomMode(true)}
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
        <div className="grid flex-1 gap-3 p-3 lg:grid-cols-[220px_1fr]">
          <PeriodCalendarCard
            className="hidden lg:block"
            month={value.from}
            from={value.from}
            to={value.to}
          />
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <div>
                <p className="text-sm font-medium">Período personalizado</p>
                <p className="text-xs text-muted-foreground">
                  {selectedDays} dia{selectedDays === 1 ? "" : "s"} selecionado{selectedDays === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={value?.from}
              selected={{ from: value?.from, to: value?.to }}
              onSelect={(range) => {
                if (range?.from && range?.to) {
                  setCustomMode(true);
                  onChange({ from: startOfDay(range.from), to: startOfDay(range.to) });
                  setIsOpen(false);
                }
              }}
              numberOfMonths={2}
              className="max-w-full overflow-x-auto"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
