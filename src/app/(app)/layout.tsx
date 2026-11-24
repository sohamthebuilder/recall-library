import { requireLearner, signOut } from "@/auth";
import { getCore } from "@/server/core";
import { learnerTimeZone } from "@/server/time-zone";
import { AppNav } from "./app-nav";

/** Shell for every signed-in screen: the nav (with what needs you and what's due) and the page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireLearner();
  const core = getCore();
  const [needsYou, due] = await Promise.all([core.needsYou(), core.dueRecallPrompts({ timeZone: learnerTimeZone() })]);

  return (
    <div className="shell">
      <AppNav
        counts={{ needsYou: needsYou.total, due: due.prompts.length }}
        signOut={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="link-button">
              Sign out
            </button>
          </form>
        }
      />
      <main className="shell-main">{children}</main>
    </div>
  );
}
