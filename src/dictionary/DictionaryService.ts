import type Database from "@tauri-apps/plugin-sql";
import { logger } from "../logging/logger";
import { initializeDatabase } from "../storage/database";
import type {
  DictionaryDirection,
  DictionaryFavorite,
  DictionaryHistoryItem,
  DictionaryLanguage,
  DictionaryResult,
  DictionaryTranslation,
  TranslationOutcome,
} from "./dictionary.types";
import {
  dictionarySearchKey,
  guessDictionaryDirection,
  languageForDirection,
  levenshteinDistance,
  normalizeDictionaryTerm,
  preserveSourceCapitalization,
} from "./normalize";
import { searchStarterLexicon, starterLexicon } from "./starterLexicon";
import { translatePhraseWithExactLookup } from "./phraseTranslator";

interface DictionaryRow {
  entryId: number;
  term: string;
  language: DictionaryLanguage;
  normalized: string;
  searchKey: string;
  partOfSpeech: string;
  definition: string | null;
  commonScore: number;
  variantMatch: number;
  translatedTerm: string;
  translatedLanguage: DictionaryLanguage;
  contextLabel: string;
  locale: string;
  sourcePriority: number;
  sources: string;
}

interface IdRow {
  id: number;
}

interface StarterSourceRow extends IdRow {
  status: string;
  processedCount: number;
  acceptedCount: number;
}

interface CountRow {
  count: number;
}

interface SqliteMasterRow {
  name: string;
}

interface HistoryRow {
  id: number;
  term: string;
  direction: DictionaryDirection;
  chosenResult: string | null;
  searchedAt: string;
}

interface FavoriteRow {
  id: number;
  term: string;
  language: DictionaryLanguage;
  primaryTranslation: string;
  createdAt: string;
}

const STARTER_LEXICON_VERSION = "1";
const STARTER_SOURCE_KEY = `portuwana-essential-v${STARTER_LEXICON_VERSION}`;

export interface DictionarySearchResponse {
  direction: Exclude<DictionaryDirection, "auto">;
  results: readonly DictionaryResult[];
}

export interface DictionaryAvailability {
  sqliteReady: boolean;
  starterReady: boolean;
  externalBuildReady: boolean;
}

export class DictionaryService {
  #database: Database | null = null;
  #ftsAvailable = false;
  #initialization: Promise<DictionaryAvailability> | null = null;

