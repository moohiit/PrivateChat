import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AuthForm from "@/components/AuthForm";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-5 py-10">
      <AuthForm mode="login" />
    </main>
  );
}
