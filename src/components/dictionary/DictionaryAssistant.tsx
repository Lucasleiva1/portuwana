import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../logging/logger";
import { MicrophoneIcon } from "../icons";
import { buildDictionary, detectDictionarySources, DEFAULT_DEV_DICTIONARY_SOURCE_PATH, listenToDictionaryBuild } from "../../dictionary/importer";
import { DictionaryService } from "../../dictionary/DictionaryService";
import type {
  DictionaryBuildProgress,
  DictionaryBuildReport,
  DictionaryDirection,
  DictionaryFavorite,
  DictionaryHistoryItem,
  DictionaryUiState,
  SourceDetectionReport,
  TranslationOutcome,
} from "../../dictionary/dictionary.types";
import "./dictionary.css";

type AssistantCharacter = "female" | "male";
type AssistantExpression = "neutral" | "blink" | "question" | "laugh";
type AssistantTab = "translate" | "history" | "favorites" | "sources";
export type DictionaryVoiceState = "idle" | "listening" | "recording" | "transcribing";

export interface ContextualDictionaryRequest {
  id: number;
  term: string;
}

interface DictionaryAssistantProps {
  contextualRequest: ContextualDictionaryRequest | null;
  initialCharacter?: AssistantCharacter | undefined;
  initialSourcePath?: string | null | undefined;
  onCharacterChange?: ((character: AssistantCharacter) => void) | undefined;
  onSourcePathChange?: ((path: string) => void) | undefined;
  onVoiceInput?: ((
    direction: DictionaryDirection,
    onStateChange: (state: DictionaryVoiceState) => void,
  ) => Promise<string>) | undefined;
  onCancelVoiceInput?: (() => void) | undefined;
}

const service = new DictionaryService();

const directionLabels: Record<DictionaryDirection, string> = {
  auto: "Auto",
  "es-pt": "Español → Português",
  "pt-es": "Português → Español",
};

const partOfSpeechLabels: Record<string, string> = {
  noun: "sustantivo",
  adjective: "adjetivo",
  verb: "verbo",
  adverb: "adverbio",
  expression: "expresión",
  interjection: "interjección",
  pronoun: "pronombre",
  determiner: "determinante",
  preposition: "preposición",
  conjunction: "conjunción",
  article: "artículo",
  "proper noun": "nombre propio",
};

