import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';

const SALT_ROUNDS = 12;
const INVITE_TTL_DAYS = 7;

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listUsers(
  tenantId: string,
  page: number,
  limit: number
): Promise<{ data: UserListItem[]; meta: { total: number; page: number; limit: number; pages: number } }> {
  return withTenant(tenantId, async (client) => {
    const offset = (page - 1) * limit;

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as total FROM users WHERE tenant_id = $1`,
      [tenantId]
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await client.query(
      `SELECT id, email, name, role, avatar_url, is_active, created_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );

    return {
      data: rows,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  });
}

export async function inviteUser(
  tenantId: string,
  invitedBy: string,
  data: { email: string; name: string; role: string }
): Promise<UserListItem> {
  return withTenant(tenantId, async (client) => {
    const email = data.email.toLowerCase();

    // Bestaat de user al? Een ACTIEF lid = echt al in gebruik → 409. Een
    // nog-inactieve (uitgenodigde, niet-geaccepteerde) user mag opnieuw worden
    // uitgenodigd: we hergebruiken de rij en geven een vers token uit.
    const { rows: existing } = await client.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email]
    );
    if (existing.length > 0 && existing[0].is_active) {
      throw new AppError(409, 'USER_ALREADY_EXISTS', 'Dit e-mailadres is al in gebruik');
    }

    // Single-use invite-token: alleen de sha256-hash wordt opgeslagen; de raw
    // token zit enkel in de uitnodigingsmail (accept-invite-link).
    const inviteToken = crypto.randomBytes(32).toString('base64url');
    const inviteTokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    let user: UserListItem;
    if (existing.length > 0) {
      // Re-invite van een inactieve user: naam/rol bijwerken + oude tokens
      // intrekken zodat alleen het nieuwste token geldig is.
      const { rows: [u] } = await client.query(
        `UPDATE users SET name = $3, role = $4
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, email, name, role, avatar_url, is_active, created_at`,
        [existing[0].id, tenantId, data.name, data.role]
      );
      user = u;
      await client.query(
        `UPDATE user_invite_tokens SET consumed_at = now()
          WHERE user_id = $1 AND tenant_id = $2 AND consumed_at IS NULL`,
        [existing[0].id, tenantId]
      );
    } else {
      // Nieuwe user: inactief + niet-loginnbare placeholder-hash (random, nooit
      // gecommuniceerd). Het echte wachtwoord wordt pas gezet bij accept-invite.
      const placeholder = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        SALT_ROUNDS
      );
      const { rows: [u] } = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, email, name, role, avatar_url, is_active, created_at`,
        [tenantId, email, placeholder, data.name, data.role]
      );
      user = u;
    }

    await client.query(
      `INSERT INTO user_invite_tokens (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, user.id, inviteTokenHash, expiresAt]
    );

    const baseUrl = process.env.PUBLIC_APP_URL ?? 'https://talentflow.kdmn.nl';
    await emailSenderQueue.add('user-invitation', {
      to: user.email,
      subject: 'Uitnodiging voor TalentFlow',
      body:
        `U bent uitgenodigd door ${invitedBy} voor TalentFlow. ` +
        `Stel uw wachtwoord in via: ${baseUrl}/accept-invite?token=${inviteToken} ` +
        `(deze link verloopt over ${INVITE_TTL_DAYS} dagen).`,
    });

    return user;
  });
}

export async function updateUser(
  tenantId: string,
  userId: string,
  requesterId: string,
  requesterRole: string,
  data: { name?: string; role?: string; avatar_url?: string | null }
): Promise<UserListItem> {
  return withTenant(tenantId, async (client) => {
    // Only admin can change roles; users can only update themselves
    if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
      if (requesterId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Onvoldoende rechten');
      }
      if (data.role !== undefined) {
        throw new AppError(403, 'FORBIDDEN', 'Rol wijzigen is alleen voor admins');
      }
    }

    const { rows: [existing] } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.role !== undefined) { fields.push(`role = $${idx++}`); values.push(data.role); }
    if (data.avatar_url !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(data.avatar_url); }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(userId, tenantId);

    const { rows: [user] } = await client.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, email, name, role, avatar_url, is_active, created_at`,
      values
    );

    return user;
  });
}

export async function deactivateUser(
  tenantId: string,
  userId: string,
  requesterId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    if (userId === requesterId) {
      throw new AppError(400, 'CANNOT_DEACTIVATE_SELF', 'U kunt uw eigen account niet deactiveren');
    }

    const { rows: [user] } = await client.query(
      `UPDATE users SET is_active = false
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [userId, tenantId]
    );

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    // Invalidate refresh tokens
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );
  });
}

export async function getMe(tenantId: string, userId: string) {
  return withTenant(tenantId, async (client) => {
    // `language` (eigen voorkeur, NULL = erven) + `tenant_default_language`
    // zodat de frontend de taal kan resolven: user → tenant → browser → nl.
    const { rows: [user] } = await client.query(
      `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.is_active,
              u.created_at, u.language,
              t.default_language AS tenant_default_language
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, tenantId]
    );

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    return user;
  });
}

export async function updateMe(
  tenantId: string,
  userId: string,
  data: { name?: string; avatar_url?: string | null; password?: string; language?: string | null }
): Promise<UserListItem> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.avatar_url !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(data.avatar_url); }
    // NULL is een geldige waarde: "geen eigen voorkeur, erf de tenant-default".
    if (data.language !== undefined) { fields.push(`language = $${idx++}`); values.push(data.language); }
    if (data.password !== undefined) {
      const hash = await bcrypt.hash(data.password, SALT_ROUNDS);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    values.push(userId, tenantId);

    const { rows: [user] } = await client.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, email, name, role, avatar_url, is_active, created_at, language`,
      values
    );

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    return user;
  });
}
