/**
 * EU AI Act human-oversight-gate tests — Sprint Q4.6.
 *
 * Test:
 *   - isRejectionStageName (NL + EN varianten, negatieven)
 *   - isGatedActionType / GATED_ACTION_TYPES
 *   - categorizeAiFeature (feature → categorie, onbekend → other)
 *   - createActionProposal — insert + audit; conflict (openstaand voorstel)
 *     → null en géén audit-rij
 *   - executeAction gate:
 *       * expliciet reject-actietype → proposal i.p.v. uitvoering
 *       * move_to_stage naar rejection-stage → proposal, geen UPDATE
 *       * move_to_stage naar normale stage → UPDATE gaat gewoon door
 *   - decideAiActionProposal — approve voert uit + audit; reject blokkeert;
 *     404 bij onbekend voorstel; 409 bij al-beoordeeld
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import {
  categorizeAiFeature,
  createActionProposal,
  decideAiActionProposal,
  GATED_ACTION_TYPES,
  isGatedActionType,
  isRejectionStageName,
  type AiActionProposalRow,
} from '../../src/modules/compliance/aiOversight.service';
import { executeAction } from '../../src/modules/workflows/workflowActions';
import type { WorkflowAction } from '../../src/modules/workflows/workflows.service';
import { AppError } from '../../src/middleware/errorHandler';
import { AuditActions } from '../../src/lib/auditActions';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const APP_ID = '33333333-3333-3333-3333-333333333333';
const JOB_ID = '44444444-4444-4444-4444-444444444444';
const CANDIDATE_ID = '55555555-5555-5555-5555-555555555555';
const STAGE_ID = '66666666-6666-6666-6666-666666666666';
const PROPOSAL_ID = '77777777-7777-7777-7777-777777777777';
const WORKFLOW_ID = '88888888-8888-8888-8888-888888888888';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function callsMatching(client: MockClient, pattern: RegExp): string[] {
  return client.query.mock.calls
    .map((c) => String(c[0]))
    .filter((sql) => pattern.test(sql));
}

function basePendingProposal(
  overrides: Partial<AiActionProposalRow> = {}
): AiActionProposalRow {
  return {
    id: PROPOSAL_ID,
    tenant_id: TENANT_ID,
    source: 'workflow',
    source_id: WORKFLOW_ID,
    action_type: 'move_to_stage',
    action_config: { stage_id: STAGE_ID, stage_name: 'Afgewezen' },
    trigger_event: 'candidate.stage_changed',
    entity_type: 'application',
    entity_id: APP_ID,
    candidate_id: CANDIDATE_ID,
    job_id: JOB_ID,
    reason: 'test',
    status: 'pending_review',
    proposed_at: new Date().toISOString(),
    decided_at: null,
    decided_by: null,
    decision_note: null,
    ...overrides,
  };
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('isRejectionStageName', () => {
  it('herkent NL-varianten', () => {
    expect(isRejectionStageName('Afgewezen')).toBe(true);
    expect(isRejectionStageName('afwijzing')).toBe(true);
    expect(isRejectionStageName('Afgekeurd')).toBe(true);
    expect(isRejectionStageName('Niet aangenomen')).toBe(true);
    expect(isRejectionStageName('niet geschikt')).toBe(true);
  });

  it('herkent EN-varianten', () => {
    expect(isRejectionStageName('Rejected')).toBe(true);
    expect(isRejectionStageName('reject')).toBe(true);
    expect(isRejectionStageName('Declined')).toBe(true);
    expect(isRejectionStageName('Denied')).toBe(true);
    expect(isRejectionStageName('Turned down')).toBe(true);
  });

  it('matcht niet op reguliere stages', () => {
    expect(isRejectionStageName('Sollicitatie')).toBe(false);
    expect(isRejectionStageName('Interview')).toBe(false);
    expect(isRejectionStageName('Aangenomen')).toBe(false);
    expect(isRejectionStageName('Offer')).toBe(false);
    expect(isRejectionStageName('Hired')).toBe(false);
  });

  it('is veilig voor null/undefined/leeg', () => {
    expect(isRejectionStageName(null)).toBe(false);
    expect(isRejectionStageName(undefined)).toBe(false);
    expect(isRejectionStageName('')).toBe(false);
  });
});

describe('isGatedActionType', () => {
  it('gate-t expliciete reject-actietypes', () => {
    expect(isGatedActionType('reject')).toBe(true);
    expect(isGatedActionType('reject_application')).toBe(true);
    expect(isGatedActionType('move_to_rejected')).toBe(true);
    expect(GATED_ACTION_TYPES.size).toBe(3);
  });

  it('gate-t reguliere actietypes NIET (move_to_stage gaat via naam-detectie)', () => {
    expect(isGatedActionType('send_email')).toBe(false);
    expect(isGatedActionType('move_to_stage')).toBe(false);
    expect(isGatedActionType('add_tag')).toBe(false);
  });
});

describe('categorizeAiFeature', () => {
  it('mapt bekende features naar categorieën', () => {
    expect(categorizeAiFeature('resume_parser')).toBe('profile_parsing');
    expect(categorizeAiFeature('embedding')).toBe('semantic_indexing');
    expect(categorizeAiFeature('match_explanation')).toBe('matching');
    expect(categorizeAiFeature('bias_check')).toBe('bias_monitoring');
    expect(categorizeAiFeature('interview_summary')).toBe('interview_ai');
  });

  it('valt terug op other voor onbekende features', () => {
    expect(categorizeAiFeature('toekomstige_feature')).toBe('other');
  });
});

// ─── createActionProposal ────────────────────────────────────────────────────

describe('createActionProposal', () => {
  it('insert een voorstel en logt een audit-rij', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/INSERT INTO ai_action_proposals/i.test(sql)) {
          return { rows: [{ id: PROPOSAL_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const id = await createActionProposal(client, TENANT_ID, {
      source: 'workflow',
      sourceId: WORKFLOW_ID,
      actionType: 'move_to_stage',
      actionConfig: { stage_id: STAGE_ID, stage_name: 'Afgewezen' },
      triggerEvent: 'candidate.stage_changed',
      entityId: APP_ID,
      candidateId: CANDIDATE_ID,
      jobId: JOB_ID,
      reason: 'test',
    });

    expect(id).toBe(PROPOSAL_ID);
    const audits = client.query.mock.calls.filter((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audits).toHaveLength(1);
    // Derde parameter van logAudit's insert is de action.
    expect(audits[0][1]).toContain(AuditActions.AI_PROPOSAL_CREATED);
  });

  it('is idempotent: conflict (openstaand voorstel) → null, géén audit', async () => {
    // ON CONFLICT ... DO NOTHING → geen RETURNING-rij.
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });

    const id = await createActionProposal(client, TENANT_ID, {
      source: 'workflow',
      actionType: 'move_to_stage',
      actionConfig: {},
      entityId: APP_ID,
    });

    expect(id).toBeNull();
    expect(callsMatching(client, /INSERT INTO audit_events/i)).toHaveLength(0);
  });
});

// ─── executeAction gate (workflow-runner) ────────────────────────────────────

function buildCtx(client: MockClient) {
  return {
    client,
    tenantId: TENANT_ID,
    event: 'candidate.stage_changed',
    entityId: APP_ID,
    payload: {},
    userId: null,
    workflowId: WORKFLOW_ID,
  };
}

describe('executeAction — human-oversight-gate', () => {
  it('expliciet reject-actietype wordt een voorstel, geen uitvoering', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/FROM applications/i.test(sql)) {
          return {
            rows: [{ id: APP_ID, job_id: JOB_ID, candidate_id: CANDIDATE_ID }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO ai_action_proposals/i.test(sql)) {
          return { rows: [{ id: PROPOSAL_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const action = { type: 'reject', config: {} } as unknown as WorkflowAction;
    await executeAction(action, buildCtx(client));

    expect(callsMatching(client, /INSERT INTO ai_action_proposals/i)).toHaveLength(1);
    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(0);
  });

  it('move_to_stage naar rejection-stage → voorstel, geen UPDATE', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/FROM applications/i.test(sql)) {
          return {
            rows: [{ id: APP_ID, job_id: JOB_ID, candidate_id: CANDIDATE_ID }],
            rowCount: 1,
          };
        }
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: STAGE_ID, name: 'Afgewezen' }], rowCount: 1 };
        }
        if (/INSERT INTO ai_action_proposals/i.test(sql)) {
          return { rows: [{ id: PROPOSAL_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const action = {
      type: 'move_to_stage',
      config: { stage_id: STAGE_ID },
    } as unknown as WorkflowAction;
    await executeAction(action, buildCtx(client));

    expect(callsMatching(client, /INSERT INTO ai_action_proposals/i)).toHaveLength(1);
    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(0);
  });

  it('move_to_stage naar normale stage wordt gewoon uitgevoerd', async () => {
    const client = mockClient({
      __matcher: (sql: string) => {
        if (/FROM applications/i.test(sql)) {
          return {
            rows: [{ id: APP_ID, job_id: JOB_ID, candidate_id: CANDIDATE_ID }],
            rowCount: 1,
          };
        }
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: STAGE_ID, name: 'Interview' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const action = {
      type: 'move_to_stage',
      config: { stage_id: STAGE_ID },
    } as unknown as WorkflowAction;
    await executeAction(action, buildCtx(client));

    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(1);
    expect(callsMatching(client, /INSERT INTO ai_action_proposals/i)).toHaveLength(0);
  });

  it('gated actie zonder resolvable application is een no-op (geen throw)', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });

    const action = { type: 'reject', config: {} } as unknown as WorkflowAction;
    await executeAction(action, {
      ...buildCtx(client),
      event: 'candidate.created', // entityId is dan geen application_id
      payload: {}, // en payload.application_id ontbreekt
    });

    expect(callsMatching(client, /INSERT INTO ai_action_proposals/i)).toHaveLength(0);
  });
});

// ─── decideAiActionProposal ──────────────────────────────────────────────────

describe('decideAiActionProposal', () => {
  let teardown: (() => void) | null = null;

  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  function installDecideMock(opts: {
    proposal: AiActionProposalRow | null;
    appExists?: boolean;
  }): MockClient {
    const client = mockClient({
      __matcher: (sql: string, params: unknown[]) => {
        if (/FROM ai_action_proposals/i.test(sql) && /FOR UPDATE/i.test(sql)) {
          return opts.proposal
            ? { rows: [opts.proposal], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (/UPDATE ai_action_proposals/i.test(sql)) {
          return {
            rows: [
              {
                ...basePendingProposal(),
                status: params[0],
                decided_by: params[1],
                decision_note: params[2],
                decided_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM applications/i.test(sql)) {
          return opts.appExists !== false
            ? {
                rows: [
                  {
                    id: APP_ID,
                    job_id: JOB_ID,
                    stage_id: 'old-stage',
                    status: 'active',
                    candidate_id: CANDIDATE_ID,
                  },
                ],
                rowCount: 1,
              }
            : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    return client;
  }

  it('approve voert de stage-move uit en logt de beslissing', async () => {
    const client = installDecideMock({ proposal: basePendingProposal() });

    const result = await decideAiActionProposal(
      TENANT_ID,
      PROPOSAL_ID,
      USER_ID,
      'approve',
      'akkoord'
    );

    expect(result.executed).toBe(true);
    expect(result.proposal.status).toBe('approved');
    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(1);
    expect(callsMatching(client, /INSERT INTO activities/i)).toHaveLength(1);

    const audits = client.query.mock.calls.filter((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audits).toHaveLength(1);
    expect(audits[0][1]).toContain(AuditActions.AI_PROPOSAL_APPROVED);
    expect(audits[0][1]).toContain(USER_ID);
  });

  it('reject voert NIETS uit en logt de beslissing', async () => {
    const client = installDecideMock({ proposal: basePendingProposal() });

    const result = await decideAiActionProposal(
      TENANT_ID,
      PROPOSAL_ID,
      USER_ID,
      'reject',
      'onterecht'
    );

    expect(result.executed).toBe(false);
    expect(result.proposal.status).toBe('rejected');
    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(0);
    expect(callsMatching(client, /INSERT INTO activities/i)).toHaveLength(0);

    const audits = client.query.mock.calls.filter((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audits).toHaveLength(1);
    expect(audits[0][1]).toContain(AuditActions.AI_PROPOSAL_REJECTED);
  });

  it('approve op verdwenen doel markeert het voorstel als failed', async () => {
    const client = installDecideMock({
      proposal: basePendingProposal(),
      appExists: false,
    });

    const result = await decideAiActionProposal(
      TENANT_ID,
      PROPOSAL_ID,
      USER_ID,
      'approve'
    );

    expect(result.executed).toBe(false);
    expect(result.proposal.status).toBe('failed');
    expect(callsMatching(client, /UPDATE applications/i)).toHaveLength(0);
  });

  it('gooit 404 bij onbekend voorstel', async () => {
    installDecideMock({ proposal: null });

    await expect(
      decideAiActionProposal(TENANT_ID, PROPOSAL_ID, USER_ID, 'approve')
    ).rejects.toMatchObject({ statusCode: 404, code: 'AI_PROPOSAL_NOT_FOUND' });
  });

  it('gooit 409 bij al-beoordeeld voorstel', async () => {
    installDecideMock({
      proposal: basePendingProposal({ status: 'approved' }),
    });

    const err = await decideAiActionProposal(
      TENANT_ID,
      PROPOSAL_ID,
      USER_ID,
      'reject'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
    expect((err as AppError).code).toBe('AI_PROPOSAL_ALREADY_DECIDED');
  });
});
