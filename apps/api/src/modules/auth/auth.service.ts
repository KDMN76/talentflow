import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { AppError } from '../../middleware/errorHandler';
import { withAuthTx, withTenant } from '../../db/pool';
import { JwtPayload } from '../../middleware/auth';
import { emailSenderQueue } from '../../queue/queues';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;
// Partial token tijdens 2FA-step is kortlevend zodat een onderschept partial
// token niet ver komt — 5 minuten is genoeg voor een gebruiker om 'm naar
// z'n authenticator te halen en terug te plakken.
const PARTIAL_TOKEN_TTL = '5m';
const PARTIAL_TOKEN_AUDIENCE = 'tflw:partial-2fa';

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

function getRefreshSecret(): string {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s) throw new Error('JWT_REFRESH_SECRET not configured');
  return s;
}

function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export interface RegisterInput {
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
  tenantSlug: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
  };
}

/**
 * Resultaat van login wanneer 2FA verplicht is. De partial-token is een
 * korte JWT met alleen userId+tenantId+aud="tflw:partial-2fa". De client
 * gebruikt deze in een vervolg-call naar /api/auth/2fa/verify.
 */
export interface TwoFactorChallenge {
  requires_2fa: true;
  partial_token: string;
}

export type LoginResult = AuthResult | TwoFactorChallenge;

export interface PartialTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  aud: string;
}

export function generatePartialToken(p: Omit<PartialTokenPayload, 'aud'>): string {
  return jwt.sign(
    { ...p, aud: PARTIAL_TOKEN_AUDIENCE },
    getJwtSecret(),
    { expiresIn: PARTIAL_TOKEN_TTL }
  );
}

export function verifyPartialToken(token: string): PartialTokenPayload {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      audience: PARTIAL_TOKEN_AUDIENCE,
    }) as PartialTokenPayload;
    if (decoded.aud !== PARTIAL_TOKEN_AUDIENCE) {
      throw new AppError(401, 'INVALID_PARTIAL_TOKEN', 'Ongeldig partial-token');
    }
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'PARTIAL_TOKEN_EXPIRED', 'Partial-token is verlopen');
    }
    throw new AppError(401, 'INVALID_PARTIAL_TOKEN', 'Ongeldig partial-token');
  }
}

export async function issueSessionForUser(
  userId: string,
  tenantId: string,
  email: string,
  role: string,
  name: string,
  ctx: AuditContext = {}
): Promise<AuthResult> {
  return withAuthTx(async (client: PoolClient) => {
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()`,
      [userId]
    );
    const refreshTokenRaw = generateRefreshToken();
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshTokenRaw)
      .digest('hex');
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    );
    await client.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, tenantId, refreshTokenHash, expiresAt]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.USER_LOGGED_IN,
        entityType: 'user',
        entityId: userId,
        after: { email, role, post_2fa: true },
        userId,
      },
      ctx
    );
    return {
      accessToken: generateAccessToken({ userId, tenantId, email, role }),
      refreshToken: refreshTokenRaw,
      user: { id: userId, email, name, role, tenantId },
    };
  });
}

export async function register(
  input: RegisterInput,
  ctx: AuditContext = {}
): Promise<AuthResult> {
  return withAuthTx(async (client: PoolClient) => {
    // Check slug uniqueness
    const { rows: existingTenants } = await client.query(
      'SELECT id FROM tenants WHERE slug = $1',
      [input.tenantSlug]
    );
    if (existingTenants.length > 0) {
      throw new AppError(409, 'SLUG_TAKEN', 'Deze slug is al in gebruik');
    }

    // Create tenant
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
      [input.tenantName, input.tenantSlug]
    );

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    // Set tenant context for RLS compliance on users table.
    // tenant.id was just inserted by us (UUID generated by DB), so it is safe.
    await client.query(`SET LOCAL app.tenant_id = '${tenant.id}'`);

    // Create admin user
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, email, name, role, tenant_id`,
      [tenant.id, input.email.toLowerCase(), passwordHash, input.name]
    );

    const refreshTokenRaw = generateRefreshToken();
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tenant.id, refreshTokenHash, expiresAt]
    );

    // ─── Audit-log (Q1.2) ─────────────────────────────────────────────
    // tenant.created — append-only bewijs dat een nieuwe tenant is
    // aangemaakt, met IP/UA. Loopt binnen dezelfde withoutTenant-client,
    // maar app.tenant_id is hierboven al SET LOCAL gezet zodat de
    // audit_events RLS-policy de INSERT toelaat.
    await logAudit(
      client,
      tenant.id,
      {
        action: AuditActions.TENANT_CREATED,
        entityType: 'tenant',
        entityId: tenant.id,
        after: { name: tenant.name, slug: tenant.slug, admin_user_id: user.id },
        userId: user.id,
      },
      ctx
    );

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: tenant.id,
      },
    };
  });
}

