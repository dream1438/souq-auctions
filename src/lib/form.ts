/** What a Server Action hands back to its form. */
export type FormState = { error?: string; ok?: string } | null;

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;
