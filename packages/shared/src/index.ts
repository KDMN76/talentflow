/**
 * @talentflow/shared — Shared TypeScript types between API and web app.
 *
 * Keep this barrel small and explicit. Each domain has its own file under
 * `./types/` and is re-exported here.
 */

export * from './types/candidate';
export * from './types/job';
export * from './types/job-detail';
export * from './types/pipeline-template';
export * from './types/email';
export * from './types/matching';
export * from './types/ats-extensions';
export * from './lib/mergeVariables';
