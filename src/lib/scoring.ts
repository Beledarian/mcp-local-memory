export const MIN_IMPORTANCE = 0;
export const MAX_IMPORTANCE = 1;
export const MAX_REINFORCED_IMPORTANCE = 0.95;

export interface RecallScoringConfig {
  relevanceWeight: number;
  halfLifeWeeks: number;
  consolidationFactor: number;
  tagMatchBoost: number;
  keywordCoverageBoost: number;
  minimumRelevance: number;
  semanticOnlyMinimumRelevance: number;
  deduplicationThreshold: number;
  familiarityMaxBoost: number;
  familiarityWindowDays: number;
  familiaritySaturation: number;
}

export interface RecallCandidate {
  id: string;
  content: string;
  tags?: string | null;
  created_at?: string;
  importance?: number | null;
  last_accessed?: string | null;
  access_count?: number | null;
  last_reinforced_at?: string | null;
  reinforcement_count?: number | null;
  lifecycle_state?: "active" | "outdated" | "incorrect";
  familiarity_count?: number | null;
  distance?: number | null;
  ftsRank?: number | null;
  vectorRank?: number;
  keywordRank?: number;
}

export interface RankedRecallCandidate extends RecallCandidate {
  score: number;
  relevanceScore: number;
  vectorScore: number;
  keywordScore: number;
  rankFusionScore: number;
  keywordCoverage: number;
  importanceScore: number;
  tagBoost: number;
  familiarityScore: number;
  familiarityBoost: number;
}

const DEFAULT_CONFIG: RecallScoringConfig = {
  relevanceWeight: 0.9,
  halfLifeWeeks: 4,
  consolidationFactor: 1,
  tagMatchBoost: 0.15,
  keywordCoverageBoost: 0.15,
  minimumRelevance: 0.55,
  semanticOnlyMinimumRelevance: 0.75,
  deduplicationThreshold: 0.9,
  familiarityMaxBoost: 0.03,
  familiarityWindowDays: 30,
  familiaritySaturation: 5,
};

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

export const clampImportance = (
  importance: number | null | undefined,
  fallback = 0.5,
): number =>
  clamp(
    Number.isFinite(importance) ? Number(importance) : fallback,
    MIN_IMPORTANCE,
    MAX_IMPORTANCE,
  );

const readBoundedNumber = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number.parseFloat(env[key] ?? "");
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
};

export function getRecallScoringConfig(
  env: NodeJS.ProcessEnv = process.env,
): RecallScoringConfig {
  return {
    // Keep the historical variable name for compatibility. It now means
    // retrieval relevance (semantic and lexical) versus memory importance.
    relevanceWeight: readBoundedNumber(
      env,
      "MEMORY_SEMANTIC_WEIGHT",
      DEFAULT_CONFIG.relevanceWeight,
      0,
      1,
    ),
    halfLifeWeeks: readBoundedNumber(
      env,
      "MEMORY_HALF_LIFE_WEEKS",
      DEFAULT_CONFIG.halfLifeWeeks,
      0.01,
      5200,
    ),
    // This now applies only to explicit reinforce_memory events. Merely
    // returning a recall result never consolidates it.
    consolidationFactor: readBoundedNumber(
      env,
      "MEMORY_CONSOLIDATION_FACTOR",
      DEFAULT_CONFIG.consolidationFactor,
      0,
      100,
    ),
    tagMatchBoost: readBoundedNumber(
      env,
      "TAG_MATCH_BOOST",
      DEFAULT_CONFIG.tagMatchBoost,
      0,
      1,
    ),
    keywordCoverageBoost: readBoundedNumber(
      env,
      "MEMORY_KEYWORD_COVERAGE_BOOST",
      DEFAULT_CONFIG.keywordCoverageBoost,
      0,
      1,
    ),
    minimumRelevance: readBoundedNumber(
      env,
      "MEMORY_MIN_RELEVANCE",
      DEFAULT_CONFIG.minimumRelevance,
      0,
      1,
    ),
    semanticOnlyMinimumRelevance: readBoundedNumber(
      env,
      "MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE",
      DEFAULT_CONFIG.semanticOnlyMinimumRelevance,
      0,
      1,
    ),
    deduplicationThreshold: readBoundedNumber(
      env,
      "MEMORY_DEDUP_SIMILARITY",
      DEFAULT_CONFIG.deduplicationThreshold,
      0.5,
      1,
    ),
    familiarityMaxBoost: readBoundedNumber(
      env,
      "MEMORY_RECALL_FAMILIARITY_MAX_BOOST",
      DEFAULT_CONFIG.familiarityMaxBoost,
      0,
      0.05,
    ),
    familiarityWindowDays: readBoundedNumber(
      env,
      "MEMORY_RECALL_FAMILIARITY_WINDOW_DAYS",
      DEFAULT_CONFIG.familiarityWindowDays,
      1,
      365,
    ),
    familiaritySaturation: readBoundedNumber(
      env,
      "MEMORY_RECALL_FAMILIARITY_SATURATION",
      DEFAULT_CONFIG.familiaritySaturation,
      1,
      100,
    ),
  };
}