export async function login(
  input: LoginInput,
  ctx: AuditContext = {}
): Promise<LoginResult> {
  return withAuthTx(async (client: PoolClient) => {
    // Find tenant by slug
    const { rows: [tenant] } = await client.query(
      'SELECT id FROM tenants WHERE slug = $1',
      [input.tenantSlug]
    );
    if (!tenant) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Ongeldige inloggegevens');
    }

    // Set tenant context to allow reading from users with RLS.
    // tenant.id comes from DB and was verified by UUID regex; safe to interpolate.
    await client.query(`SET LOCAL app.tenant_id = '${tenant.id}'`);

    // Find user
    const { rows: [user] } = await client.query(
      `SELECT id, email, password_hash, name, role, tenant_id, is_active
       FROM users
       WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, input.email.toLowerCase()]
    );

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Ongeldige inloggegevens');
    }

    if (!user.is_active) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'Dit account is uitgeschakeld');
    }

    const passwordValid = await bcrypt.compare(input.password, user.password_hash);
    if (!passwordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Ongeldige inloggegevens');
    }

    // ─── 2FA challenge — Sprint Q4.2 ──────────────────────────────────────
    // Check of de user 2FA aan heeft staan. Zo ja: return een partial-token
    // i.p.v. full session — frontend stuurt vervolgens TOTP-code naar
    // /api/auth/2fa/verify om de echte tokens te krijgen.
    const { rows: twoFa } = await client.query<{ enabled: boolean }>(
      'SELECT enabled FROM user_2fa_secrets WHERE user_id = $1',
      [user.id]
    );
    if (twoFa[0]?.enabled) {
      const partialToken = generatePartialToken({
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        role: user.role,
      });
      return {
        requires_2fa: true,
        partial_token: partialToken,
      } as TwoFactorChallenge;
    }

    // Delete expired refresh tokens for this user
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()`,
      [user.id]
    );

    const refreshTokenRaw = generateRefreshToken();
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tenant.id, refreshTokenHash, expiresAt]
    );

    // ─── Audit-log (Q1.2) ─────────────────────────────────────────────
    // user.logged_in — IP + UA worden via ctx meegegeven door de controller.
    await logAudit(
      client,
      tenant.id,
      {
        action: AuditActions.USER_LOGGED_IN,
        entityType: 'user',
        entityId: user.id,
        after: { email: user.email, role: user.role },
        userId: user.id,
      },
      ctx
    );

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: generateAccessToken(payload),
      refreshToken: refreshTokenRaw,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: tenant.id,
      },
    };
  });
}

