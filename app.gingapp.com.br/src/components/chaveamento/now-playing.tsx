import { selectNowPlaying, type QueueEntry } from "@/lib/chaveamento/selectors";
import type { PublicCompetitor, PublicSnapshot } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { ClockIcon, MatIcon } from "./icons";

function Side({ competitor, size, align }: { competitor: PublicCompetitor | null; size: number; align: "left" | "right" }) {
  if (!competitor) return <div className="cv-face-side" data-align={align} />;
  const sub = [competitor.group, competitor.graduation].filter(Boolean).join(" · ");
  return (
    <div className="cv-face-side" data-align={align}>
      <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} group={competitor.group} size={size} />
      <span className="cv-face-text">
        <span className="cv-face-name">{competitor.name}</span>
        {sub !== "" && <span className="cv-face-sub">{sub}</span>}
      </span>
    </div>
  );
}

function LiveFace({ entry, tv }: { entry: QueueEntry; tv: boolean }) {
  const { match } = entry;
  const size = tv ? 64 : 56;
  const score = match.scoreA !== null && match.scoreB !== null ? `${match.scoreA} x ${match.scoreB}` : null;
  return (
    <li className="cv-face" data-testid="cv-now-live">
      <p className="cv-face-title">
        <span className="cv-live-badge">
          <span className="cv-dot" aria-hidden="true" />
          AO VIVO
        </span>
        <strong>AGORA</strong>
        {match.mat ? (
          <span className="cv-face-mat">
            <MatIcon aria-hidden="true" /> no tatame {match.mat}
          </span>
        ) : null}
        <span className="cv-face-cat">
          {entry.stageLabel} · {entry.categoryName}
        </span>
      </p>
      <div className="cv-face-row">
        <Side competitor={entry.a} size={size} align="right" />
        <span className="cv-vs" aria-label="contra">
          {score ?? "VS"}
        </span>
        <Side competitor={entry.b} size={size} align="left" />
      </div>
    </li>
  );
}

function NextItem({ entry, index }: { entry: QueueEntry; index: number }) {
  const { match } = entry;
  return (
    <li className="cv-next-item" data-testid="cv-now-next" data-first={index === 0 ? "1" : undefined}>
      <span className="cv-next-avatars">
        {entry.a && <Avatar id={entry.a.id} name={entry.a.name} photoUrl={entry.a.photoUrl} group={entry.a.group} size={38} />}
        {entry.b && <Avatar id={entry.b.id} name={entry.b.name} photoUrl={entry.b.photoUrl} group={entry.b.group} size={38} className="cv-overlap" />}
      </span>
      <span className="cv-next-text">
        <span className="cv-next-names">
          {entry.a?.name ?? "A definir"} <span aria-hidden="true">×</span>
          <span className="sr-only"> contra </span> {entry.b?.name ?? "A definir"}
        </span>
        <span className="cv-next-meta">
          {entry.categoryName}
          {match.mat ? ` · Tatame ${match.mat}` : ""}
        </span>
      </span>
    </li>
  );
}

/** Faixa "AGORA no tatame N" (avatares grandes dos dois lados) e "PRÓXIMAS" (ordem de chamada da equipe). */
export function NowPlaying({ snapshot, tv }: { snapshot: PublicSnapshot; tv: boolean }) {
  const { live, next } = selectNowPlaying(snapshot, tv ? 2 : 4);
  if (live.length === 0 && next.length === 0) return null;
  return (
    <section className="cv-now" aria-label="Lutas agora e próximas" data-tv={tv ? "1" : undefined} data-solo={live.length === 0 ? "1" : undefined}>
      {live.length > 0 && (
        <ul className="cv-live-list" data-count={Math.min(live.length, 3)}>
          {live.slice(0, tv ? 3 : 6).map((entry) => (
            <LiveFace key={entry.match.id} entry={entry} tv={tv} />
          ))}
        </ul>
      )}
      {next.length > 0 && (
        <div className="cv-next">
          <h2 className="cv-next-title">
            <ClockIcon aria-hidden="true" /> PRÓXIMAS
          </h2>
          <ul className="cv-next-list">
            {next.map((entry, index) => (
              <NextItem key={entry.match.id} entry={entry} index={index} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
