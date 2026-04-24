import { differenceInDays, format, subDays, startOfYear, isSameDay } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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

const presets = [
  { label: "Last 7 days", getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: "Last 14 days", getRange: () => ({ from: subDays(new Date(), 14), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "Last 90 days", getRange: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
  { label: "Year to date", getRange: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

function getRangeLabel(range: DateRange): string {
  const today = new Date();
  if (isSameDay(range.to, today)) {
    const days = differenceInDays(today, range.from);
    if (days === 7) return "Last 7 days";
    if (days === 14) return "Last 14 days";
    if (days === 30) return "Last 30 days";
    if (days === 90) return "Last 90 days";
    if (isSameDay(range.from, startOfYear(today))) return "Year to date";
  }
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const label = getRangeLabel(value);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-testid="date-range-trigger"
          className={cn(
            "h-9 gap-2 rounded-md bg-card hover:bg-accent border-border font-normal",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 flex" align="end">
        <div className="border-r border-border p-2 w-[140px] space-y-0.5">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                onChange(preset.getRange());
                setIsOpen(false);
              }}
              className="w-full text-left text-sm px-3 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={value?.from}
          selected={{ from: value?.from, to: value?.to }}
          onSelect={(range) => {
            // Only commit when a complete range is selected so we don't
            // trigger redundant fetches on the partial first click.
            if (range?.from && range?.to) {
              onChange({ from: range.from, to: range.to });
              setIsOpen(false);
            }
          }}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
