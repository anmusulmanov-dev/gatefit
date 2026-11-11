import {
  type OtpRequestInput,
  otpRequestSchema,
  type OtpVerifyInput,
  otpVerifySchema,
  type SessionAudience,
  type StaffLoginInput,
  staffLoginSchema,
  type TotpConfirmInput,
  totpConfirmSchema,
  type TotpSetupInput,
  type TotpSetupResponse,
  totpSetupSchema,
} from '@gatefit/shared';
import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AppRequest, ResolvedTenant } from '../../common/http/app-request';
import { AuthRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import type { Env } from '../../config/env';
import {
  clearSessionCookies,
  clientAudience,
  readAccessToken,
  readRefreshToken,
  type SessionTokens,
  setSessionCookies,
} from './auth.cookies';
import { AnyAuthenticated, Public } from './auth.decorators';
import { organizationRequired, unauthorized } from './auth.errors';
import { OtpService } from './otp.service';
import { type ClientMeta, SessionService } from './session.service';
import { StaffAuthService } from './staff-auth.service';
import { TokenService } from './token.service';

function requireTenant(req: AppRequest): ResolvedTenant {
  if (!req.tenant) {
    throw organizationRequired();
  }
  return req.tenant;
}

function clientMeta(req: AppRequest): ClientMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

// Sessions live in httpOnly cookies, so successful sign-in endpoints return no body.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly tenantDb: TenantDb,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Post('login')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Staff sign-in with phone, password and, where set up, TOTP' })
  @ApiBody(zodBody(staffLoginSchema))
  @ApiNoContentResponse({ description: 'Signed in; session cookies set' })
  async login(
    @Body(new ZodPipe(staffLoginSchema)) body: StaffLoginInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.staffAuth.login(requireTenant(req), body, clientMeta(req));
    this.setCookies(res, 'staff', tokens);
  }

  @Post('totp/setup')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start authenticator enrolment (setup token or current session)' })
  @ApiBody(zodBody(totpSetupSchema))
  @ApiOkResponse({ description: 'Secret, otpauth URI and the token for /auth/totp/confirm' })
  beginTotpSetup(
    @Body(new ZodPipe(totpSetupSchema)) body: TotpSetupInput,
    @Req() req: AppRequest,
  ): Promise<TotpSetupResponse> {
    const tenant = requireTenant(req);
    if (body.setupToken) {
      return this.staffAuth.beginTotpSetup(tenant, { setupToken: body.setupToken });
    }

    // No setup token: the caller must already be signed in as staff of this organization.
    const session = this.tokens.verifyAccess(readAccessToken(req, 'staff'), 'staff');
    if (session?.organizationId !== tenant.id) {
      throw unauthorized();
    }
    return this.staffAuth.beginTotpSetup(tenant, { sessionUserId: session.userId });
  }

  @Post('totp/confirm')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Finish authenticator enrolment with the first code' })
  @ApiBody(zodBody(totpConfirmSchema))
  @ApiNoContentResponse({ description: 'Enrolled; signed in when enrolment was part of sign-in' })
  async confirmTotpSetup(
    @Body(new ZodPipe(totpConfirmSchema)) body: TotpConfirmInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.staffAuth.confirmTotpSetup(requireTenant(req), body, clientMeta(req));
    if (tokens) {
      this.setCookies(res, 'staff', tokens);
    }
  }

  @Post('otp/request')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a member sign-in code by SMS' })
  @ApiBody(zodBody(otpRequestSchema))
  @ApiNoContentResponse({ description: 'Code sent' })
  async requestOtp(
    @Body(new ZodPipe(otpRequestSchema)) body: OtpRequestInput,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.otp.request(requireTenant(req), body);
  }

  @Post('otp/verify')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Member sign-in with the SMS code' })
  @ApiBody(zodBody(otpVerifySchema))
  @ApiNoContentResponse({ description: 'Signed in; session cookies set' })
  async verifyOtp(
    @Body(new ZodPipe(otpVerifySchema)) body: OtpVerifyInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.otp.verify(requireTenant(req), body, clientMeta(req));
    this.setCookies(res, 'member', tokens);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new token pair' })
  @ApiNoContentResponse({ description: 'New session cookies set' })
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const tenant = requireTenant(req);
    const audience = clientAudience(req);
    const refreshToken = readRefreshToken(req, audience);

    const tokens = refreshToken
      ? await this.sessions.rotate(tenant.id, audience, refreshToken, clientMeta(req))
      : null;
    if (!tokens) {
      clearSessionCookies(res, audience, this.secureCookies);
      throw unauthorized('Session has ended, sign in again');
    }
    this.setCookies(res, audience, tokens);
  }

  // Public on purpose: signing out must work even after the access token has expired.
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out this device' })
  @ApiNoContentResponse({ description: 'Session revoked; cookies cleared' })
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const tenant = requireTenant(req);
    const audience = clientAudience(req);
    const refreshToken = readRefreshToken(req, audience);
    if (refreshToken) {
      await this.sessions.revokeByRefreshToken(tenant.id, refreshToken);
    }
    clearSessionCookies(res, audience, this.secureCookies);
  }

  @Post('logout-all')
  @AnyAuthenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out every device of the current user' })
  @ApiNoContentResponse({ description: 'All sessions revoked; cookies cleared' })
  async logoutAll(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const auth = req.auth;
    if (!auth) {
      throw unauthorized();
    }
    await this.sessions.revokeAllForUser(this.tenantDb.tx, auth.userId);
    clearSessionCookies(res, auth.audience, this.secureCookies);
  }

  private setCookies(res: Response, audience: SessionAudience, tokens: SessionTokens): void {
    setSessionCookies(res, audience, tokens, this.secureCookies);
  }
}
