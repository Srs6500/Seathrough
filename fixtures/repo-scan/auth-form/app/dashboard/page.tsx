export default function DashboardPage() {
  void fetch("/api/stats");
  return <div data-testid="private-dashboard">Account overview</div>;
}
