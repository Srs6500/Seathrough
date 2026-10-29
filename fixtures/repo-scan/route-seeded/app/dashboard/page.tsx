import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/Button";
import { query } from "@/lib/database";

export default function DashboardPage() {
  query();
  return (
    <>
      <Navbar />
      <Button />
    </>
  );
}
