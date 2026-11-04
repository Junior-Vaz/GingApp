import { useCountUp } from "@/lib/use-count-up";
import { cn } from "@/lib/utils";

/**
 * Número principal com contagem crescente leve (ver `useCountUp`). Durante a contagem o leitor de tela lê só o valor final
 * (texto `sr-only`) e o número animado fica `aria-hidden`; depois (e sem animação: reduced-motion, sem IntersectionObserver)
 * é um único texto simples.
 */
export function CountUp({ value, suffix = "", id, className }: { value: number; suffix?: string; id?: string; className?: string }) {
  const { value: shown, ref } = useCountUp(value, { id });
  const final = `${value}${suffix}`;
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {shown === value ? (
        final
      ) : (
        <>
          <span className="sr-only">{final}</span>
          <span aria-hidden="true">{`${shown}${suffix}`}</span>
        </>
      )}
    </span>
  );
}
