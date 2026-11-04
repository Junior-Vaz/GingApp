import { cn } from "@/lib/utils";

/** Esqueleto com brilho que corre (translateX num pseudo-elemento, ver `.skeleton-shimmer` em styles.css; desligado por prefers-reduced-motion). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton-shimmer rounded-md bg-primary/10", className)} {...props} />;
}

export { Skeleton };
