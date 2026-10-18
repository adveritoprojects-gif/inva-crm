import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionFromToken } from "@/lib/auth";
import { SetupError } from "@/lib/db";
import SetupScreen from "@/components/SetupScreen";
import LoginForm from "./LoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in · PCT Project Desk",
};

export default async function LoginPage() {
  const store = await cookies();
  try {
    const session = await getSessionFromToken(store.get(SESSION_COOKIE)?.value);
    if (session) redirect("/crm");
  } catch (err) {
    if (err instanceof SetupError) {
      return (
        <SetupScreen
          title="Server not configured yet"
          message={err.message}
        />
      );
    }
    throw err;
  }
  return <LoginForm />;
}
