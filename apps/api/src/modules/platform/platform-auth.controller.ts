import {
  type PlatformLoginInput,
  platformLoginSchema,
  type PlatformMeResponse,
  type PlatformTotpSetupInput,
  platformTotpSetupSchema,
  type TotpConfirmInput,
  totpConfirmSchema,
  type TotpSetupResponse,
} from '@gatefit/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import type { Env } from '../../config/env';
import {
  clearPlatformSessionCookie,
  Platform,
  platformAdminOf,
  PlatformPublic,
  type PlatformRequest,
  setPlatformSessionCookie,
} from './platform.http';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformSessionService } from './platform-session.service';

const clientMeta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('platform')
@Controller('platform')
export class PlatformAuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: PlatformAuthService,
    private readonly sessions: PlatformSessionService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Post('auth/login')
  @PlatformPublic()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Platform operator sign-in: phone, password and TOTP' })
  @ApiBody(zodBody(platformLoginSchema))
  @ApiNoContentResponse({ description: 'Signed in; session cookie set' })
  async login(
    @Body(new ZodPipe(platformLoginSchema)) body: PlatformLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    setPlatformSessionCookie(res, await this.auth.login(body, clientMeta(req)), this.secureCookies);
  }

  @Post('auth/totp/setup')
  @PlatformPublic()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start authenticator enrolment with the token from sign-in' })
  @ApiBody(zodBody(platformTotpSetupSchema))
  beginTotpSetup(
    @Body(new ZodPipe(platformTotpSetupSchema)) body: PlatformTotpSetupInput,
  ): Promise<TotpSetupResponse> {
    return this.auth.beginTotpSetup(body.setupToken);
  }

  @Post('auth/totp/confirm')
  @PlatformPublic()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Finish authenticator enrolment and sign in' })
  @ApiBody(zodBody(totpConfirmSchema))
  @ApiNoContentResponse({ description: 'Enrolled and signed in' })
  async confirmTotpSetup(
    @Body(new ZodPipe(totpConfirmSchema)) body: TotpConfirmInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = await this.auth.confirmTotpSetup(body, clientMeta(req));
    setPlatformSessionCookie(res, token, this.secureCookies);
  }

  @Post('auth/logout')
  @Platform()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the platform session' })
  @ApiNoContentResponse({ description: 'Signed out' })
  async logout(
    @Req() req: PlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.end(platformAdminOf(req).sessionId);
    clearPlatformSessionCookie(res, this.secureCookies);
  }

  @Get('me')
  @Platform()
  @ApiOperation({ summary: 'The signed-in platform operator' })
  me(@Req() req: PlatformRequest): Promise<PlatformMeResponse> {
    return this.auth.me(platformAdminOf(req).id);
  }
}
