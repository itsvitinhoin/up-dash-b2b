import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function UpManagerCardLoader({ label, cards = 2, graph = false }: { label: string; cards?: number; graph?: boolean }) {
  return <div role="status" aria-label={label} className={graph ? "grid gap-3 lg:grid-cols-[1.2fr_1fr]" : "grid gap-3 sm:grid-cols-2"}>
    {Array.from({ length: cards }, (_, index) => (
      <Card key={index} className="min-w-0 space-y-3 rounded-xl p-4">
        <Skeleton className="h-3.5 w-28" />
        {graph && index === 0 ? <Skeleton className="h-56 w-full rounded-xl" /> : (
          <><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /><Skeleton className="h-8 w-24 rounded-lg" /></>
        )}
      </Card>
    ))}
  </div>;
}
