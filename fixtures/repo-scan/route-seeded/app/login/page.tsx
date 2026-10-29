import { Form } from "@/components/Form";
import { Button } from "@/components/Button";
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  signIn();
  return (
    <>
      <Form />
      <Button />
    </>
  );
}
