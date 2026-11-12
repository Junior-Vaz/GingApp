import { useId, type SVGProps } from "react";

/** Ícones SVG próprios do telão (traço consistente, `currentColor`, decorativos: sempre `aria-hidden`). */

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
  ...props,
});

export const TrophyIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0V4Z" />
    <path d="M8 6H5.5a1 1 0 0 0-1 1c0 2.2 1.5 3.7 3.7 4M16 6h2.5a1 1 0 0 1 1 1c0 2.2-1.5 3.7-3.7 4" />
    <path d="M12 14v3.5M8.5 20h7M9.5 17.5h5V20h-5z" />
  </svg>
);

export const CrownIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m3.5 8 4.2 4L12 5l4.3 7 4.2-4-1.7 10H5.2L3.5 8Z" />
    <path d="M6 21h12" />
  </svg>
);

export const ClockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** Tatame: o quadrado externo com o miolo de luta (a marca de um tatame visto de cima). */
export const MatIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <rect x="8" y="8" width="8" height="8" rx="1.5" />
  </svg>
);

export const ExpandIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const CompressIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
);

export const QrIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
    <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
    <path d="M14.5 14.5h2.5v2.5h-2.5zM19 14.5h1.5M14.5 19h1.5M18 18h2.5v2.5" />
  </svg>
);

export const PlayIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...base({ strokeWidth: 3.2, ...props })}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const WifiOffIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 3-2M19 12.5a10 10 0 0 0-6.5-3M2 9a15 15 0 0 1 4-2.6M22 9a15 15 0 0 0-8.5-3.8" />
    <circle cx="12" cy="19.5" r="1" fill="currentColor" />
  </svg>
);

export const BracketIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3 5h5v4H3zM3 15h5v4H3zM16 10h5v4h-5z" />
    <path d="M8 7h3v10H8M11 12h5" />
  </svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </svg>
);

/** Marca discreta do GingApp (monograma "G" em arco com a "ginga" — o balanço — na ponta). */
export function LogoMark({ size = 28, ...props }: IconProps & { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" {...props}>
      <rect width="32" height="32" rx="9" fill="currentColor" opacity=".16" />
      <path d="M22.5 11.2A8 8 0 1 0 24 17h-7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.2" cy="11.6" r="2" fill="currentColor" />
    </svg>
  );
}

const MEDAL = {
  1: { top: "#fff0a8", mid: "#f5c542", low: "#b8860b", ribbon: "#16a34a" },
  2: { top: "#ffffff", mid: "#cbd5e1", low: "#7c8aa0", ribbon: "#3b82f6" },
  3: { top: "#f7c79a", mid: "#d08a4c", low: "#8a4b1f", ribbon: "#b45309" },
} as const;

/** Medalha em SVG: ouro, prata ou bronze (com o número, para nunca depender só da cor). */
export function MedalIcon({ place, size = 40, ...props }: IconProps & { place: 1 | 2 | 3; size?: number }) {
  const id = useId();
  const c = MEDAL[place];
  return (
    <svg viewBox="0 0 40 48" width={size} height={(size * 48) / 40} aria-hidden="true" focusable="false" {...props}>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={c.top} />
          <stop offset=".55" stopColor={c.mid} />
          <stop offset="1" stopColor={c.low} />
        </radialGradient>
      </defs>
      <path d="M10 2h8l4 14h-9L10 2Z" fill={c.ribbon} />
      <path d="M30 2h-8l-4 14h9L30 2Z" fill={c.ribbon} opacity=".72" />
      <circle cx="20" cy="31" r="14" fill={`url(#${id}-g)`} stroke={c.low} strokeWidth="1.4" />
      <circle cx="20" cy="31" r="10.2" fill="none" stroke={c.low} strokeOpacity=".45" strokeWidth="1" />
      <text x="20" y="36.5" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="inherit" fill={c.low}>
        {place}
      </text>
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const CloseIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ShareIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="6.5" cy="12" r="2.4" />
    <circle cx="17.5" cy="6" r="2.4" />
    <circle cx="17.5" cy="18" r="2.4" />
    <path d="m8.6 10.8 6.8-3.6M8.6 13.2l6.8 3.6" />
  </svg>
);

export const PlusIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MinusIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 12h14" />
  </svg>
);

/** Ajustar à largura: setas para as duas bordas. */
export const FitIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 5v14M20 5v14M8 12h8M8 12l2.5-2.5M8 12l2.5 2.5M16 12l-2.5-2.5M16 12l-2.5 2.5" />
  </svg>
);

/** Mira: ir até a luta. */
export const TargetIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </svg>
);