/**
 * Refresh mét token-rotatie + reuse-detectie (Fase 0.5).
 *
 * - Elke refresh-token is single-use: bij gebruik wordt hij gemarkeerd als
 *   geroteerd en vervangen door een nieuwe (sliding 7-dagen-window).
 * - Wordt een al-geroteerde token nógmaals aangeboden, dan is dat een
 *   replay-/diefstalsignaal: alle refresh-tokens van die gebruiker worden
 *   ingetrokken (alle sessies uitgelogd) en het incident wordt ge-audit-logd.
 * - De rotatie-markering gebeurt met `WHERE rotated_at IS NULL ... RETURNING`
 *   zodat twee gelijktijdige refreshes met dezelfde token er hooguit één
 *   laten slagen (race-veilig zonder expliciete lock).
 */
export async function refreshAccessToken(
  refreshTokenRaw: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

  // Stap 1 — opzoeken op secret hash. Dit kan per definitie geen tenant-context
  // hebben (de hash is de enige sleutel), dus draait het in auth_context. Read-only.
  const tokenRecord = await withAuthTx(async (client) => {
    const { rows: [rec] } = await client.query(
      `SELECT rt.id, rt.user_id, rt.tenant_id, rt.expires_at, rt.rotated_at,
              u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );
    return rec ?? null;
  }, { authContext: true });

  if (!tokenRecord) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Ongeldig refresh token');
  }

  // Vanaf hier kennen we de tenant; alle schrijfacties draaien tenant-scoped
  // (withTenant zet app.tenant_id binnen een eigen transactie). Elke transactie
  // commit zelfstandig — daarom blijft de reuse-revoke bewaard óók al gooien we
  // daarna een 401 (geen commit-before-throw nodig).
  const tenantId: string = tokenRecord.tenant_id;

  if (tokenRecord.rotated_at) {
    // Replay van een ingewisselde token → trek alles van deze user in.
    await withTenant(tenantId, async (client) => {
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [
        tokenRecord.user_id,
      ]);
      await logAudit(client, tenantId, {
        action: AuditActions.REFRESH_TOKEN_REUSE_DETECTED,
        entityType: 'user',
        entityId: tokenRecord.user_id,
        after: { revoked_all_sessions: true },
        userId: tokenRecord.user_id,
      });
    });
    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token is al gebruikt — alle sessies zijn uit voorzorg beëindigd'
    );
  }

  if (new Date(tokenRecord.expires_at) < new Date()) {
    await withTenant(tenantId, (client) =>
      client.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenRecord.id])
    );
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token is verlopen');
  }

  if (!tokenRecord.is_active) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'Dit account is uitgeschakeld');
  }

  // Stap 2 — roteer atomair binnen één tenant-transactie: markeer de oude
  // race-veilig (WHERE rotated_at IS NULL ... RETURNING), insert de nieuwe,
  // ruim verlopen rijen op.
  const newTokenRaw = generateRefreshToken();
  const newTokenHash = crypto.createHash('sha256').update(newTokenRaw).digest('hex');
  const newExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const rotation = await withTenant(tenantId, async (client) => {
    const { rows: rotated } = await client.query(
      `UPDATE refresh_tokens
         SET rotated_at = now(), replaced_by_hash = $2
       WHERE id = $1 AND rotated_at IS NULL
       RETURNING id`,
      [tokenRecord.id, newTokenHash]
    );
    if (rotated.length === 0) {
      // Verloren race: een parallelle refresh was ons net voor → behandel als
      // reuse (dezelfde token is twee keer aangeboden).
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [
        tokenRecord.user_id,
      ]);
      return { reused: true };
    }
    await client.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenRecord.user_id, tenantId, newTokenHash, newExpiresAt]
    );
    // Opportunistische opschoning van verlopen (incl. geroteerde) rijen.
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()`,
      [tokenRecord.user_id]
    );
    return { reused: false };
  });

  if (rotation.reused) {
    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token is al gebruikt — alle sessies zijn uit voorzorg beëindigd'
    );
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    userId: tokenRecord.user_id,
    tenantId,
    email: tokenRecord.email,
    role: tokenRecord.role,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: newTokenRaw,
  };
}

