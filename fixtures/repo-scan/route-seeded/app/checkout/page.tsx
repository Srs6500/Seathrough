import { Form } from "@/components/Form";
import { Button } from "@/components/Button";
import { charge } from "@/lib/stripe";

export default function CheckoutPage() {
  charge();
  return (
    <>
      <Form />
      <Button />
    </>
  );
}
