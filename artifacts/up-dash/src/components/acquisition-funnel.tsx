import { displayLabel } from "@/lib/display-label";
import { ArrowDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/formatters";
export type AcquisitionStage = { label: string; value: number | null | undefined; currency?: boolean; connector?: string };
export function AcquisitionFunnel({ stages, title = "Funil de aquisição", description }: { stages: AcquisitionStage[]; title?: string; description?: string }) {
  return <Card data-testid="acquisition-funnel"><CardHeader><CardTitle>{title}</CardTitle>{description && <p className="text-xs text-muted-foreground">{description}</p>}</CardHeader><CardContent>
    <ol className="up-acquisition-funnel">{stages.map((stage,i) => <li key={stage.label}>
      <div className={`up-acquisition-stage ${i === 0 && stage.currency ? "is-investment" : ""}`} style={{ width: `${Math.max(46,100-i*13)}%` }}>
        <span>{displayLabel(stage.label)}</span><strong>{stage.value == null ? "—" : stage.currency ? formatCurrency(stage.value) : formatNumber(stage.value)}</strong>
      </div>
      {i < stages.length-1 && <p className="up-acquisition-connector"><ArrowDown className="h-3 w-3" />{stage.connector ?? "Sem taxa disponível"}</p>}
    </li>)}</ol>
  </CardContent></Card>;
}
