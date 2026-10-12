export function Brand({ withBadge = false, large = false }: { withBadge?: boolean; large?: boolean }) {
  return (
    <div className={`brand ${large ? "brand-lg" : ""}`}>
      <img src="/logo.png" alt="GingApp" width={1550} height={312} />
      {withBadge && (
        <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-sans text-[11px] font-semibold text-primary">
          Painel
        </span>
      )}
    </div>
  );
}
