import { Module } from '@nestjs/common';
import { MembersModule } from '../members/members.module';
import { OrganizationModule } from '../tenancy/organization.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// Owns the notification_templates and notifications tables (docs/TZ.md 5.2). Other
// modules send messages through NotificationsService (CLAUDE.md rule 7).
@Module({
  imports: [MembersModule, OrganizationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
