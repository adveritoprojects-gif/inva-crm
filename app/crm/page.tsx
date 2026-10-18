import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionFromToken } from "@/lib/auth";
import { SetupError } from "@/lib/db";
import SetupScreen from "@/components/SetupScreen";
import Crm from "../crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "PCT Project Desk",
};

/**
 * Protected, server-rendered CRM entry page.
 * Unauthenticated visitors are redirected before any project data is read,
 * and the page is always rendered dynamically (never cached for visitors).
 */
export default async function CrmPage() {
  const store = await cookies();
  try {
    const session = await getSessionFromToken(store.get(SESSION_COOKIE)?.value);
    if (!session) redirect("/login");
  } catch (err) {
    if (err instanceof SetupError) {
      return (
        <SetupScreen title="Server not configured yet" message={err.message} />
      );
    }
    throw err;
  }
  return <Crm />;
}
