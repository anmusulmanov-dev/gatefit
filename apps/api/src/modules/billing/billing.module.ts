import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { DEBT_FACTS } from '../members/member-status';
import { MembersModule } from '../members/members.module';
import { OrganizationModule } from '../tenancy/organization.module';
import {
  CashShiftsController,
  MePaymentsController,
  InvoicesController,
  PaymentsController,
} from './billing.controllers';
import { CashShiftsService } from './cash-shifts.service';
import { DebtStatusJob } from './debt-status.job';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

// Owns invoices, payments, refunds, cash shifts and idempotency keys (docs/TZ.md 5.2).
// Other modules reach them only through the services exported here (CLAUDE.md rule 7).
@Module({
  imports: [MembersModule, OrganizationModule],
  controllers: [InvoicesController, PaymentsController, CashShiftsController, MePaymentsController],
  providers: [
    InvoicesService,
    PaymentsService,
    CashShiftsService,
    DebtStatusJob,
    IdempotencyInterceptor,
    // What the members module asks about money owed (member status).
    { provide: DEBT_FACTS, useExisting: InvoicesService },
  ],
  exports: [InvoicesService, IdempotencyInterceptor, DEBT_FACTS],
})
export class BillingModule {}
