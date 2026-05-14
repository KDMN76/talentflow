import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: number;
  iconColor?: string;
  iconBg?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  iconColor = "text-indigo-600",
  iconBg = "bg-indigo-50 dark:bg-indigo-950/50",
}: StatsCardProps) {
  const TrendIcon =
    trend === undefined || trend === 0
      ? Minus
      : trend > 0
      ? TrendingUp
      : TrendingDown;

  const trendColor =
    trend === undefined || trend === 0
      ? "text-muted-foreground"
      : trend > 0
      ? "text-emerald-600"
      : "text-red-500";

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {value}
            </p>
            {(description || trend !== undefined) && (
              <div className="mt-2 flex items-center gap-1.5">
                {trend !== undefined && (
                  <div className={cn("flex items-center gap-0.5", trendColor)}>
                    <TrendIcon className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">
                      {trend > 0 ? "+" : ""}
                      {trend}
                    </span>
                  </div>
                )}
                {description && (
                  <p className="text-xs text-muted-foreground">{description}</p>
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
              iconBg
            )}
          >
            <Icon className={cn("h-6 w-6", iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
