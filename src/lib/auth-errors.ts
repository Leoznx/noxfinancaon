type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function isEmailNotConfirmedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const authError = error as AuthErrorLike;
  if (authError.code === "email_not_confirmed") return true;

  return (
    typeof authError.message === "string" &&
    /email\s+(?:is\s+)?not\s+confirmed/i.test(authError.message)
  );
}
