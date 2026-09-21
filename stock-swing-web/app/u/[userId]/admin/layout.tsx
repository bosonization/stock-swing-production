import { redirect } from 'next/navigation';
import { authorizeUserId } from '../../../../lib/auth';
import { hasRequiredTermsConsent } from '../../../../lib/terms';

export default async function WatchlistAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const actor = await authorizeUserId(userId);
  if (!(await hasRequiredTermsConsent(actor.id))) redirect(`/u/${encodeURIComponent(actor.id)}`);
  return children;
}

