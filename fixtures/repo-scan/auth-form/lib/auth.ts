import { getServerSession } from "next-auth";

export async function signIn() {
  return getServerSession();
}
