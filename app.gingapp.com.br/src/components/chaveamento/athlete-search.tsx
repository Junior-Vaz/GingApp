import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { athleteStateLabel, MAX_QUERY_LENGTH, sanitizeQuery, SEARCH_STORAGE_KEY, searchAthletes, type AthleteHit } from "@/lib/chaveamento/athlete-search";
import type { PublicSnapshot } from "@/lib/chaveamento/types";
import { CloseIcon, MatIcon, SearchIcon, TargetIcon } from "./icons";

/** O que ficou lembrado na SESSÃO do navegador: só o texto digitado (nenhum dado de atleta). Tudo em try/catch. */
function readRemembered(): string {
  try {
    return sanitizeQuery(window.sessionStorage.getItem(SEARCH_STORAGE_KEY));
  } catch {
    return "";
  }
}

function remember(text: string): void {
  try {
    if (text === "") window.sessionStorage.removeItem(SEARCH_STORAGE_KEY);
    else window.sessionStorage.setItem(SEARCH_STORAGE_KEY, text);
  } catch {
    /* sessão bloqueada (modo privado): a busca funciona igual, só não é lembrada */
  }
}

/** Texto digitado: sem controles/`<>`, até 60 caracteres, mas sem cortar espaços (o usuário ainda está digitando). */
// eslint-disable-next-line no-control-regex
const cleanTyping = (text: string): string => Array.from(text.replace(/[\u{0}-\u{1f}\u{7f}-\u{9f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}<>]/gu, "").replace(/\s{2,}/g, " ")).slice(0, MAX_QUERY_LENGTH).join("");

export interface FocusedAthlete {
  categoryId: number;
  competitorId: number;
}

export interface AthleteSearchProps {
  snapshot: PublicSnapshot;
  /** `?q=` da URL (já limpo): tem prioridade sobre o que a sessão lembra e, achando UM atleta, já o localiza. */
  initialQuery: string;
  /** Atleta em destaque (escolhido na lista, na chave ou por esta busca). */
  focus: FocusedAthlete | null;
  /** `scroll`: rolar até a luta dele. null = limpar o destaque. */
  onFocus: (hit: AthleteHit | null, scroll: boolean) => void;
}

/**
 * "Acompanhar meu atleta" (só fora do modo telão): campo compacto "Buscar atleta ou grupo" que localiza o atleta, rola até a
 * luta dele e destaca o caminho na chave; lembra o último texto buscado só nesta sessão; mostra a faixa "Minha próxima
 * luta" apenas quando o atleta tem luta ao vivo ou já definida. Sem notificação e sem dado inventado: tudo vem do snapshot.
 */
export function AthleteSearch({ snapshot, initialQuery, focus, onFocus }: AthleteSearchProps) {
  const urlQuery = sanitizeQuery(initialQuery); // o link vem de fora: só texto, mesmo que a rota já tenha limpado
  const fromUrl = urlQuery !== "";
  const [query, setQuery] = useState<string>(() => (fromUrl ? urlQuery : readRemembered()));
  const [open, setOpen] = useState<boolean>(fromUrl);
  const listId = useId();
  const autoDone = useRef(false);

  const hits = useMemo(() => searchAthletes(snapshot, query), [snapshot, query]);
  const trimmed = sanitizeQuery(query);
  const active = useMemo<AthleteHit | null>(() => {
    if (focus) return hits.find((h) => h.categoryId === focus.categoryId && h.competitor.id === focus.competitorId) ?? null;
    return hits.length === 1 ? hits[0]! : null;
  }, [hits, focus]);

  // `?q=` com UM atleta só: localiza e rola até ele (uma vez, no primeiro snapshot em que ele aparece).
  useEffect(() => {
    if (!fromUrl || autoDone.current || hits.length === 0) return;
    autoDone.current = true;
    if (hits.length === 1) {
      onFocus(hits[0]!, true);
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl, hits]);

  const change = (text: string): void => {
    const next = cleanTyping(text);
    if (focus) onFocus(null, false); // digitou outra coisa: o destaque anterior saiu de cena
    setQuery(next);
    setOpen(true);
    remember(sanitizeQuery(next));
  };
  const clear = (): void => {
    setQuery("");
    setOpen(false);
    remember("");
    onFocus(null, false);
  };
  const pick = (hit: AthleteHit): void => {
    onFocus(hit, true);
    setOpen(false);
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const first = hits[0];
    if (first) pick(first);
  };

  const showList = open && trimmed.length >= 2;
  const showStrip = active !== null && (active.state === "live" || active.state === "next");

  return (
    <section className="cv-search" aria-label="Acompanhar meu atleta" data-testid="cv-search">
      <form className="cv-search-form" role="search" onSubmit={submit}>
        <SearchIcon className="cv-search-icon" aria-hidden="true" />
        <input
          className="cv-search-input"
          type="search"
          name="busca"
          value={query}
          onChange={(event) => change(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Buscar atleta ou grupo"
          aria-label="Buscar atleta ou grupo"
          aria-controls={showList ? listId : undefined}
          maxLength={MAX_QUERY_LENGTH}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="cv-search-input"
        />
        {query !== "" && (
          <button type="button" className="cv-search-clear" onClick={clear} aria-label="Limpar a busca" data-testid="cv-search-clear">
            <CloseIcon aria-hidden="true" />
          </button>
        )}
      </form>
      {showList && (
        <div id={listId} className="cv-search-results" data-testid="cv-search-results">
          {hits.length === 0 ? (
            <p className="cv-search-empty">Nenhum atleta ou grupo encontrado.</p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={`${hit.categoryId}-${hit.competitor.id}`}>
                  <button type="button" className="cv-search-hit" onClick={() => pick(hit)} data-state={hit.state} data-testid="cv-search-hit">
                    <span className="cv-search-name">{hit.competitor.name}</span>
                    <span className="cv-search-sub">{[hit.competitor.group, hit.categoryName].filter(Boolean).join(" · ")}</span>
                    <span className="cv-search-state">
                      {hit.state === "live" && <span className="cv-dot" aria-hidden="true" />} {athleteStateLabel(hit)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showStrip && active && (
        <div className="cv-mynext" data-state={active.state} data-testid="cv-my-next">
          <span className="cv-mynext-text">
            <strong>{active.state === "live" ? "Minha luta está AO VIVO:" : "Minha próxima luta:"}</strong>{" "}
            <span className="cv-mynext-names">
              {active.competitor.name} <span aria-hidden="true">×</span>
              <span className="sr-only"> contra </span> {active.opponent?.name ?? "a definir"}
            </span>
            <span className="cv-mynext-meta">
              {[active.stageLabel, active.categoryName, active.match?.mat ? `Tatame ${active.match.mat}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <button type="button" className="cv-mynext-go" onClick={() => onFocus(active, true)} aria-label="Ir até a minha luta na chave" data-testid="cv-my-next-go">
            {active.match?.mat ? <MatIcon aria-hidden="true" /> : <TargetIcon aria-hidden="true" />}
            <span>Ver</span>
          </button>
        </div>
      )}
    </section>
  );
}
