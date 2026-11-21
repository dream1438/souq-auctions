/** An expected failure with a stable code that the UI can translate. */
export class AppError extends Error {
  constructor(
    public code: string,
    public detail?: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

type PgLikeError = { code?: string; message?: string; detail?: string; constraint?: string };

/**
 * Database functions raise short snake_case messages such as "bid_too_low".
 * Turn those, and the common constraint failures, into AppError.
 */
export function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  const e = error as PgLikeError;
  if (!e || typeof e !== "object" || typeof e.code !== "string") return null;
  if (e.code === "P0001" && e.message && /^[a-z0-9_]+$/.test(e.message)) {
    return new AppError(e.message, e.detail);
  }
  if (e.code === "42501") return new AppError("not_allowed");
  if (e.code === "23505") return new AppError("already_exists", e.constraint);
  if (e.code === "23514") return new AppError("invalid_value", e.constraint);
  if (e.code === "23503") return new AppError("invalid_reference", e.constraint);
  if (e.code === "22P02") return new AppError("invalid_value");
  return null;
}
