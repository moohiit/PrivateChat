import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AuthForm from "@/components/AuthForm";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <AuthForm mode="login" />
    </main>
  );
}
