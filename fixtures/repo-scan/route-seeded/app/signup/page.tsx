import { Form } from "@/components/Form";
import { Button } from "@/components/Button";
import { signUp } from "@/lib/auth";

export default function SignupPage() {
  signUp();
  return (
    <>
      <Form />
      <Button />
    </>
  );
}