export async function logout(refreshTokenRaw: string): Promise<void> {
  // auth_context: verwijdert op token_hash zonder tenant-context (de DELETE
  // moet de rij kunnen zien ongeacht welke tenant 'm bezit).
  return withAuthTx(async (client: PoolClient) => {
    const tokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
    await client.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  }, { authContext: true });
}

export async function forgotPassword(email: string, tenantSlug: string): Promise<void> {
  // Phase 1 stub — queue an email but don't actually send it
  await emailSenderQueue.add('forgot-password', {
    to: email,
    subject: 'Wachtwoord opnieuw instellen — TalentFlow',
    body: `Er is een verzoek ontvangen om uw wachtwoord opnieuw in te stellen voor tenant ${tenantSlug}. (Stub: niet geïmplementeerd in Phase 1)`,
  });
}

/**
 * Accept-invite: wissel een single-use invite-token in voor een actieve sessie.
 *
 * Dit is de ontbrekende schakel die de invite-flow heel maakt: inviteUser maakt
 * de user is_active=false en mailt een token; hier wordt het wachtwoord gezet
 * ÉN is_active=true geflipt, waarna de gebruiker direct ingelogd is.
 *
 * Lookup op token_hash gebeurt via auth_context (de hash is de enige sleutel,
 * geen tenant-context). De consume is race-veilig: `WHERE consumed_at IS NULL`
 * met RETURNING, zodat twee parallelle accepts er hooguit één laten slagen.
 */
export async function acceptInvite(
  token: string,
  newPassword: string,
  ctx: AuditContext = {}
): Promise<AuthResult> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // 1) Token opzoeken op hash (geen tenant-context).
  const rec = await withAuthTx(async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT it.id AS token_id, it.tenant_id, it.user_id,
              it.expires_at, it.consumed_at,
              u.email, u.role, u.name
         FROM user_invite_tokens it
         JOIN users u ON u.id = it.user_id
        WHERE it.token_hash = $1`,
      [tokenHash]
    );
    return row ?? null;
  }, { authContext: true });

  if (!rec) {
    throw new AppError(404, 'INVALID_INVITE_TOKEN', 'Uitnodiging niet gevonden');
  }
  if (rec.consumed_at) {
    throw new AppError(409, 'INVITE_ALREADY_USED', 'Deze uitnodiging is al gebruikt');
  }
  if (new Date(rec.expires_at) < new Date()) {
    throw new AppError(410, 'INVITE_EXPIRED', 'Deze uitnodiging is verlopen');
  }

  const tenantId: string = rec.tenant_id;
  const userId: string = rec.user_id;
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // 2) Token consumeren + user activeren binnen tenant-context (atomair).
  await withTenant(tenantId, async (client) => {
    const consumed = await client.query(
      `UPDATE user_invite_tokens
          SET consumed_at = now()
        WHERE id = $1 AND tenant_id = $2 AND consumed_at IS NULL AND expires_at > now()`,
      [rec.token_id, tenantId]
    );
    if (consumed.rowCount === 0) {
      // Race: tussen lookup en hier alsnog geconsumeerd/verlopen.
      throw new AppError(409, 'INVITE_ALREADY_USED', 'Deze uitnodiging is al gebruikt');
    }
    await client.query(
      `UPDATE users
          SET password_hash = $1, is_active = true
        WHERE id = $2 AND tenant_id = $3`,
      [passwordHash, userId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.USER_INVITED,
        entityType: 'user',
        entityId: userId,
        after: { accepted_invite: true, email: rec.email },
        userId,
      },
      ctx
    );
  });

  // 3) Direct inloggen — hergebruikt de bestaande sessie-uitgifte.
  return issueSessionForUser(userId, tenantId, rec.email, rec.role, rec.name, ctx);
}

export function signRefreshJwt(refreshToken: string): string {
  return jwt.sign({ token: refreshToken }, getRefreshSecret(), {
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
}
