export function Brand({ withBadge = false }: { withBadge?: boolean }) {
  return (
    <div className="brand">
      <img src="/favicon.png" alt="" width="30" height="30" />
      <span>
        gingapp<span className="brand-dot">.</span>
      </span>
      {withBadge && (
        <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-sans text-[11px] font-semibold text-primary">
          Painel
        </span>
      )}
    </div>
  );
}
