export type SessionUser = { id: string; email: string | null };

export type AuthResult = { ok: true; user: SessionUser; needsEmailConfirmation?: boolean } | { ok: false; code: string };

export interface AuthProvider {
  /** The signed-in visitor, verified, or null. */
  getUser(): Promise<SessionUser | null>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}
