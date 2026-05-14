/**
 * Re-export of the shared matching types so existing imports
 * (`import { JobMatch } from "@/lib/types/matching"`) keep working while
 * new code can pull directly from `@talentflow/shared`.
 */
export type {
  JobMatch,
  CandidateMatch,
  MatchExplanationResponse,
  TalentFitModelInfo,
  TalentFitHistoryPoint,
  TalentFitPrediction,
  TalentFitFeature,
  SimilarHireDetail,
} from "@talentflow/shared";
