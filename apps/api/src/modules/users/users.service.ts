import bcrypt from 'bcrypt';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { emailSenderQueue } from '../../queue/queues';

const SALT_ROUNDS = 12;

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
    // Check if user already exists
    const { rows: existing } = await client.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenantId, data.email.toLowerCase()]
    );
    if (existing.length > 0) {
      throw new AppError(409, 'USER_ALREADY_EXISTS', 'Dit e-mailadres is al in gebruik');
    }

    // Create inactive user with a temporary password
    const tempPassword = Math.random().toString(36).slice(-12) + 'Tf1!';
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id, email, name, role, avatar_url, is_active, created_at`,
      [tenantId, data.email.toLowerCase(), passwordHash, data.name, data.role]
    );

    // Queue invitation email (stub)
    await emailSenderQueue.add('user-invitation', {
      to: data.email,
      subject: 'Uitnodiging voor TalentFlow',
      body: `U bent uitgenodigd door ${invitedBy}. Uw tijdelijk wachtwoord is: ${tempPassword}. Wijzig dit na uw eerste inlog.`,
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
    const { rows: [user] } = await client.query(
      `SELECT id, email, name, role, avatar_url, is_active, created_at
       FROM users WHERE id = $1 AND tenant_id = $2`,
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
  data: { name?: string; avatar_url?: string | null; password?: string }
): Promise<UserListItem> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.avatar_url !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(data.avatar_url); }
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
       RETURNING id, email, name, role, avatar_url, is_active, created_at`,
      values
    );

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Gebruiker niet gevonden');
    }

    return user;
  });
}
