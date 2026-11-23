import { Module } from '@nestjs/common';
import { MemberExportService } from './import/member-export.service';
import { MemberImportsController } from './import/member-imports.controller';
import { MemberImportsService } from './import/member-imports.service';
import { MemberAccountsService } from './member-accounts.service';
import { MeMemberController } from './me-member.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

// Owns the members and member_imports tables. Other modules reach them only through the
// services exported here (CLAUDE.md rule 7).
@Module({
  // The imports controller comes first: its fixed paths must win over /members/:id.
  controllers: [MemberImportsController, MembersController, MeMemberController],
  providers: [MembersService, MemberAccountsService, MemberImportsService, MemberExportService],
  exports: [MembersService, MemberAccountsService],
})
export class MembersModule {}
