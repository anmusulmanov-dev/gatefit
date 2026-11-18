import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessInterceptor } from './access.interceptor';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MeController } from './me.controller';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { StaffAuthService } from './staff-auth.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  // The secret and lifetimes are passed per call by TokenService.
  imports: [JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AccessInterceptor,
    AccessService,
    AuthGuard,
    OtpService,
    PasswordService,
    SessionService,
    StaffAuthService,
    TokenService,
    TotpService,
  ],
  // The guard and interceptor are registered globally, in a fixed order, by AppModule.
  exports: [AccessInterceptor, AuthGuard, PasswordService],
})
export class AuthModule {}
