import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="signin panel">
      <h1>books-rag</h1>
      {error === "AccessDenied" ? (
        <p className="error">That Google account is not allowed to use this app.</p>
      ) : error ? (
        <p className="error">Sign-in failed. Please try again.</p>
      ) : null}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button className="primary" type="submit">
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
