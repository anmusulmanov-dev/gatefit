import type { PipeTransform } from '@nestjs/common';
import type { ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Validates a request part with a schema from packages/shared, so the API and the
 * frontends check the same rules. A failure becomes VALIDATION_FAILED in the global filter.
 *
 *   @Body(new ZodPipe(staffLoginSchema)) body: StaffLoginInput
 */
export class ZodPipe<Output> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: z.ZodType<Output>) {}

  transform(value: unknown): Output {
    return this.schema.parse(value);
  }
}

/** Describes a zod-validated body in the OpenAPI document: @ApiBody(zodBody(schema)). */
type SchemaBody = Extract<ApiBodyOptions, { schema: unknown }>;

export function zodBody(schema: z.ZodType): SchemaBody {
  return {
    schema: z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      target: 'openapi-3.0',
    }) as SchemaBody['schema'],
  };
}
