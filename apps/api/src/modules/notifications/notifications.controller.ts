import {
  type NotificationDto,
  type NotificationListQuery,
  notificationListQuerySchema,
  type NotificationTemplateDto,
  NOTIFICATION_TEMPLATE_KEYS,
  type NotificationTemplateUpdateInput,
  notificationTemplateUpdateSchema,
  type Page,
  TEMPLATE_LOCALES,
} from '@gatefit/shared';
import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest } from '../../common/http/app-request';
import { staffCaller } from '../../common/http/staff-request';
import { TenantDb } from '../../common/tenancy/tenant-db.service';
import { ZodPipe, zodBody } from '../../common/validation/zod';
import { RequirePermission } from '../auth/auth.decorators';
import { NotificationsService } from './notifications.service';

const keys = Object.fromEntries(NOTIFICATION_TEMPLATE_KEYS.map((key) => [key, key])) as Record<
  (typeof NOTIFICATION_TEMPLATE_KEYS)[number],
  (typeof NOTIFICATION_TEMPLATE_KEYS)[number]
>;
const locales = Object.fromEntries(TEMPLATE_LOCALES.map((locale) => [locale, locale])) as Record<
  (typeof TEMPLATE_LOCALES)[number],
  (typeof TEMPLATE_LOCALES)[number]
>;

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Get('notification-templates')
  @RequirePermission('notifications.manage')
  @ApiOperation({ summary: 'Message templates in every language, standard or the club’s own' })
  templates(): Promise<NotificationTemplateDto[]> {
    return this.notifications.templates(this.tenantDb.tx);
  }

  @Put('notification-templates/:key/:locale')
  @RequirePermission('notifications.manage')
  @ApiBody(zodBody(notificationTemplateUpdateSchema))
  @ApiOperation({ summary: 'Change a template; body null goes back to the standard text' })
  update(
    @Param('key', new ParseEnumPipe(keys)) key: (typeof NOTIFICATION_TEMPLATE_KEYS)[number],
    @Param('locale', new ParseEnumPipe(locales)) locale: (typeof TEMPLATE_LOCALES)[number],
    @Body(new ZodPipe(notificationTemplateUpdateSchema)) input: NotificationTemplateUpdateInput,
    @Req() req: AppRequest,
  ): Promise<NotificationTemplateDto> {
    return this.notifications.updateTemplate(
      this.tenantDb.tx,
      staffCaller(req),
      key,
      locale,
      input.body,
    );
  }

  @Get('notifications')
  @RequirePermission('members.read')
  @ApiOperation({ summary: 'Messages sent to a member, newest first' })
  list(
    @Query(new ZodPipe(notificationListQuerySchema)) query: NotificationListQuery,
    @Req() req: AppRequest,
  ): Promise<Page<NotificationDto>> {
    return this.notifications.list(this.tenantDb.tx, staffCaller(req), query);
  }
}
