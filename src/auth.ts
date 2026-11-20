import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { canSignIn } from "@/core";

const ONE_YEAR = 365 * 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are read from the environment.
  providers: [Google],
  // A long-lived JWT cookie keeps the learner signed in on each device between visits;
  // it is refreshed on use, so it only expires after a year without a visit.
  session: { strategy: "jwt", maxAge: ONE_YEAR, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  trustHost: true,
  callbacks: {
    signIn({ profile }) {
      return canSignIn(
        { email: profile?.email, emailVerified: profile?.email_verified as boolean | undefined },
        process.env.LEARNER_EMAIL,
      );
    },
  },
});

/** For pages and server actions: the signed-in learner's session, or a redirect to sign in. */
export async function requireLearner() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return session;
}
