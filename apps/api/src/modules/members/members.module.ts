import { Module } from '@nestjs/common';
import { MemberAccountsService } from './member-accounts.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

// Owns the members table. Other modules reach it only through the services exported here
// (CLAUDE.md rule 7).
@Module({
  controllers: [MembersController],
  providers: [MembersService, MemberAccountsService],
  exports: [MembersService, MemberAccountsService],
})
export class MembersModule {}
