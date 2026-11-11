import { ErrorCode } from '@gatefit/shared';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { z } from 'zod';
import { AppException } from './app.exception';
import { toErrorResponse } from './error-response';

describe('toErrorResponse', () => {
  it('renders an AppException as is', () => {
    const exception = new AppException(ErrorCode.CONFLICT, 'Phone already used', 409, {
      field: 'phone',
    });
    expect(toErrorResponse(exception)).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'Phone already used', details: { field: 'phone' } },
    });
  });

  it('maps a ZodError to VALIDATION_FAILED with issue paths', () => {
    const result = z.object({ user: z.object({ age: z.number() }) }).safeParse({ user: {} });
    const { status, body } = toErrorResponse(result.error);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual([{ path: 'user.age', message: expect.any(String) as string }]);
  });

  it('maps a Nest HttpException by status', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Cannot GET /nope', details: null },
    });
  });

  it('moves a list of problems from message into details', () => {
    const { body } = toErrorResponse(new BadRequestException(['name is required']));
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.details).toEqual(['name is required']);
  });

  it('treats an unmapped 4xx as a generic client error', () => {
    const { status, body } = toErrorResponse(new HttpException('Gone', 410));
    expect(status).toBe(410);
    expect(body).toEqual({ code: 'BAD_REQUEST', message: 'Gone', details: null });
  });

  it('hides the message of an unmapped 5xx', () => {
    const { status, body } = toErrorResponse(new NotImplementedException('secret detail'));
    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: null,
    });
  });

  it.each([new Error('connection string leaked'), 'boom', null, undefined])(
    'hides unknown errors (%p)',
    (thrown) => {
      expect(toErrorResponse(thrown)).toEqual({
        status: 500,
        body: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: null },
      });
    },
  );
});