export function DictionaryAssistant({
  contextualRequest,
  initialCharacter = "female",
  initialSourcePath,
  onCharacterChange,
  onSourcePathChange,
  onVoiceInput,
  onCancelVoiceInput,
}: DictionaryAssistantProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AssistantTab>("translate");
  const [direction, setDirection] = useState<DictionaryDirection>("auto");
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [uiState, setUiState] = useState<DictionaryUiState>("idle");
  const [outcome, setOutcome] = useState<TranslationOutcome | null>(null);
  const [message, setMessage] = useState("¿Qué querés traducir hoy?");
  const [character, setCharacter] =
    useState<AssistantCharacter>(initialCharacter);
  const [expression, setExpression] =
    useState<AssistantExpression>("neutral");
  const [favorite, setFavorite] = useState(false);
  const [history, setHistory] = useState<readonly DictionaryHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<readonly DictionaryFavorite[]>([]);
  const [availability, setAvailability] = useState({
    sqliteReady: false,
    starterReady: true,
    externalBuildReady: false,
  });
  const [sourcePath, setSourcePath] = useState(
    initialSourcePath || DEFAULT_DEV_DICTIONARY_SOURCE_PATH,
  );
  const [detection, setDetection] = useState<SourceDetectionReport | null>(null);
  const [buildProgress, setBuildProgress] =
    useState<DictionaryBuildProgress | null>(null);
  const [buildReport, setBuildReport] =
    useState<DictionaryBuildReport | null>(null);
  const [building, setBuilding] = useState(false);
  const [voiceState, setVoiceState] = useState<DictionaryVoiceState>("idle");
  const expressionTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handledContextualRequestRef = useRef<number | null>(null);

  const setTemporaryExpression = useCallback(
    (next: AssistantExpression, duration = 900) => {
      if (expressionTimerRef.current !== null) {
        window.clearTimeout(expressionTimerRef.current);
      }
      setExpression(next);
      expressionTimerRef.current = window.setTimeout(() => {
        setExpression("neutral");
        expressionTimerRef.current = null;
      }, duration);
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    void service
      .initialize()
      .then((next) => {
        if (disposed) {
          return;
        }
        setAvailability(next);
        setUiState(next.externalBuildReady ? "idle" : "dictionaryNotBuilt");
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : "No pude iniciar SQLite.";
        setUiState("error");
        setMessage("No pude iniciar el diccionario local. Probá buscar nuevamente.");
        setTemporaryExpression("question", 1_350);
        void logger.error("dictionary.initialize.error", { message: errorMessage });
      });
    return () => {
      disposed = true;
    };
  }, [setTemporaryExpression]);

  useEffect(() => {
    setCharacter(initialCharacter);
  }, [initialCharacter]);

  useEffect(() => {
    if (initialSourcePath) {
      setSourcePath(initialSourcePath);
    }
  }, [initialSourcePath]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setExpression((current) => {
        if (current !== "neutral") {
          return current;
        }
        window.setTimeout(() => {
          setExpression((latest) => (latest === "blink" ? "neutral" : latest));
        }, 170);
        return "blink";
      });
    }, 4_600);
    return () => {
      window.clearInterval(interval);
      if (expressionTimerRef.current !== null) {
        window.clearTimeout(expressionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToDictionaryBuild((progress) => {
      if (!disposed) {
        setBuildProgress(progress);
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const submitTranslation = useCallback(
    async (
      requestedText?: string,
      requestedDirection: DictionaryDirection = direction,
    ) => {
      const text = (requestedText ?? input).trim();
      if (!text || uiState === "searching") {
        return;
      }
      setOpen(true);
      setTab("translate");
      setLastQuestion(text);
      setInput(text);
      setOutcome(null);
      setFavorite(false);
      setUiState("searching");
      setMessage("Dejame pensar un segundo…");
      setExpression("question");
      try {
        const nextOutcome = await service.translate(text, requestedDirection);
        setOutcome(nextOutcome);
        if (nextOutcome.translatedText && nextOutcome.unresolvedTerms.length < 2) {
          setUiState("results");
          setMessage(
            nextOutcome.approximate
              ? "Te doy una versión orientativa y bien local."
              : "¡La encontré! Mirá cómo se dice.",
          );
          setTemporaryExpression("laugh", 1_250);
          if (nextOutcome.primaryResult) {
            setFavorite(await service.isFavorite(nextOutcome.primaryResult));
          }
        } else {
          setUiState("noResults");
          setMessage("Esa me hizo pensar. Probá con otra forma o cambiá la dirección.");
          setTemporaryExpression("question", 1_350);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "No pude consultar el diccionario.";
        setUiState("error");
        setMessage("Uy, algo falló en la consulta local.");
        setTemporaryExpression("question", 1_350);
        void logger.error("dictionary.search.error", { message: errorMessage });
      }
    },
    [direction, input, setTemporaryExpression, uiState],
  );

  useEffect(() => {
    if (
      !contextualRequest ||
      handledContextualRequestRef.current === contextualRequest.id
    ) {
      return;
    }
    handledContextualRequestRef.current = contextualRequest.id;
    setOpen(true);
    setTab("translate");
    setInput(contextualRequest.term);
    setMessage(`¿Querés saber qué significa “${contextualRequest.term}”?`);
    setTemporaryExpression("question", 1_000);
    const timer = window.setTimeout(() => {
      void submitTranslation(contextualRequest.term);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [contextualRequest, setTemporaryExpression, submitTranslation]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 160);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (tab === "history") {
      void service.getHistory().then(setHistory);
    } else if (tab === "favorites") {
      void service.getFavorites().then(setFavorites);
    }
  }, [tab]);

  const avatarSource = useMemo(
    () =>
      `/assets/dictionary/assistants/dictionary-assistant-${character}-${expression}-v1.png`,
    [character, expression],
  );
  const assistantName = character === "female" ? "Lía" : "Téo";

  const toggleCharacter = () => {
    const next = character === "female" ? "male" : "female";
    setCharacter(next);
    onCharacterChange?.(next);
    setMessage(
      next === "female"
        ? "Soy Lía. ¿Buscamos una palabra?"
        : "Soy Téo. ¿Te traduzco algo?",
    );
    setTemporaryExpression("laugh", 900);
  };

  const toggleFavorite = async () => {
    if (!outcome?.primaryResult) {
      return;
    }
    setFavorite(await service.toggleFavorite(outcome.primaryResult));
  };

  const toggleVoiceInput = async () => {
    if (voiceState !== "idle") {
      onCancelVoiceInput?.();
      setVoiceState("idle");
      setMessage("Escucha cancelada. Podés escribir o probar de nuevo.");
      return;
    }
    if (!onVoiceInput) {
      setUiState("error");
      setMessage("El micrófono no está disponible en esta versión.");
      return;
    }
    setOpen(true);
    setTab("translate");
    setOutcome(null);
    setUiState("idle");
    setVoiceState("listening");
    setMessage("Te escucho… decí una palabra o una frase.");
    setExpression("question");
    try {
      const transcript = (await onVoiceInput(direction, (state) => {
        setVoiceState(state);
        if (state === "recording") {
          setMessage("Te estoy escuchando…");
        } else if (state === "transcribing") {
          setMessage("Pasando tu voz a texto…");
        }
      })).trim();
      setVoiceState("idle");
      setInput(transcript);
      setMessage(`Escuché “${transcript}”. Buscando la traducción…`);
      await submitTranslation(transcript);
    } catch (error) {
      setVoiceState("idle");
      const reason = error instanceof Error ? error.message : "voice-failed";
      if (reason === "voice-cancelled") {
        return;
      }
      setUiState("error");
      setMessage(
        reason === "no-speech"
          ? "No llegué a escuchar una palabra. Probá otra vez o escribila."
          : "No pude transcribir la voz. Podés seguir escribiendo normalmente.",
      );
      setTemporaryExpression("question", 1_350);
      void logger.warn("dictionary.voice.failed", { reason });
    }
  };

  const chooseRecent = (term: string, recentDirection: DictionaryDirection) => {
    setDirection(recentDirection);
    setInput(term);
    void submitTranslation(term, recentDirection);
  };

  const detectSources = async () => {
    setBuildReport(null);
    try {
      setDetection(await detectDictionarySources(sourcePath));
      onSourcePathChange?.(sourcePath);
    } catch (error) {
      setUiState("error");
      setMessage(error instanceof Error ? error.message : "No pude revisar esa carpeta.");
    }
  };

  const runBuild = async () => {
    setBuilding(true);
    setBuildReport(null);
    setBuildProgress({
      stage: "preparing",
      source: null,
      processed: 0,
      accepted: 0,
      errors: 0,
      elapsedMs: 0,
    });
    setMessage("Voy a ordenar todas esas palabras sin congelar la escena.");
    setExpression("question");
    try {
      const report = await buildDictionary(sourcePath);
      setBuildReport(report);
      setAvailability(await service.refreshAfterBuild());
      setUiState("idle");
      setMessage("¡Diccionario ampliado y listo para usar!");
      setTemporaryExpression("laugh", 1_500);
      await logger.info("dictionary.build.completed", {
        buildVersion: report.buildVersion,
        terms: report.termCount,
        translations: report.translationCount,
        errors: report.errorCount,
      });
    } catch (error) {
      setUiState("error");
      setMessage(error instanceof Error ? error.message : "No pude construir la base.");
      setTemporaryExpression("question", 1_500);
      await logger.error("dictionary.build.error", {
        message: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <aside className={`dictionary-assistant${open ? " is-open" : ""}`}>
      {open && (
        <section className="dictionary-bubble" aria-label="Diccionario y traductor" aria-live="polite">
          <header className="dictionary-bubble__header">
            <div>
              <span className="dictionary-bubble__eyebrow">ASISTENTE OFFLINE · {assistantName}</span>
              <strong>Diccionario ES ↔ PT-BR</strong>
            </div>
            <div className="dictionary-bubble__header-actions">
              <button type="button" onClick={toggleCharacter} title="Cambiar asistente">
                {character === "female" ? "Ver a Téo" : "Ver a Lía"}
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar diccionario">
                ×
              </button>
            </div>
          </header>

          <p className="dictionary-bubble__speech">{message}</p>

          <nav className="dictionary-tabs" aria-label="Secciones del diccionario">
            {([
              ["translate", "Traducir"],
              ["history", "Recientes"],
              ["favorites", "Favoritos"],
              ...(import.meta.env.DEV ? ([["sources", "Fuentes"]] as const) : []),
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? "is-active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === "translate" && (
            <div className="dictionary-translate">
              {!availability.externalBuildReady && (
                <div className="dictionary-build-note">
                  Diccionario esencial listo. En DEV podés sumar las fuentes completas.
                </div>
              )}
              <div className="dictionary-direction" role="group" aria-label="Dirección de traducción">
                {(Object.keys(directionLabels) as DictionaryDirection[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={direction === id ? "is-active" : ""}
                    onClick={() => setDirection(id)}
                  >
                    {directionLabels[id]}
                  </button>
                ))}
              </div>

              <form
                className="dictionary-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitTranslation();
                }}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitTranslation();
                    }
                  }}
                  placeholder="Escribí una palabra, frase o varias líneas…"
                  rows={3}
                  maxLength={1_200}
                />
                <div>
                  <small>Todo se procesa en tu equipo.</small>
                  <div className="dictionary-composer__actions">
                    <button
                      type="button"
                      className={`dictionary-voice-button is-${voiceState}`}
                      onClick={() => void toggleVoiceInput()}
                      aria-pressed={voiceState !== "idle"}
                      aria-label={voiceState === "idle" ? "Hablar para traducir" : "Cancelar escucha"}
                      title={voiceState === "idle" ? "Decir una palabra o frase" : "Cancelar"}
                    >
                      <MicrophoneIcon size={15} />
                      <span>
                        {voiceState === "idle"
                          ? "Hablar"
                          : voiceState === "transcribing"
                            ? "Entendiendo…"
                            : "Escuchando…"}
                      </span>
                    </button>
                    <button
                      type="submit"
                      disabled={!input.trim() || uiState === "searching" || voiceState !== "idle"}
                    >
                      {uiState === "searching" ? "Pensando…" : "Traducir"}
                    </button>
                  </div>
                </div>
              </form>

              {lastQuestion && (
                <div className="dictionary-chat" data-state={uiState}>
                  <p className="dictionary-chat__user">{lastQuestion}</p>
                  {uiState === "searching" && (
                    <p className="dictionary-chat__thinking"><span /><span /><span /></p>
                  )}
                  {outcome && uiState === "results" && (
                    <article className="dictionary-result">
                      <div className="dictionary-result__heading">
                        <div>
                          <small>{outcome.direction === "es-pt" ? "PORTUGUÊS" : "ESPAÑOL"}</small>
                          <strong>{outcome.translatedText}</strong>
                        </div>
                        {outcome.primaryResult && (
                          <button
                            type="button"
                            className={favorite ? "is-favorite" : ""}
                            onClick={() => void toggleFavorite()}
                            aria-label={favorite ? "Quitar de favoritos" : "Guardar favorito"}
                            title={favorite ? "Guardado" : "Guardar"}
                          >
                            {favorite ? "★" : "☆"}
                          </button>
                        )}
                      </div>
                      {outcome.primaryResult?.partOfSpeech && (
                        <span className="dictionary-result__category">
                          {partOfSpeechLabels[outcome.primaryResult.partOfSpeech] ?? outcome.primaryResult.partOfSpeech}
                        </span>
                      )}
                      {outcome.primaryResult?.definition && (
                        <p className="dictionary-result__definition">{outcome.primaryResult.definition}</p>
                      )}
                      {(outcome.primaryResult?.translations.length ?? 0) > 1 && (
                        <div className="dictionary-result__alternatives">
                          <small>ALTERNATIVAS</small>
                          <div>
                            {outcome.primaryResult?.translations.slice(1, 5).map((translation) => (
                              <span key={`${translation.term}-${translation.context}`} title={translation.context}>
                                {translation.term}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {outcome.approximate && (
                        <p className="dictionary-result__notice">
                          Traducción orientativa por frase. Revisá el contexto si es una letra o texto largo.
                        </p>
                      )}
                      {outcome.unresolvedTerms.length > 0 && (
                        <p className="dictionary-result__notice">
                          Conservé sin cambiar: {outcome.unresolvedTerms.join(", ")}.
                        </p>
                      )}
                    </article>
                  )}
                  {uiState === "noResults" && (
                    <p className="dictionary-chat__empty">No encontré una coincidencia local segura.</p>
                  )}
                  {uiState === "error" && (
                    <p className="dictionary-chat__empty">La consulta falló, pero la conversación sigue intacta.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="dictionary-list">
              {history.length === 0 ? (
                <p>Tus búsquedas recientes van a aparecer acá.</p>
              ) : (
                history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseRecent(item.term, item.direction)}
                  >
                    <span>{item.term}</span>
                    <small>{item.chosenResult ?? directionLabels[item.direction]}</small>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === "favorites" && (
            <div className="dictionary-list">
              {favorites.length === 0 ? (
                <p>Guardá palabras con la estrella para volver rápido.</p>
              ) : (
                favorites.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseRecent(item.term, item.language === "es" ? "es-pt" : "pt-es")}
                  >
                    <span>★ {item.term}</span>
                    <small>{item.primaryTranslation}</small>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === "sources" && import.meta.env.DEV && (
            <div className="dictionary-sources">
              <label>
                Carpeta DEV de fuentes
                <input
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  onBlur={() => onSourcePathChange?.(sourcePath)}
                />
              </label>
              <div className="dictionary-sources__actions">
                <button type="button" onClick={() => void detectSources()} disabled={building}>
                  Detectar
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => void runBuild()}
                  disabled={building || detection?.sources.length === 0}
                >
                  {building ? "Construyendo…" : "Build Dictionary Database"}
                </button>
              </div>
              {detection && (
                <div className="dictionary-sources__report">
                  <strong>
                    {detection.exists
                      ? `${detection.sources.length} fuentes detectadas`
                      : "Fuentes no encontradas"}
                  </strong>
                  {detection.sources.map((source) => (
                    <span key={source.sourceKey}>
                      ✓ {source.displayName} · {source.format}
                    </span>
                  ))}
                  {detection.missingFamilies.map((family) => (
                    <span key={family} className="is-missing">— Falta {family}</span>
                  ))}
                </div>
              )}
              {buildProgress && (
                <div className="dictionary-build-progress">
                  <span>{buildProgress.source ?? buildProgress.stage}</span>
                  <strong>{buildProgress.accepted.toLocaleString("es-AR")} aceptadas</strong>
                  <small>
                    {Math.round(buildProgress.elapsedMs / 1000)} s · {buildProgress.errors} errores
                  </small>
                </div>
              )}
              {buildReport && (
                <div className="dictionary-sources__summary">
                  <strong>{buildReport.termCount.toLocaleString("es-AR")} términos</strong>
                  <span>{buildReport.translationCount.toLocaleString("es-AR")} traducciones</span>
                  <span>{(buildReport.databaseSizeBytes / 1_048_576).toFixed(1)} MB · {buildReport.ftsEnabled ? "FTS5" : "índice fallback"}</span>
                </div>
              )}
            </div>
          )}

          <span className="dictionary-bubble__tail" aria-hidden="true" />
        </section>
      )}

      <button
        type="button"
        className={`dictionary-mascot is-${expression}`}
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) {
            setMessage(`Soy ${assistantName}. ¿Qué querés traducir?`);
            setTemporaryExpression("question", 1_000);
          }
        }}
        aria-expanded={open}
        aria-label={open ? "Cerrar diccionario" : `Abrir diccionario con ${assistantName}`}
      >
        <span className="dictionary-mascot__halo" aria-hidden="true" />
        <img src={avatarSource} alt="" draggable={false} />
        <span className="dictionary-mascot__label">
          <strong>{assistantName}</strong>
          <small>diccionario</small>
        </span>
      </button>
    </aside>
  );
}
