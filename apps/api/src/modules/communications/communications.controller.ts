import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as communicationsService from './communications.service';
import * as bulkCampaignService from './bulkCampaign.service';
import { AppError } from '../../middleware/errorHandler';

// ─── Schemas ────────────────────────────────────────────────────────────────

const inboxQuerySchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'sms']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const sendEmailSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
});

const enqueueEmailSchema = z.object({
  candidate_id: z.string().uuid(),
  template_id: z.string().uuid().optional(),
  subject: z.string().min(1).max(500),
  body_html: z.string().min(1),
  body_text: z.string().optional(),
});

const sendWhatsAppSchema = z.object({
  body: z.string().min(1),
});

const sendSmsSchema = z.object({
  body: z.string().min(1).max(1600),
});

// ─── Bulk-campaign schemas ──────────────────────────────────────────────────

const bulkCampaignSchema = z
  .object({
    candidate_ids: z.array(z.string().uuid()).min(1).max(5000),
    subject: z.string().min(1).max(500),
    body_html: z.string().min(1),
    template_id: z.string().uuid().optional(),
    via: z.enum(['resend', 'mailbox_integration']),
    mailbox_integration_id: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.via !== 'mailbox_integration' || Boolean(v.mailbox_integration_id),
    {
      message: 'mailbox_integration_id is verplicht bij via=mailbox_integration',
      path: ['mailbox_integration_id'],
    }
  );

const bulkCampaignsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const campaignIdParam = z.object({
  id: z.string().uuid(),
});

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function getCandidateCommunications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { candidateId } = req.params;
    if (!candidateId) {
      throw new AppError(400, 'MISSING_CANDIDATE_ID', 'candidateId is verplicht');
    }
    const records = await communicationsService.getCandidateCommunications(
      req.user!.tenantId,
      candidateId
    );
    res.json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function getInbox(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = inboxQuerySchema.parse(req.query);
    const records = await communicationsService.getInbox(req.user!.tenantId, {
      channel: query.channel,
      limit: query.limit,
    });
    res.json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function sendEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { candidateId } = req.params;
    if (!candidateId) {
      throw new AppError(400, 'MISSING_CANDIDATE_ID', 'candidateId is verplicht');
    }
    const { subject, body } = sendEmailSchema.parse(req.body);
    const record = await communicationsService.sendMessage(
      req.user!.tenantId,
      req.user!.userId,
      { candidate_id: candidateId, channel: 'email', subject, body }
    );
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

/**
 * Generic transactional email endpoint used by ComposeEmailModal in the
 * dashboard. Accepts the SendEmailInput shape from the shared types and
 * enqueues delivery via the BullMQ emailSenderQueue.
 */
export async function enqueueEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = enqueueEmailSchema.parse(req.body);
    const record = await communicationsService.enqueueOutboundEmail(
      req.user!.tenantId,
      req.user!.userId,
      input
    );
    res.status(202).json({ data: record });
  } catch (err) {
    next(err);
  }
}

export async function sendWhatsApp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { candidateId } = req.params;
    if (!candidateId) {
      throw new AppError(400, 'MISSING_CANDIDATE_ID', 'candidateId is verplicht');
    }
    const { body } = sendWhatsAppSchema.parse(req.body);
    const record = await communicationsService.sendMessage(
      req.user!.tenantId,
      req.user!.userId,
      { candidate_id: candidateId, channel: 'whatsapp', body }
    );
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function sendSms(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { candidateId } = req.params;
    if (!candidateId) {
      throw new AppError(400, 'MISSING_CANDIDATE_ID', 'candidateId is verplicht');
    }
    const { body } = sendSmsSchema.parse(req.body);
    const record = await communicationsService.sendMessage(
      req.user!.tenantId,
      req.user!.userId,
      { candidate_id: candidateId, channel: 'sms', body }
    );
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

// ─── Bulk-campaign handlers ─────────────────────────────────────────────────

export async function startBulkCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = bulkCampaignSchema.parse(req.body);
    const result = await bulkCampaignService.startBulkCampaign(
      req.user!.tenantId,
      req.user!.userId,
      input
    );
    res.status(202).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function listBulkCampaignsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = bulkCampaignsListQuery.parse(req.query);
    const records = await bulkCampaignService.listBulkCampaigns(
      req.user!.tenantId,
      query.limit
    );
    res.json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function getBulkCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = campaignIdParam.parse(req.params);
    const record = await bulkCampaignService.getBulkCampaign(req.user!.tenantId, id);
    res.json({ data: record });
  } catch (err) {
    next(err);
  }
}
