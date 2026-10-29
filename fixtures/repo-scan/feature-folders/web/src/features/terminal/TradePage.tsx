import { OrderTicket } from "./OrderTicket";
import { Button } from "../../components/ui/button";
import { AuthProvider } from "../../shared/lib/AuthContext";

export function TradePage() {
  return (
    <AuthProvider>
      <OrderTicket />
      <Button />
    </AuthProvider>
  );
}
