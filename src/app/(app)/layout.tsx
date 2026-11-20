import { requireLearner, signOut } from "@/auth";

/** Shell for every signed-in screen. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireLearner();

  return (
    <>
      <header className="shell-header">
        <h1>books-rag</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <span className="muted" style={{ marginRight: 12, fontSize: "0.85rem" }}>
            {session.user?.email}
          </span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="shell-main">{children}</main>
    </>
  );
}
