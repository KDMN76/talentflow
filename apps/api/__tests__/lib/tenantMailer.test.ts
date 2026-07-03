/**
 * tenantMailer.ts — transportkeuze per tenant.
 *
 * Beslisboom onder test:
 *   1. geen tenantId                → globaal Resend-pad (sendEmail, from onaangeroerd)
 *   2. geen settings-rij            → Resend met globale default-from
 *   3. from_name gezet, SMTP uit    → Resend met "Naam <globaal adres>"
 *   4. reply_to gezet               → wint van de meegegeven (plus-addressing) replyTo
 *   5. SMTP enabled                 → nodemailer, Resend NIET aangeraakt
 *   6. SMTP-fout                    → rejectie bubbelt op (nette BullMQ job-failure)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTenantEmail, formatFrom } from '../../src/lib/tenantMailer';
import { sendEmail } from '../../src/lib/emailService';
import { getTenantSendSettings } from '../../src/modules/tenants/emailSettings.service';
import nodemailer from 'nodemailer';

vi.mock('../../src/lib/emailService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/emailService')>();
  return {
    ...actual,
    getDefaultFrom: vi.fn(() => 'TalentFlow <no-reply@send.kdmn.nl>'),
    sendEmail: vi.fn(async () => ({
      messageId: 'resend-id',
      provider: 'resend' as const,
    })),
  };
});

vi.mock('../../src/modules/tenants/emailSettings.service', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/modules/tenants/emailSettings.service')
  >();
  return {
    ...actual,
    getTenantSendSettings: vi.fn(async () => null),
  };
});

// vi.mock wordt gehoist — de gedeelde sendMail-spy dus ook via vi.hoisted.
const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async (_opts?: unknown) => ({ messageId: 'smtp-id' })),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
      close: vi.fn(),
    })),
  },
}));

const sendEmailMock = vi.mocked(sendEmail);
const settingsMock = vi.mocked(getTenantSendSettings);
const createTransportMock = vi.mocked(nodemailer.createTransport);

const TENANT = '11111111-1111-1111-1111-111111111111';

const baseParams = {
  to: 'kandidaat@example.nl',
  subject: 'Hallo',
  html: '<p>Hallo</p>',
};

beforeEach(() => {
  vi.clearAllMocks();
  sendMailMock.mockResolvedValue({ messageId: 'smtp-id' });
  settingsMock.mockResolvedValue(null);
});

describe('sendTenantEmail — transportkeuze', () => {
  it('geen tenantId → direct globaal Resend-pad, settings niet geraadpleegd', async () => {
    const result = await sendTenantEmail(null, baseParams);

    expect(settingsMock).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledWith(baseParams);
    expect(result.provider).toBe('resend');
  });

  it('geen settings-rij → Resend met default-from (from undefined)', async () => {
    await sendTenantEmail(TENANT, baseParams);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.from).toBeUndefined();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('from_name gezet + SMTP uit → Resend met per-tenant afzendernaam op het globale adres', async () => {
    settingsMock.mockResolvedValue({
      fromName: 'IT Proposal',
      replyTo: null,
      smtp: null,
    });

    await sendTenantEmail(TENANT, baseParams);

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.from).toBe('IT Proposal <no-reply@send.kdmn.nl>');
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('tenant reply_to wint van de meegegeven plus-addressing replyTo', async () => {
    settingsMock.mockResolvedValue({
      fromName: null,
      replyTo: 'info@itproposal.be',
      smtp: null,
    });

    await sendTenantEmail(TENANT, {
      ...baseParams,
      replyTo: 'reply+tenant+thread@reply.talentflow.app',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.replyTo).toBe('info@itproposal.be');
  });

  it('zonder tenant reply_to blijft de meegegeven replyTo staan', async () => {
    settingsMock.mockResolvedValue({ fromName: null, replyTo: null, smtp: null });

    await sendTenantEmail(TENANT, {
      ...baseParams,
      replyTo: 'reply+tenant+thread@reply.talentflow.app',
    });

    const call = sendEmailMock.mock.calls[0][0];
    expect(call.replyTo).toBe('reply+tenant+thread@reply.talentflow.app');
  });

  it('SMTP enabled → nodemailer-transport, Resend niet aangeraakt', async () => {
    settingsMock.mockResolvedValue({
      fromName: 'IT Proposal',
      replyTo: 'info@itproposal.be',
      smtp: {
        host: 'smtp.itproposal.be',
        port: 465,
        secure: true,
        user: 'mailer@itproposal.be',
        pass: 'sm4p-geheim',
        from: 'no-reply@itproposal.be',
      },
    });

    const result = await sendTenantEmail(TENANT, baseParams);

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.itproposal.be',
        port: 465,
        secure: true,
        auth: { user: 'mailer@itproposal.be', pass: 'sm4p-geheim' },
      })
    );
    const mail = sendMailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mail.from).toBe('IT Proposal <no-reply@itproposal.be>');
    expect(mail.replyTo).toBe('info@itproposal.be');
    expect(result).toEqual({ messageId: 'smtp-id', provider: 'smtp' });
  });

  it('SMTP zonder expliciete poort → 587 bij secure=false', async () => {
    settingsMock.mockResolvedValue({
      fromName: null,
      replyTo: null,
      smtp: {
        host: 'smtp.example.com',
        port: null,
        secure: false,
        user: null,
        pass: null,
        from: 'x@example.com',
      },
    });

    await sendTenantEmail(TENANT, baseParams);

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, auth: undefined })
    );
  });

  it('SMTP-fout → rejectie bubbelt op (job-failure) zonder wachtwoord in de melding', async () => {
    settingsMock.mockResolvedValue({
      fromName: null,
      replyTo: null,
      smtp: {
        host: 'smtp.kapot.example',
        port: 465,
        secure: true,
        user: 'user',
        pass: 'super-geheim-wachtwoord',
        from: null,
      },
    });
    sendMailMock.mockRejectedValue(new Error('535 Authentication failed'));

    await expect(sendTenantEmail(TENANT, baseParams)).rejects.toThrow(
      /Tenant-SMTP fout \(smtp\.kapot\.example\): 535 Authentication failed/
    );
    await expect(
      sendTenantEmail(TENANT, baseParams)
    ).rejects.not.toThrow(/super-geheim-wachtwoord/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('formatFrom — header-sanitatie', () => {
  it('bouwt "Naam <adres>"', () => {
    expect(formatFrom('IT Proposal', 'no-reply@send.kdmn.nl')).toBe(
      'IT Proposal <no-reply@send.kdmn.nl>'
    );
  });

  it('valt terug op kaal adres zonder naam', () => {
    expect(formatFrom(null, 'a@b.nl')).toBe('a@b.nl');
    expect(formatFrom('   ', 'a@b.nl')).toBe('a@b.nl');
  });

  it('strip quotes, angle-brackets en newlines (header-injectie)', () => {
    expect(formatFrom('Evil"<x@y.z>\r\nBcc: hacker', 'a@b.nl')).toBe(
      'Evilx@y.zBcc: hacker <a@b.nl>'
    );
  });
});

// ─── SSRF-guard: assertSafeSmtpTarget ────────────────────────────────────────

import { assertSafeSmtpTarget } from '../../src/lib/tenantMailer';

describe('assertSafeSmtpTarget — SSRF-guard', () => {
  it('accepteert publieke SMTP-hosts op toegestane poorten', () => {
    expect(() => assertSafeSmtpTarget('smtp.gmail.com', 587)).not.toThrow();
    expect(() => assertSafeSmtpTarget('mail.itproposal.be', 465)).not.toThrow();
    expect(() => assertSafeSmtpTarget('smtp-relay.example.io', 25)).not.toThrow();
    expect(() => assertSafeSmtpTarget('smtp.mailgun.org', 2525)).not.toThrow();
    // Zonder poort (defaults 465/587) alleen de host valideren.
    expect(() => assertSafeSmtpTarget('smtp.gmail.com', null)).not.toThrow();
  });

  it('weigert interne/gereserveerde IP-adressen', () => {
    for (const ip of [
      '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255',
      '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    ]) {
      expect(() => assertSafeSmtpTarget(ip, 587), ip).toThrow(/niet toegestaan/);
    }
  });

  it('weigert interne hostnamen (docker-services, localhost, .local/.internal)', () => {
    for (const host of [
      'postgres', 'redis', 'minio', 'localhost', 'db.local',
      'vault.internal', 'nas.lan', 'x.localhost', 'ip6.arpa',
    ]) {
      expect(() => assertSafeSmtpTarget(host, 587), host).toThrow(/niet toegestaan/);
    }
  });

  it('weigert IPv6-literals en niet-SMTP-poorten', () => {
    expect(() => assertSafeSmtpTarget('::1', 587)).toThrow(/IPv6/);
    expect(() => assertSafeSmtpTarget('[fe80::1]', 587)).toThrow(/IPv6/);
    expect(() => assertSafeSmtpTarget('smtp.gmail.com', 5432)).toThrow(/poort/i);
    expect(() => assertSafeSmtpTarget('smtp.gmail.com', 6379)).toThrow(/poort/i);
    expect(() => assertSafeSmtpTarget('smtp.gmail.com', 9000)).toThrow(/poort/i);
  });

  it('normaliseert trailing dot en hoofdletters', () => {
    expect(() => assertSafeSmtpTarget('SMTP.GMAIL.COM.', 587)).not.toThrow();
    expect(() => assertSafeSmtpTarget('LOCALHOST', 587)).toThrow(/niet toegestaan/);
  });
});
