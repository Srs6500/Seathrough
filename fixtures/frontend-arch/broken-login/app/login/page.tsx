import { LoginForm } from "@/components/LoginForm";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main>
      <h1>Login</h1>
      <LoginForm />
      <Link href="/does-not-exist">Forgot password</Link>
    </main>
  );
}
