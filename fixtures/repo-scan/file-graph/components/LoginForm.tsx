import { signIn } from "@/lib/auth";

export function LoginForm() {
  return <button onClick={() => signIn()}>Go</button>;
}
