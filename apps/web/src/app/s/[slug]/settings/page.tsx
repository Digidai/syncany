import { redirect } from "next/navigation";

// /settings → /settings/workspace. Default tab is Workspace because it's
// the most common reason someone opens settings (name + invite people).
export default async function SettingsIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<never> {
  const { slug } = await params;
  redirect(`/s/${slug}/settings/workspace`);
}
