'use client';

import { useRouter } from 'next/navigation';

import { MemberForm } from '../member-form';
import type { MemberScope } from '../member-scope';

export function NewMember({ scope }: { scope: MemberScope }) {
  const router = useRouter();
  return (
    <MemberForm
      member={null}
      scope={scope}
      onSaved={(member) => {
        router.push(`/members/${member.id}`);
      }}
      onCancel={() => {
        router.push('/members');
      }}
    />
  );
}
