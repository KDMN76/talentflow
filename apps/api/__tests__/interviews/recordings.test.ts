/**
 * Interview recordings service tests — Sprint Q3.4 (Agent CCC).
 *
 * Coverage:
 *   - upload met consent_given=true → INSERT + storage.put + queue.add.
 *   - upload zonder consent → throw 403 CONSENT_REQUIRED, geen storage.put,
 *     geen INSERT.
 *   - oversize file → throw 413.
 *   - delete → storage.delete + DELETE row + audit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// ─── Hoisted mocks: vitest hoists vi.mock to top, dus we plaatsen alle mocks
// die het via closure refereren ook in `vi.hoisted` zodat hun init vóór de
// hoisted vi.mock-fabrieken loopt.

const mocks = vi.hoisted(() => ({
  storagePut: vi.fn(async () => undefined),
  storageDelete: vi.fn(async () => undefined),
  storageGetStream: vi.fn(),
  storageGetUrl: vi.fn(),
  transcriptionQueueAdd: vi.fn(async () => ({ id: 'mock-job' })),
  aiSummaryQueueAdd: vi.fn(async () => ({ id: 'mock-job' })),
  calendarSyncQueueAdd: vi.fn(async () => ({ id: 'mock-job' })),
}));

const {
  storagePut,
  storageDelete,
  storageGetStream,
  storageGetUrl,
  transcriptionQueueAdd,
} = mocks;

vi.mock('../../src/lib/storage', () => ({
  getStorage: () => ({
    put: mocks.storagePut,
    delete: mocks.storageDelete,
    getStream: mocks.storageGetStream,
    getDownloadUrl: mocks.storageGetUrl,
  }),
}));

vi.mock('../../src/queue/queues', () => ({
  redis: {
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 1),
  },
  emailSenderQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  workflowEventsQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  inboxSyncQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  bulkMailQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  interviewTranscriptionQueue: { add: mocks.transcriptionQueueAdd },
  interviewAiSummaryQueue: { add: mocks.aiSummaryQueueAdd },
  interviewCalendarSyncQueue: { add: mocks.calendarSyncQueueAdd },
  interviewRemindersQueue: { add: vi.fn(async () => ({ id: 'm' })) },
}));

import {
  uploadRecording,
  deleteRecording,
} from '../../src/modules/interviews/recordings.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const INTERVIEW_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const RECORDING_ID = '44444444-4444-4444-4444-444444444444';

function fakeAudioFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const buffer = Buffer.from('fake-audio-bytes');
  return {
    fieldname: 'audio',
    originalname: 'interview.webm',
    encoding: '7bit',
    mimetype: 'audio/webm',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
    ...overrides,
  } as Express.Multer.File;
}

describe('recordings.service.uploadRecording', () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    storagePut.mockClear();
    storageDelete.mockClear();
    transcriptionQueueAdd.mockClear();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.clearAllMocks();
  });

  it('happy path — consent_given=true: INSERT row, upload to storage, enqueue transcription job', async () => {
    let insertedSql = '';
    const insertedRow = {
      id: RECORDING_ID,
      tenant_id: TENANT_ID,
      interview_id: INTERVIEW_ID,
      filename: 'interview.webm',
      storage_key: `tenants/${TENANT_ID}/interviews/${INTERVIEW_ID}/recordings/${RECORDING_ID}__interview.webm`,
      mime_type: 'audio/webm',
      duration_seconds: null,
      size_bytes: 16,
      transcript_text: null,
      transcript_language: null,
      transcription_status: 'pending',
      transcription_error: null,
      ai_summary: null,
      ai_strengths: null,
      ai_concerns: null,
      ai_recommendation: null,
      ai_status: 'pending',
      consent_given: true,
      consent_at: new Date().toISOString(),
      uploaded_by: USER_ID,
      uploaded_at: new Date().toISOString(),
      transcribed_at: null,
      ai_processed_at: null,
    };

    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM interviews/i.test(sql)) {
          return { rows: [{ id: INTERVIEW_ID }], rowCount: 1 };
        }
        if (/gen_random_uuid/i.test(sql)) {
          return { rows: [{ new_id: RECORDING_ID }], rowCount: 1 };
        }
        if (/INSERT INTO interview_recordings/i.test(sql)) {
          insertedSql = sql;
          return { rows: [insertedRow], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const file = fakeAudioFile();
    const result = await uploadRecording(
      TENANT_ID,
      INTERVIEW_ID,
      USER_ID,
      file,
      true
    );

    expect(result.id).toBe(RECORDING_ID);
    expect(result.consent_given).toBe(true);
    expect(result.transcription_status).toBe('pending');
    // Storage write happened with the correct tenant-scoped key.
    expect(storagePut).toHaveBeenCalledTimes(1);
    const [keyArg, bufArg, mimeArg] = storagePut.mock.calls[0]!;
    expect(keyArg).toMatch(/^tenants\/.+\/interviews\/.+\/recordings\/.+__interview\.webm$/);
    expect(Buffer.isBuffer(bufArg)).toBe(true);
    expect(mimeArg).toBe('audio/webm');
    // Transcription job enqueued with the new recording id.
    expect(transcriptionQueueAdd).toHaveBeenCalledTimes(1);
    expect(transcriptionQueueAdd).toHaveBeenCalledWith(
      'transcribe-recording',
      { recordingId: RECORDING_ID, tenantId: TENANT_ID }
    );
    expect(insertedSql).toMatch(/INSERT INTO interview_recordings/);
  });

  it('weigert upload zonder consent — geen storage write, geen DB-INSERT, geen queue', async () => {
    const client: MockClient = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const file = fakeAudioFile();
    await expect(
      uploadRecording(TENANT_ID, INTERVIEW_ID, USER_ID, file, false)
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED', statusCode: 403 });

    expect(storagePut).not.toHaveBeenCalled();
    expect(transcriptionQueueAdd).not.toHaveBeenCalled();
    // DB query nooit aangeroepen — withTenant niet eens binnengetreden omdat
    // de consent-check vóór de transactie zit.
    expect(client.query).not.toHaveBeenCalled();
  });

  it('weigert wanneer interview niet bestaat (404)', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM interviews/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      uploadRecording(TENANT_ID, INTERVIEW_ID, USER_ID, fakeAudioFile(), true)
    ).rejects.toMatchObject({ code: 'INTERVIEW_NOT_FOUND', statusCode: 404 });

    // Belangrijk: de service controleert het interview-bestaan vóór de upload,
    // dus storage.put mag NIET zijn aangeroepen.
    expect(storagePut).not.toHaveBeenCalled();
    expect(transcriptionQueueAdd).not.toHaveBeenCalled();
  });

  it('weigert oversize files met 413 FILE_TOO_LARGE', async () => {
    const oversize = fakeAudioFile({
      size: 300 * 1024 * 1024,
      buffer: Buffer.alloc(1), // size-veld is wat de service checkt
    });
    const client = mockClient({});
    teardown = installPoolMock(client);

    await expect(
      uploadRecording(TENANT_ID, INTERVIEW_ID, USER_ID, oversize, true)
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', statusCode: 413 });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it('weigert unsupported mime types met 415', async () => {
    const file = fakeAudioFile({ mimetype: 'video/x-matroska' });
    const client = mockClient({});
    teardown = installPoolMock(client);

    await expect(
      uploadRecording(TENANT_ID, INTERVIEW_ID, USER_ID, file, true)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 });
  });
});

describe('recordings.service.deleteRecording', () => {
  let teardown: (() => void) | null = null;

  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.clearAllMocks();
  });

  it('verwijdert storage-object én DB-rij + schrijft audit', async () => {
    const recRow = {
      id: RECORDING_ID,
      tenant_id: TENANT_ID,
      interview_id: INTERVIEW_ID,
      filename: 'interview.webm',
      storage_key: `tenants/${TENANT_ID}/interviews/${INTERVIEW_ID}/recordings/${RECORDING_ID}__interview.webm`,
      mime_type: 'audio/webm',
      duration_seconds: 60,
      size_bytes: 12345,
      transcript_text: 'hello',
      transcript_language: 'nl',
      transcription_status: 'done',
      transcription_error: null,
      ai_summary: null,
      ai_strengths: null,
      ai_concerns: null,
      ai_recommendation: null,
      ai_status: 'pending',
      consent_given: true,
      consent_at: new Date().toISOString(),
      uploaded_by: USER_ID,
      uploaded_at: new Date().toISOString(),
      transcribed_at: new Date().toISOString(),
      ai_processed_at: null,
    };

    let deleteSql = '';
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT[\s\S]+FROM interview_recordings/i.test(sql)) {
          return { rows: [recRow], rowCount: 1 };
        }
        if (/DELETE FROM interview_recordings/i.test(sql)) {
          deleteSql = sql;
          return { rows: [], rowCount: 1 };
        }
        if (/audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await deleteRecording(TENANT_ID, RECORDING_ID, USER_ID);

    expect(storageDelete).toHaveBeenCalledWith(recRow.storage_key);
    expect(deleteSql).toMatch(/DELETE FROM interview_recordings/);
  });
});
