import { Clock, MapPin } from "lucide-react";

import { weekdayLabel, type ClassInfo } from "@/lib/derive";
import { initials } from "@/lib/format";
import { useClasses } from "@/lib/queries";
import { useImage } from "@/lib/use-image";
import { Avatar } from "./avatar";
import { SectionHeading } from "./shared";

/**
 * Foto da turma. `thumb` = quadrado arredondado (cartões e listas); `wide` = capa larga com fade para o fundo do
 * cartão (próxima aula da Home). Sem foto, ou se ela falhar ao carregar, aparece um bloco colorido com as iniciais
 * da turma (nunca uma imagem quebrada).
 */
export function ClassCover({
  name,
  src,
  variant = "thumb",
  className = "",
}: {
  name: string;
  src: string | null | undefined;
  variant?: "thumb" | "wide";
  className?: string;
}) {
  const photo = useImage(src);
  return (
    <div
      className={`cls-cover ${variant === "wide" ? "is-wide" : ""} ${photo.src ? "" : "is-fallback"} ${className}`.trim()}
      data-testid="class-cover"
      role="img"
      aria-label={photo.src ? `Foto da turma ${name}` : `Turma ${name}`}
    >
      {photo.src ? (
        <img src={photo.src} alt="" loading="lazy" onError={photo.onError} />
      ) : (
        <span className="cls-cover-ini" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </div>
  );
}

/** Unidade: miniatura redonda da foto (ou o pino, sem foto / foto quebrada) + nome. */
export function UnitLine({ unit }: { unit: ClassInfo["unit"] }) {
  const photo = useImage(unit?.photo);
  if (!unit) return null;
  return (
    <div className="detail-line unit-line" data-testid="unit-line">
      {photo.src ? <Avatar decorative name={unit.name} src={unit.photo} size={20} /> : <MapPin />}
      <span className="truncate">{unit.name}</span>
    </div>
  );
}

/** Professor: avatar redondo (foto ou iniciais) + nome. */
export function TeacherLine({ teacher }: { teacher: ClassInfo["teacher"] }) {
  if (!teacher) return null;
  return (
    <div className="teacher-line" data-testid="teacher-line">
      <Avatar decorative name={teacher.name} src={teacher.photo} size={26} />
      <span className="min-w-0">
        <small>Professor</small>
        <strong className="truncate">{teacher.name}</strong>
      </span>
    </div>
  );
}

/** "Minhas turmas": cada turma do aluno com foto, horário, unidade e professor (Frequência e Jornada). */
export function MyClasses() {
  const classes = useClasses();
  const list = classes.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="content-band" aria-label="Minhas turmas">
      <SectionHeading title="Minhas turmas" to="/aulas" label="Minhas aulas" />
      <ul className="my-classes">
        {list.map((item) => {
          const time = [item.startTime, item.endTime].filter(Boolean).join(" – ");
          const when = [item.weekday != null ? weekdayLabel(item.weekday) : "", time].filter(Boolean).join(" · ");
          return (
            <li key={item.id} className="my-class">
              <ClassCover name={item.name} src={item.photo} />
              <div className="min-w-0">
                <h3 className="break-words">{item.name}</h3>
                {when && (
                  <div className="detail-line">
                    <Clock />
                    {when}
                  </div>
                )}
                <UnitLine unit={item.unit ? { name: item.unit.name, photo: item.unit.photo ?? null } : null} />
                <TeacherLine teacher={item.teacher ? { name: item.teacher.name, photo: item.teacher.photo ?? null } : null} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
