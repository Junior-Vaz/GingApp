export function Brand({ withBadge = false }: { withBadge?: boolean }) {
  return (
    <div className="brand">
      <img src="/logo.png" alt="GingApp" className="h-8 w-auto object-contain" />
      {withBadge && (
        <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-sans text-[11px] font-semibold text-primary">
          Painel
        </span>
      )}
    </div>
  );
}
