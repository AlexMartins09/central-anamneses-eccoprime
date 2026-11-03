import { GraduationCap } from "lucide-react";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function Brand({ s, className, light }: { s: Pick<AppSettings, "brandName" | "brandTagline" | "logoUrl">; className?: string; light?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {s.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.logoUrl} alt={`Logotipo ${s.brandName}`} className="h-10 w-auto max-w-[160px] object-contain" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "grid size-10 place-items-center rounded-xl",
            light ? "bg-white/15 text-white" : "bg-primary text-primary-foreground",
          )}
        >
          <GraduationCap className="size-5" />
        </span>
      )}
      <span className="leading-tight">
        <span className={cn("block text-base font-bold", light ? "text-white" : "text-foreground")}>{s.brandName}</span>
        <span className={cn("block text-xs", light ? "text-white/80" : "text-muted-foreground")}>{s.brandTagline}</span>
      </span>
    </div>
  );
}