  initialize(): Promise<DictionaryAvailability> {
    if (!this.#initialization) {
      this.#initialization = this.#initialize().catch((error: unknown) => {
        this.#database = null;
        this.#ftsAvailable = false;
        this.#initialization = null;
        throw error;
      });
    }
    return this.#initialization;
  }

  async #initialize(): Promise<DictionaryAvailability> {
    const initialization = await initializeDatabase();
    if (initialization.status !== "ready") {
      return {
        sqliteReady: false,
        starterReady: true,
        externalBuildReady: false,
      };
    }
    this.#database = initialization.database;
    await seedStarterLexicon(initialization.database);
    this.#ftsAvailable = await hasFts5(initialization.database);
    const externalBuildReady = await this.hasExternalBuild();
    return { sqliteReady: true, starterReady: true, externalBuildReady };
  }

  async refreshAfterBuild(): Promise<DictionaryAvailability> {
    const database = await this.#readyDatabase();
    if (!database) {
      return {
        sqliteReady: false,
        starterReady: true,
        externalBuildReady: false,
      };
    }
    await seedStarterLexicon(database);
    this.#ftsAvailable = await hasFts5(database);
    return {
      sqliteReady: true,
      starterReady: true,
      externalBuildReady: await this.hasExternalBuild(),
    };
  }

  async hasExternalBuild(): Promise<boolean> {
    const database = await this.#readyDatabase(false);
    if (!database) {
      return false;
    }
    const rows = await database.select<CountRow[]>(
      "SELECT COUNT(*) AS count FROM dictionary_builds WHERE status LIKE 'completed%'",
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  async search(
    query: string,
    direction: DictionaryDirection,
    options: { recordHistory?: boolean } = {},
  ): Promise<DictionarySearchResponse> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return {
        direction: direction === "auto" ? "es-pt" : direction,
        results: [],
      };
    }

    const response =
      direction === "auto"
        ? await this.#searchAuto(cleanQuery)
        : {
            direction,
            results: await this.#searchDirection(cleanQuery, direction),
          };
    if (options.recordHistory !== false) {
      await this.recordHistory(
        cleanQuery,
        direction,
        response.results[0]?.translations[0]?.term ?? null,
      );
    }
    return response;
  }

  async translate(
    text: string,
    direction: DictionaryDirection,
  ): Promise<TranslationOutcome> {
    const original = text.trim();
    const containsMultipleWords = /\s/u.test(original);
    const exact =
      direction === "auto"
        ? await this.#searchAuto(original, { exactOnly: containsMultipleWords })
        : {
            direction,
            results: await this.#searchDirection(original, direction, {
              exactOnly: containsMultipleWords,
            }),
          };
    const resolvedDirection = exact.direction;
    const primaryResult = exact.results[0] ?? null;
    const primaryTranslation = primaryResult?.translations[0]?.term;

    if (
      primaryTranslation &&
      primaryResult &&
      isExactDictionaryMatch(original, primaryResult)
    ) {
      const outcome: TranslationOutcome = {
        original,
        translatedText: preserveSourceCapitalization(original, primaryTranslation),
        direction: resolvedDirection,
        mode: containsMultipleWords ? "phrase" : "word",
        primaryResult,
        unresolvedTerms: [],
        approximate: false,
      };
      await this.recordHistory(original, direction, outcome.translatedText);
      await logger.info("dictionary.search", {
        term: original,
        direction: resolvedDirection,
        mode: outcome.mode,
        exact: true,
      });
      return outcome;
    }

    if (!containsMultipleWords) {
      const outcome: TranslationOutcome = {
        original,
        translatedText: primaryTranslation ?? "",
        direction: resolvedDirection,
        mode: "word",
        primaryResult,
        unresolvedTerms: primaryTranslation ? [] : [original],
        approximate: Boolean(primaryTranslation),
      };
      await this.recordHistory(original, direction, outcome.translatedText || null);
      if (!primaryTranslation) {
        await logger.warn("dictionary.noResults", {
          term: original,
          direction: resolvedDirection,
        });
      }
      return outcome;
    }

    const phrase = await translatePhraseWithExactLookup(
      original,
      resolvedDirection,
      async (word) => {
        const results = await this.#searchDirection(word, resolvedDirection, {
          exactOnly: true,
        });
        return results[0]?.translations[0]?.term ?? null;
      },
    );
    const outcome: TranslationOutcome = {
      original,
      translatedText: phrase.translatedText,
      direction: resolvedDirection,
      mode: "phrase",
      primaryResult,
      unresolvedTerms: phrase.unresolvedTerms,
      approximate: true,
    };
    await this.recordHistory(original, direction, phrase.translatedText);
    await logger.info("dictionary.search", {
      term: original,
      direction: resolvedDirection,
      mode: "phrase",
      unresolved: phrase.unresolvedTerms.length,
    });
    return outcome;
  }

  async recordHistory(
    term: string,
    direction: DictionaryDirection,
    chosenResult: string | null,
  ): Promise<void> {
    const database = await this.#readyDatabase();
    if (!database) {
      return;
    }
    await database.execute(
      "INSERT INTO dictionary_search_history (term, normalized, direction, chosen_result) VALUES ($1, $2, $3, $4)",
      [term, normalizeDictionaryTerm(term), direction, chosenResult],
    );
  }

  async getHistory(limit = 12): Promise<readonly DictionaryHistoryItem[]> {
    const database = await this.#readyDatabase();
    if (!database) {
      return [];
    }
    const rows = await database.select<HistoryRow[]>(
      `SELECT
         id,
         term,
         direction,
         chosen_result AS chosenResult,
         searched_at AS searchedAt
       FROM dictionary_search_history
       ORDER BY searched_at DESC, id DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async getFavorites(): Promise<readonly DictionaryFavorite[]> {
    const database = await this.#readyDatabase();
    if (!database) {
      return [];
    }
    return database.select<FavoriteRow[]>(
      `SELECT
         id,
         term,
         language,
         primary_translation AS primaryTranslation,
         created_at AS createdAt
       FROM vocabulary_favorites
       ORDER BY created_at DESC, id DESC`,
    );
  }

  async isFavorite(result: DictionaryResult): Promise<boolean> {
    const database = await this.#readyDatabase();
    const translation = result.translations[0]?.term;
    if (!database || !translation) {
      return false;
    }
    const rows = await database.select<CountRow[]>(
      `SELECT COUNT(*) AS count
       FROM vocabulary_favorites
       WHERE language = $1 AND normalized = $2 AND primary_translation = $3`,
      [result.language, result.normalized, translation],
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  async toggleFavorite(result: DictionaryResult): Promise<boolean> {
    const database = await this.#readyDatabase();
    const translation = result.translations[0]?.term;
    if (!database || !translation) {
      return false;
    }
    const favorite = await this.isFavorite(result);
    if (favorite) {
      await database.execute(
        `DELETE FROM vocabulary_favorites
         WHERE language = $1 AND normalized = $2 AND primary_translation = $3`,
        [result.language, result.normalized, translation],
      );
      await logger.info("dictionary.favorite.removed", { term: result.term });
      return false;
    }
    await database.execute(
      `INSERT OR IGNORE INTO vocabulary_favorites (
         term, language, normalized, primary_translation
       ) VALUES ($1, $2, $3, $4)`,
      [result.term, result.language, result.normalized, translation],
    );
    await logger.info("dictionary.favorite.added", { term: result.term });
    return true;
  }

  async #searchAuto(
    query: string,
    options: { exactOnly?: boolean } = {},
  ): Promise<DictionarySearchResponse> {
    const guessed = guessDictionaryDirection(query);
    const alternative = guessed === "es-pt" ? "pt-es" : "es-pt";
    const [guessedResults, alternativeResults] = await Promise.all([
      this.#searchDirection(query, guessed, options),
      this.#searchDirection(query, alternative, options),
    ]);
    const guessedScore = guessedResults[0]?.score ?? 0;
    const alternativeScore = alternativeResults[0]?.score ?? 0;
    const guessedTier = matchTier(query, guessedResults[0]);
    const alternativeTier = matchTier(query, alternativeResults[0]);
    if (alternativeTier > guessedTier) {
      return { direction: alternative, results: alternativeResults };
    }
    if (guessedTier > alternativeTier) {
      return { direction: guessed, results: guessedResults };
    }
    if (alternativeScore > guessedScore + 20) {
      return { direction: alternative, results: alternativeResults };
    }
    return { direction: guessed, results: guessedResults };
  }

  async #searchDirection(
    query: string,
    direction: Exclude<DictionaryDirection, "auto">,
    options: { exactOnly?: boolean } = {},
  ): Promise<readonly DictionaryResult[]> {
    const database = await this.#readyDatabase();
    if (!database) {
      return filterStarterResults(query, searchStarterLexicon(query, direction), options);
    }
    const activeBuilds = await database.select<CountRow[]>(
      "SELECT COUNT(*) AS count FROM dictionary_builds WHERE status = 'building'",
    );
    if ((activeBuilds[0]?.count ?? 0) > 0) {
      return filterStarterResults(query, searchStarterLexicon(query, direction), options);
    }
    const language = languageForDirection(direction);
    const normalized = normalizeDictionaryTerm(query);
    const key = dictionarySearchKey(query);
    const firstCharacter = key[0] ?? "";
    const ftsQuery = key
      .split(/\s+/u)
      .filter(Boolean)
      .map((token) => `${token.replace(/-/gu, "")}*`)
      .join(" AND ");
    const ftsClause = this.#ftsAvailable && !options.exactOnly
      ? `OR e.id IN (
             SELECT CAST(entry_id AS INTEGER)
             FROM dictionary_fts
             WHERE dictionary_fts MATCH $8
             LIMIT 60
           )`
      : "";
    const bindings: (string | number)[] = options.exactOnly
      ? [language, normalized, key]
      : [
          language,
          normalized,
          key,
          `${normalized}%`,
          `${key}%`,
          firstCharacter,
          key.length,
        ];
    if (this.#ftsAvailable && !options.exactOnly) {
      bindings.push(ftsQuery);
    }
    const broadMatchClause = options.exactOnly
      ? ""
      : `OR e.normalized LIKE $4
           OR e.search_key LIKE $5
           OR (
             substr(e.search_key, 1, 1) = $6
             AND abs(length(e.search_key) - $7) <= 2
           )
           ${ftsClause}`;
    const rows = await database.select<DictionaryRow[]>(
      `SELECT
         e.id AS entryId,
         e.term,
         e.language,
         e.normalized,
         e.search_key AS searchKey,
         e.part_of_speech AS partOfSpeech,
         e.definition,
         e.common_score AS commonScore,
         CASE WHEN EXISTS (
           SELECT 1 FROM dictionary_relations r
           WHERE r.entry_id = e.id
             AND r.relation_type = 'variant'
             AND r.normalized_related_term = $2
         ) THEN 1 ELSE 0 END AS variantMatch,
         t.translated_term AS translatedTerm,
         t.translated_language AS translatedLanguage,
         t.context_label AS contextLabel,
         t.locale,
         t.source_priority AS sourcePriority,
         COALESCE(GROUP_CONCAT(DISTINCT s.display_name), '') AS sources
       FROM dictionary_entries e
       JOIN dictionary_translations t ON t.entry_id = e.id
       LEFT JOIN dictionary_translation_sources ts ON ts.translation_id = t.id
       LEFT JOIN dictionary_sources s ON s.id = ts.source_id
       WHERE e.language = $1
         AND (
           e.normalized = $2
           OR e.search_key = $3
           OR EXISTS (
             SELECT 1 FROM dictionary_relations exact_relation
             WHERE exact_relation.entry_id = e.id
               AND exact_relation.relation_type = 'variant'
               AND exact_relation.normalized_related_term = $2
           )
           ${broadMatchClause}
         )
       GROUP BY e.id, t.id
       ORDER BY e.common_score DESC, t.source_priority DESC
       LIMIT 140`,
      bindings,
    );
    return rankAndGroupRows(rows, normalized, key).slice(0, 12);
  }

  async #readyDatabase(initialize = true): Promise<Database | null> {
    if (!this.#database && initialize) {
      await this.initialize();
    }
    return this.#database;
  }
}

function filterStarterResults(
  query: string,
  results: readonly DictionaryResult[],
  options: { exactOnly?: boolean },
): readonly DictionaryResult[] {
  return options.exactOnly
    ? results.filter((result) => isExactDictionaryMatch(query, result))
    : results;
}

function isExactDictionaryMatch(
  query: string,
  result: DictionaryResult,
): boolean {
  return (
    result.normalized === normalizeDictionaryTerm(query) ||
    dictionarySearchKey(result.term) === dictionarySearchKey(query)
  );
}

function matchTier(
  query: string,
  result: DictionaryResult | undefined,
): number {
  if (!result) {
    return 0;
  }
  if (result.normalized === normalizeDictionaryTerm(query)) {
    return 3;
  }
  if (dictionarySearchKey(result.term) === dictionarySearchKey(query)) {
    return 2;
  }
  return 1;
}

export function rankAndGroupRows(
  rows: readonly DictionaryRow[],
  normalizedQuery: string,
  searchKeyQuery: string,
): readonly DictionaryResult[] {
  const grouped = new Map<number, DictionaryResult>();
  for (const row of rows) {
    const distance = levenshteinDistance(searchKeyQuery, row.searchKey);
    let matchScore = 0;
    if (row.normalized === normalizedQuery) {
      matchScore = 6_000;
    } else if (row.variantMatch === 1) {
      matchScore = 5_000;
    } else if (row.searchKey === searchKeyQuery) {
      matchScore = 4_500;
    } else if (row.normalized.startsWith(normalizedQuery)) {
      matchScore = 3_200;
    } else if (row.searchKey.startsWith(searchKeyQuery)) {
      matchScore = 3_000;
    } else if (distance <= Math.max(1, Math.floor(searchKeyQuery.length / 5))) {
      matchScore = 2_000 - distance * 100;
    } else {
      continue;
    }
    const score = matchScore + row.commonScore + row.sourcePriority;
    const translation: DictionaryTranslation = {
      term: row.translatedTerm,
      language: row.translatedLanguage,
      context: row.contextLabel,
      locale: row.locale,
      sources: row.sources ? row.sources.split(",").filter(Boolean) : [],
      score: row.sourcePriority,
    };
    const current = grouped.get(row.entryId);
    if (current) {
      if (
        !current.translations.some(
          (item) =>
            normalizeDictionaryTerm(item.term) ===
              normalizeDictionaryTerm(translation.term) &&
            item.context === translation.context,
        )
      ) {
        grouped.set(row.entryId, {
          ...current,
          translations: [...current.translations, translation].sort(
            (left, right) => right.score - left.score,
          ),
          score: Math.max(current.score, score),
        });
      }
      continue;
    }
    grouped.set(row.entryId, {
      id: row.entryId,
      term: row.term,
      language: row.language,
      normalized: row.normalized,
      partOfSpeech: row.partOfSpeech,
      definition: row.definition,
      translations: [translation],
      score,
    });
  }
  return [...grouped.values()].sort((left, right) => right.score - left.score);
}

export async function seedStarterLexicon(database: Database): Promise<void> {
  const existingSources = await database.select<StarterSourceRow[]>(
    `SELECT
       id,
       status,
       processed_count AS processedCount,
       accepted_count AS acceptedCount
     FROM dictionary_sources
     WHERE source_key = $1`,
    [STARTER_SOURCE_KEY],
  );
  const existingSource = existingSources[0];
  if (
    existingSource?.status === "imported" &&
    existingSource.processedCount === starterLexicon.length &&
    existingSource.acceptedCount === starterLexicon.length
  ) {
    await logger.info("dictionary.starter.ready", {
      pairs: starterLexicon.length,
      cached: true,
    });
    return;
  }

  await database.execute(
    `INSERT INTO dictionary_sources (
       source_key, display_name, family, version_label,
       license_label, redistribution_notes, status, imported_at,
       processed_count, accepted_count, error_count
     ) VALUES (
       $1, 'PORTUWANA esencial', 'builtin', $2,
       'Proyecto PORTUWANA', 'Vocabulario curado para disponibilidad offline inicial.',
       'building', NULL, 0, 0, 0
     )
     ON CONFLICT(source_key) DO UPDATE SET
       version_label = excluded.version_label,
       status = 'building',
       imported_at = NULL,
       processed_count = 0,
       accepted_count = 0,
       error_count = 0`,
    [STARTER_SOURCE_KEY, STARTER_LEXICON_VERSION],
  );
  const sourceRows = await database.select<IdRow[]>(
    "SELECT id FROM dictionary_sources WHERE source_key = $1",
    [STARTER_SOURCE_KEY],
  );
  const sourceId = sourceRows[0]?.id;
  if (!sourceId) {
    throw new Error("No se pudo inicializar la fuente esencial del diccionario.");
  }

  for (const pair of starterLexicon) {
    const esId = await upsertStarterEntry(
      database,
      pair.es,
      "es",
      pair.partOfSpeech,
      pair.definitionEs ?? null,
      "",
      pair.commonScore ?? 80,
    );
    const ptId = await upsertStarterEntry(
      database,
      pair.pt,
      "pt",
      pair.partOfSpeech,
      pair.definitionPt ?? null,
      pair.locale ?? "pt-BR",
      pair.commonScore ?? 80,
    );
    await linkStarterSource(database, esId, sourceId);
    await linkStarterSource(database, ptId, sourceId);
    const esTranslationId = await upsertStarterTranslation(
      database,
      esId,
      pair.pt,
      "pt",
      pair.context ?? "",
      pair.locale ?? "pt-BR",
      pair.commonScore ?? 80,
      ptId,
    );
    const ptTranslationId = await upsertStarterTranslation(
      database,
      ptId,
      pair.es,
      "es",
      pair.context ?? "",
      pair.locale ?? "",
      pair.commonScore ?? 80,
      esId,
    );
    await linkStarterTranslationSource(database, esTranslationId, sourceId);
    await linkStarterTranslationSource(database, ptTranslationId, sourceId);
  }

  await database.execute("DELETE FROM dictionary_search_index");
  await database.execute(
    `INSERT INTO dictionary_search_index (
       entry_id, language, term, normalized, search_key, translations
     )
     SELECT e.id, e.language, e.term, e.normalized, e.search_key,
            COALESCE(GROUP_CONCAT(DISTINCT t.translated_term), '')
     FROM dictionary_entries e
     LEFT JOIN dictionary_translations t ON t.entry_id = e.id
     GROUP BY e.id`,
  );
  const fts = await database.select<SqliteMasterRow[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dictionary_fts'",
  );
  if (fts.length > 0) {
    await database.execute("DELETE FROM dictionary_fts");
    await database.execute(
      `INSERT INTO dictionary_fts (
         entry_id, language, term, normalized, search_key, translations
       )
       SELECT entry_id, language, term, normalized, search_key, translations
      FROM dictionary_search_index`,
    );
  }
  await database.execute(
    `UPDATE dictionary_sources
     SET status = 'imported',
         imported_at = CURRENT_TIMESTAMP,
         processed_count = $2,
         accepted_count = $2,
         error_count = 0
     WHERE id = $1`,
    [sourceId, starterLexicon.length],
  );
  await logger.info("dictionary.starter.ready", {
    pairs: starterLexicon.length,
    cached: false,
  });
}

async function hasFts5(database: Database): Promise<boolean> {
  const rows = await database.select<SqliteMasterRow[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dictionary_fts'",
  );
  return rows.length > 0;
}

async function upsertStarterEntry(
  database: Database,
  term: string,
  language: DictionaryLanguage,
  partOfSpeech: string,
  definition: string | null,
  locale: string,
  commonScore: number,
): Promise<number> {
  const normalized = normalizeDictionaryTerm(term);
  await database.execute(
    `INSERT INTO dictionary_entries (
       term, language, normalized, search_key, part_of_speech,
       definition, locale, common_score
     ) VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8)
     ON CONFLICT(language, normalized, part_of_speech) DO UPDATE SET
       definition = COALESCE(dictionary_entries.definition, excluded.definition),
       locale = COALESCE(dictionary_entries.locale, excluded.locale),
       common_score = MAX(dictionary_entries.common_score, excluded.common_score),
       updated_at = CURRENT_TIMESTAMP`,
    [
      term,
      language,
      normalized,
      dictionarySearchKey(term),
      partOfSpeech,
      definition,
      locale,
      commonScore,
    ],
  );
  const rows = await database.select<IdRow[]>(
    `SELECT id FROM dictionary_entries
     WHERE language = $1 AND normalized = $2 AND part_of_speech = $3`,
    [language, normalized, partOfSpeech],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`No se pudo inicializar el término ${term}.`);
  }
  return id;
}

async function linkStarterSource(
  database: Database,
  entryId: number,
  sourceId: number,
): Promise<void> {
  await database.execute(
    "INSERT OR IGNORE INTO dictionary_entry_sources (entry_id, source_id, external_reference) VALUES ($1, $2, 'starter-v1')",
    [entryId, sourceId],
  );
}

async function upsertStarterTranslation(
  database: Database,
  entryId: number,
  translatedTerm: string,
  translatedLanguage: DictionaryLanguage,
  context: string,
  locale: string,
  priority: number,
  targetEntryId: number,
): Promise<number> {
  const normalized = normalizeDictionaryTerm(translatedTerm);
  await database.execute(
    `INSERT INTO dictionary_translations (
       entry_id, translated_term, translated_language,
       normalized_translation, context_label, locale,
       source_priority, target_entry_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(
       entry_id, translated_language, normalized_translation,
       context_label, locale
     ) DO UPDATE SET
       source_priority = MAX(dictionary_translations.source_priority, excluded.source_priority),
       target_entry_id = COALESCE(dictionary_translations.target_entry_id, excluded.target_entry_id)`,
    [
      entryId,
      translatedTerm,
      translatedLanguage,
      normalized,
      context,
      locale,
      priority,
      targetEntryId,
    ],
  );
  const rows = await database.select<IdRow[]>(
    `SELECT id FROM dictionary_translations
     WHERE entry_id = $1 AND translated_language = $2
       AND normalized_translation = $3 AND context_label = $4 AND locale = $5`,
    [entryId, translatedLanguage, normalized, context, locale],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`No se pudo inicializar la traducción ${translatedTerm}.`);
  }
  return id;
}

async function linkStarterTranslationSource(
  database: Database,
  translationId: number,
  sourceId: number,
): Promise<void> {
  await database.execute(
    "INSERT OR IGNORE INTO dictionary_translation_sources (translation_id, source_id, external_reference) VALUES ($1, $2, 'starter-v1')",
    [translationId, sourceId],
  );
}
