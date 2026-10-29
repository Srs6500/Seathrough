import { AuthBackground } from "./AuthBackground";
import { Button } from "../../components/ui/button";
import { AuthProvider } from "../../shared/lib/AuthContext";

export function LoginPage() {
  return (
    <AuthProvider>
      <AuthBackground />
      <Button />
    </AuthProvider>
  );
}
