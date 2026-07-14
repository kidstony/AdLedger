import { OptimizationSuggestion, OptSeverity } from '@/lib/types'

// Đổi dòng optimizer_suggestions (DB) → shape OptimizationSuggestion mà
// SuggestionCard đang render, kèm trường vòng đời v2. Dùng chung cho
// /api/optimize và /api/optimize/actions.

export interface PersistedSuggestion extends OptimizationSuggestion {
  state: string
  issuedAt: string
  appliedAt: string | null
  evaluateAfter: string | null
  outcome: Record<string, unknown> | null
  score: number
}

export interface SuggestionRow {
  id: string
  rule_key: string
  dedupe_key: string
  state: string
  severity: OptSeverity
  confidence: 'roi' | 'engagement'
  suggestion_type: string
  title: string
  detail: string
  action: string
  evidence: { evidence?: OptimizationSuggestion['evidence']; items?: OptimizationSuggestion['items']; scope?: OptimizationSuggestion['scope'] } | null
  params: Record<string, unknown>
  impact_estimate: number
  score: number
  issued_at: string
  applied_at: string | null
  evaluate_after: string | null
  outcome: Record<string, unknown> | null
}

export function rowToSuggestion(r: SuggestionRow): PersistedSuggestion {
  return {
    id: r.id,
    type: (r.suggestion_type || 'data_quality') as OptimizationSuggestion['type'],
    severity: r.severity,
    confidence: r.confidence,
    scope: r.evidence?.scope ?? { level: 'campaign', label: '' },
    title: r.title,
    detail: r.detail,
    evidence: r.evidence?.evidence ?? [],
    recommendedAction: r.action,
    impactScore: Number(r.impact_estimate) || 0,
    items: r.evidence?.items ?? undefined,
    ruleKey: r.rule_key,
    dedupeKey: r.dedupe_key,
    params: r.params,
    state: r.state,
    issuedAt: r.issued_at,
    appliedAt: r.applied_at,
    evaluateAfter: r.evaluate_after,
    outcome: r.outcome,
    score: Number(r.score) || 0,
  }
}
