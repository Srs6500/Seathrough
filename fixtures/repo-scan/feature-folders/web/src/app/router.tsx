import { LoginPage } from "../features/auth/LoginPage";
import { TradePage } from "../features/terminal/TradePage";
import { AppShell } from "../shared/layout/AppShell";

export function AppRouter() {
  return (
    <AppShell>
      <LoginPage />
      <TradePage />
    </AppShell>
  );
}
