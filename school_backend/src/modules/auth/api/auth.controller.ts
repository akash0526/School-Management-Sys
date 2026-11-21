import type { AuthUser } from '../../../shared/auth/types.js';
import type { CookieOptions, Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam, toOffset } from '../../../shared/http/params.js';
import type { AuthService, TokenPair } from '../business/auth.service.js';
import type { UsersService } from '../business/users.service.js';
import * as s from './auth.schemas.js';

const REFRESH_COOKIE = 'rt';

const requestMeta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/** API LAYER — HTTP in/out only: validate input, call the service, shape the response. */
/** The internal session id stays server-side; clients never need it. */
const publicUser = ({ sessionId: _sid, ...user }: AuthUser) => user;

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookieSecure: boolean,
  ) {}

  private cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true, // JavaScript can't read it (XSS-safe)
      secure: this.cookieSecure,
      sameSite: 'strict', // not sent on cross-site requests (CSRF-safe)
      path: '/api/v1/auth', // only sent to auth endpoints
      ...(expires ? { expires } : {}),
    };
  }


  /** Browsers get the refresh token only as an httpOnly cookie; mobile apps (X-Client: mobile) get it in the body. */
  private sendTokens(req: Request, res: Response, t: TokenPair) {
    res.cookie(REFRESH_COOKIE, t.refreshToken, this.cookieOptions(t.refreshExpiresAt));
    const isMobile = req.get('x-client') === 'mobile';
    res.json({
      accessToken: t.accessToken,
      ...(isMobile ? { refreshToken: t.refreshToken } : {}),
      user: publicUser(t.user),
    });
  }

  login = async (req: Request, res: Response) => {
    const body = s.loginBody.parse(req.body);
    this.sendTokens(req, res, await this.auth.login(body.username, body.password, requestMeta(req)));
  };

  refresh = async (req: Request, res: Response) => {
    const body = s.refreshBody.parse(req.body ?? {});
    const token = req.cookies?.[REFRESH_COOKIE] ?? body.refreshToken;
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing refresh token' } });
      return;
    }
    this.sendTokens(req, res, await this.auth.refresh(token, requestMeta(req)));
  };

  logout = async (req: Request, res: Response) => {
    const body = s.refreshBody.parse(req.body ?? {});
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] ?? body.refreshToken, requestMeta(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    res.json({ user: publicUser(getAuth(req)) });
  };

  changePassword = async (req: Request, res: Response) => {
    const body = s.changePasswordBody.parse(req.body);
    this.sendTokens(req, res, await this.auth.changePassword(getAuth(req), body.currentPassword, body.newPassword, requestMeta(req)));
  };
}

export class UsersController {
  constructor(private readonly users: UsersService) {}

  list = async (req: Request, res: Response) => {
    const q = s.listUsersQuery.parse(req.query);
    const { limit, offset } = toOffset(q);
    const { items, total } = await this.users.list(q.search, limit, offset);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  };

  securityEvents = async (req: Request, res: Response) => {
    const q = s.securityEventsQuery.parse(req.query);
    const { page, pageSize, ...filters } = q;
    res.json({ ...(await this.users.listSecurityEvents({ ...filters, ...toOffset(q) })), page, pageSize });
  };

  roles = async (_req: Request, res: Response) => {
    res.json({ items: await this.users.listRoles() });
  };

  create = async (req: Request, res: Response) => {
    const body = s.createUserBody.parse(req.body);
    res.status(201).json(await this.users.createAccount(getAuth(req), body, undefined, requestMeta(req)));
  };

  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.users.update(getAuth(req), id, s.updateUserBody.parse(req.body), requestMeta(req));
    res.status(204).end();
  };

  setRoles = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.users.setRoles(getAuth(req), id, s.setRolesBody.parse(req.body).roles, requestMeta(req));
    res.status(204).end();
  };

  resetPassword = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.users.resetPassword(getAuth(req), id, requestMeta(req)));
  };
}