export function cosineDistanceToSimilarity(
  distance: number | null | undefined,
): number {
  if (!Number.isFinite(distance)) return 0;
  // Cosine distance spans 0..2. This maps cosine -1..1 into similarity 0..1.
  return clamp(1 - Number(distance) / 2);
}

export function decayedImportance(
  importance: number | null | undefined,
  reinforcedAt: string | null | undefined,
  reinforcementCount: number | null | undefined,
  config: RecallScoringConfig,
  now = new Date(),
): number {
  const boundedImportance = clampImportance(importance);
  const anchor = reinforcedAt ? new Date(reinforcedAt) : now;
  const anchorTime = anchor.getTime();
  const elapsedMs = Number.isFinite(anchorTime)
    ? Math.max(0, now.getTime() - anchorTime)
    : 0;
  const weeks = elapsedMs / (1000 * 60 * 60 * 24 * 7);
  // Explicit reinforcement has diminishing stability and cannot grow without
  // bound. Historical passive recall counts are intentionally ignored.
  const boundedReinforcementCount = clamp(
    Number.isFinite(reinforcementCount) ? Number(reinforcementCount) : 0,
    0,
    20,
  );
  const stability =
    config.halfLifeWeeks *
    (1 +
      config.consolidationFactor *
        Math.log2(boundedReinforcementCount + 1));

  return clampImportance(
    boundedImportance * Math.pow(0.5, weeks / Math.max(stability, 0.01)),
    0,
  );
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
]);

const tokenize = (text: string, removeStopWords: boolean): string[] => {
  const rawTokens = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim());
  const expanded = rawTokens.flatMap((token) => {
    const parts = token.split(/[_-]+/).filter((part) => part !== token);
    return [token, ...parts];
  });
  return expanded
    .filter(
      (token) =>
        token.length > 1 && (!removeStopWords || !STOP_WORDS.has(token)),
    );
};

export function tokenizeRecallQuery(query: string): string[] {
  return [...new Set(tokenize(query, true))];
}

