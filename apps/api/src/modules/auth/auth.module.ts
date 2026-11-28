import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembersModule } from '../members/members.module';
import { StaffModule } from '../staff/staff.module';
import { AccessInterceptor } from './access.interceptor';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { MemberDeskCodeController } from './member-desk-code.controller';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { StaffAuthService } from './staff-auth.service';
import { StaffSecurityController } from './staff-security.controller';
import { StaffSecurityService } from './staff-security.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  // The secret and lifetimes are passed per call by TokenService.
  imports: [JwtModule.register({}), StaffModule, MembersModule],
  controllers: [AuthController, MeController, MemberDeskCodeController, StaffSecurityController],
  providers: [
    AccessInterceptor,
    AccessService,
    AuthGuard,
    OtpService,
    SessionService,
    StaffAuthService,
    StaffSecurityService,
    TokenService,
    TotpService,
  ],
  // The guard and interceptor are registered globally, in a fixed order, by AppModule.
  exports: [AccessInterceptor, AuthGuard, SessionService, TokenService, TotpService],
})
export class AuthModule {}
