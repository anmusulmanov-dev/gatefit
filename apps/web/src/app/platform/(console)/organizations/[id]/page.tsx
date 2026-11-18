import { OrganizationDetail } from './organization-detail';

export default async function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrganizationDetail id={id} />;
}