function parseTags(tags: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(tags ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function candidateTokens(candidate: RecallCandidate): Set<string> {
  return new Set(
    tokenize(`${candidate.content} ${parseTags(candidate.tags).join(" ")}`, false),
  );
}

function keywordCoverage(
  candidate: RecallCandidate,
  queryTokens: string[],
): number {
  if (queryTokens.length === 0) return 0;
  const haystackTokens = candidateTokens(candidate);
  const matched = queryTokens.filter((token) => haystackTokens.has(token)).length;
  return matched / queryTokens.length;
}

function tagMatchCoverage(
  candidate: RecallCandidate,
  queryTokens: string[],
): number {
  if (queryTokens.length === 0) return 0;
  const tagTokens = new Set(
    parseTags(candidate.tags).flatMap((tag) => tokenize(tag, true)),
  );
  const matches = queryTokens.filter((token) => tagTokens.has(token)).length;
  return matches / queryTokens.length;
}

const reciprocalRankQuality = (rank: number | undefined): number =>
  rank ? 11 / (10 + rank) : 0;

function normalizedRankFusion(candidate: RecallCandidate): number {
  const offset = 60;
  const bestContribution = 1 / (offset + 1);
  const vectorContribution = candidate.vectorRank
    ? 1 / (offset + candidate.vectorRank)
    : 0;
  const keywordContribution = candidate.keywordRank
    ? 1 / (offset + candidate.keywordRank)
    : 0;
  return clamp(
    (vectorContribution + keywordContribution) / (2 * bestContribution),
  );
}

function contentTokenSet(content: string): Set<string> {
  return new Set(tokenize(content, true));
}

function isNearDuplicate(
  candidate: RankedRecallCandidate,
  selected: RankedRecallCandidate[],
  threshold: number,
): boolean {
  const normalized = tokenize(candidate.content, false).join(" ");
  const candidateSet = contentTokenSet(candidate.content);

  return selected.some((existing) => {
    if (normalized === tokenize(existing.content, false).join(" ")) return true;
    const existingSet = contentTokenSet(existing.content);
    if (candidateSet.size < 5 || existingSet.size < 5) return false;

    let intersection = 0;
    for (const token of candidateSet) {
      if (existingSet.has(token)) intersection++;
    }
    const union = candidateSet.size + existingSet.size - intersection;
    return union > 0 && intersection / union >= threshold;
  });
}

export function rankRecallCandidates(
  vectorCandidates: RecallCandidate[],
  keywordCandidates: RecallCandidate[],
  query: string,
  limit: number,
  config = getRecallScoringConfig(),
  now = new Date(),
): RankedRecallCandidate[] {
  const candidates = new Map<string, RecallCandidate>();

  vectorCandidates.forEach((candidate, index) => {
    candidates.set(candidate.id, { ...candidate, vectorRank: index + 1 });
  });
  keywordCandidates.forEach((candidate, index) => {
    const existing = candidates.get(candidate.id);
    candidates.set(candidate.id, {
      ...existing,
      ...candidate,
      distance: existing?.distance ?? candidate.distance,
      vectorRank: existing?.vectorRank,
      keywordRank: index + 1,
    });
  });

  const queryTokens = tokenizeRecallQuery(query);
  const hasSearchTerms = queryTokens.length > 0;

  const ranked = [...candidates.values()]
    .map((candidate): RankedRecallCandidate => {
      const vectorScore = cosineDistanceToSimilarity(candidate.distance);
      const coverage = keywordCoverage(candidate, queryTokens);
      const keywordScore = candidate.keywordRank
        ? clamp(
            coverage * 0.85 +
              reciprocalRankQuality(candidate.keywordRank) * 0.15,
          )
        : 0;
      const rankFusionScore = normalizedRankFusion(candidate);
      const sourceRelevance = hasSearchTerms
        ? Math.max(vectorScore, keywordScore)
        : reciprocalRankQuality(candidate.keywordRank);
      const fusedRelevance = clamp(
        sourceRelevance * 0.9 + rankFusionScore * 0.1,
      );
      // A generic one-token tag should not receive the full boost for a
      // multi-term query. Exact single-tag queries still receive all of it.
      const tagBoost =
        tagMatchCoverage(candidate, queryTokens) * config.tagMatchBoost;
      // Boost only the unused headroom. This preserves score distinctions
      // instead of making many good candidates clamp to exactly 1.
      const boundedBoost = clamp(
        coverage * config.keywordCoverageBoost + tagBoost,
      );
      const relevanceScore = clamp(
        fusedRelevance + (1 - fusedRelevance) * boundedBoost,
      );
      const importanceScore = decayedImportance(
        candidate.importance,
        candidate.last_reinforced_at ?? candidate.created_at,
        candidate.reinforcement_count,
        config,
        now,
      );
      const baseScore = clamp(
        config.relevanceWeight * relevanceScore +
          (1 - config.relevanceWeight) * importanceScore,
      );
      const familiarityCount = clamp(
        Number.isFinite(candidate.familiarity_count)
          ? Number(candidate.familiarity_count)
          : 0,
        0,
        10_000,
      );
      const familiarityScore =
        1 - Math.exp(-familiarityCount / config.familiaritySaturation);
      const familiarityBoost =
        config.familiarityMaxBoost * familiarityScore;
      // Familiarity only uses remaining score headroom and is applied after
      // relevance is calculated. The relevance filter below therefore cannot
      // be bypassed by repeated retrieval.
      const score = clamp(
        baseScore + (1 - baseScore) * familiarityBoost,
      );

      return {
        ...candidate,
        score,
        relevanceScore,
        vectorScore,
        keywordScore,
        rankFusionScore,
        keywordCoverage: coverage,
        importanceScore,
        tagBoost,
        familiarityScore,
        familiarityBoost,
      };
    })
    .filter((candidate) => {
      if (!hasSearchTerms) return true;
      const minimum =
        queryTokens.length >= 4 && candidate.keywordCoverage < 0.4
          ? Math.max(
              config.minimumRelevance,
              config.semanticOnlyMinimumRelevance,
            )
          : config.minimumRelevance;
      return candidate.relevanceScore >= minimum;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.relevanceScore - a.relevanceScore ||
        b.keywordCoverage - a.keywordCoverage ||
        (a.keywordRank ?? Number.MAX_SAFE_INTEGER) -
          (b.keywordRank ?? Number.MAX_SAFE_INTEGER) ||
        (a.vectorRank ?? Number.MAX_SAFE_INTEGER) -
          (b.vectorRank ?? Number.MAX_SAFE_INTEGER),
    );

  const selected: RankedRecallCandidate[] = [];
  for (const candidate of ranked) {
    if (
      !isNearDuplicate(
        candidate,
        selected,
        config.deduplicationThreshold,
      )
    ) {
      selected.push(candidate);
    }
    if (selected.length >= Math.max(0, limit)) break;
  }
  return selected;
}

// Backward-compatible SQLite helper used by legacy diagnostics. Its
// lastAccessed/accessCount arguments now represent explicit reinforcement.
export function scoreVectorRecall(
  importance: number,
  lastReinforcedAt: string | null,
  reinforcementCount: number,
  distance: number,
  config = getRecallScoringConfig(),
): number {
  const relevance = cosineDistanceToSimilarity(distance);
  const importanceScore = decayedImportance(
    importance,
    lastReinforcedAt,
    reinforcementCount,
    config,
  );
  return clamp(
    config.relevanceWeight * relevance +
      (1 - config.relevanceWeight) * importanceScore,
  );
}
