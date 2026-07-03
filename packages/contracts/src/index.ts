/**
 * @talentflow/contracts — shared schemas + types tussen API en web.
 *
 * Structuur:
 *   - common/       gedeelde schemas die niet bij één entiteit horen
 *   - job/          (Sub-fase 2B) — Job schemas
 *   - notification/ — geconsolideerde notificatie-voorkeuren (GET/PUT wire-shape)
 *   - candidate/    (toekomstig)
 *
 * Bij elke entiteit volgen we hetzelfde patroon:
 *   - *RowSchema       : exacte DB-realiteit (nullable per kolom)
 *   - *ListItemSchema  : afgeleid (.pick) — response van list-endpoint
 *   - *DetailSchema    : afgeleid (.extend) — response van detail-endpoint
 *   - *CreateInputSchema / *UpdateInputSchema : request-bodies
 *   - TS-types via z.infer<>
 */
export * from "./common";
export * from "./job";
export * from "./notification";
