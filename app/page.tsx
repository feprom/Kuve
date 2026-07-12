import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard"); // middleware sends unauthenticated users to /login
}
