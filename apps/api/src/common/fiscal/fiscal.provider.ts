import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** What a fiscal receipt needs to know about a payment or refund. */
export interface FiscalReceipt {
  organizationId: string;
  kind: 'payment' | 'refund';
  /** The payment or refund id. */
  id: string;
  amountMinor: bigint;
  currency: string;
  items: { description: string; quantity: number; totalMinor: bigint }[];
}

/**
 * Port for fiscal receipts (docs/TZ.md section 8): the interface exists in the MVP, real
 * drivers come later (docs/TZ.md section 13). Returns the fiscal sign, or null when the
 * driver does not issue one.
 */
export interface FiscalProvider {
  register(receipt: FiscalReceipt): Promise<{ fiscalSign: string } | null>;
}

export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');

/** Development driver: issues nothing. */
@Injectable()
export class NoopFiscalProvider implements FiscalProvider {
  private readonly logger = new Logger(NoopFiscalProvider.name);

  register(receipt: FiscalReceipt): Promise<null> {
    this.logger.debug(`Fiscal receipt skipped for ${receipt.kind} ${receipt.id}`);
    return Promise.resolve(null);
  }
}

@Global()
@Module({
  providers: [{ provide: FISCAL_PROVIDER, useClass: NoopFiscalProvider }],
  exports: [FISCAL_PROVIDER],
})
export class FiscalModule {}
