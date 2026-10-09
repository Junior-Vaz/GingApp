import * as React from "react";
import { cn } from "@/lib/utils";

/** `<select>` nativo com o visual do Input (simples, acessível e testável; evita Radix Select em formulários curtos). */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";
