export interface SignInAttempt {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
}

/**
 * The app has one learner. Only their verified Google account (the email set in
 * configuration) may sign in; with no email configured, nobody can.
 */
export function canSignIn(attempt: SignInAttempt, learnerEmail: string | undefined): boolean {
  const allowed = learnerEmail?.trim().toLowerCase();
  const email = attempt.email?.trim().toLowerCase();
  if (!allowed || !email) return false;
  return attempt.emailVerified === true && email === allowed;
}
