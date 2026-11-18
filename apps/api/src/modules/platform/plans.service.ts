import {
  ErrorCode,
  isSaasModule,
  planLimitsSchema,
  type SaasPlanCreateInput,
  type SaasPlanDto,
  type SaasPlanUpdateInput,
} from '@gatefit/shared';
import { Injectable, Logger } from '@nestjs/common';
import { conflict, notFound } from '../../common/errors/domain-errors';
import { PlatformPrismaService } from './platform-prisma.service';

interface PlanRow {
  id: string;
  key: string;
  name: string;
  limits: unknown;
  modules: unknown;
  priceMinor: bigint;
  currency: string;
  isActive: boolean;
}

export function toPlanDto(row: PlanRow): SaasPlanDto {
  const limits = planLimitsSchema.safeParse(row.limits);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    limits: limits.success ? limits.data : { activeMembersPerLocation: null },
    modules: Array.isArray(row.modules) ? row.modules.filter(isSaasModule) : [],
    // A string, so no client ever holds money in a floating-point number.
    priceMinor: row.priceMinor.toString(),
    currency: row.currency,
    isActive: row.isActive,
  };
}

/** The tariffs Gatefit sells. Prices, limits and modules are data, edited here. */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(private readonly db: PlatformPrismaService) {}

  async list(): Promise<SaasPlanDto[]> {
    const plans = await this.db.saasPlan.findMany({
      orderBy: [{ priceMinor: 'asc' }, { id: 'asc' }],
    });
    return plans.map(toPlanDto);
  }

  async create(adminId: string, input: SaasPlanCreateInput): Promise<SaasPlanDto> {
    if (await this.db.saasPlan.findUnique({ where: { key: input.key } })) {
      throw conflict(ErrorCode.PLAN_KEY_TAKEN, 'A plan with this key already exists');
    }
    const plan = await this.db.saasPlan.create({
      data: { ...input, priceMinor: BigInt(input.priceMinor) },
    });
    // Plans belong to no organization, so this goes to the application log rather than
    // an organization's audit trail.
    this.logger.log({ msg: 'plan created', adminId, planId: plan.id, key: plan.key });
    return toPlanDto(plan);
  }

  /** Changes apply at once to every organization on the plan. */
  async update(adminId: string, planId: string, input: SaasPlanUpdateInput): Promise<SaasPlanDto> {
    if (!(await this.db.saasPlan.findUnique({ where: { id: planId } }))) {
      throw notFound('Plan');
    }
    const plan = await this.db.saasPlan.update({
      where: { id: planId },
      data: {
        ...input,
        priceMinor: input.priceMinor === undefined ? undefined : BigInt(input.priceMinor),
      },
    });
    this.logger.log({ msg: 'plan updated', adminId, planId, changed: Object.keys(input) });
    return toPlanDto(plan);
  }
}
