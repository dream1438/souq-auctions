import type { Dictionary } from "@/app/[lang]/dictionaries";

/** The profile part of sign-up: name, WhatsApp number, city and the consents. */
export function ProfileFields({ dict }: { dict: Dictionary }) {
  return (
    <>
      <div className="field">
        <label htmlFor="display_name">{dict.auth.displayName}</label>
        <input id="display_name" name="display_name" className="input" required minLength={2} maxLength={60} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="phone">{dict.auth.phone}</label>
        <input id="phone" name="phone" className="input" required inputMode="tel" dir="ltr" autoComplete="tel" placeholder="01012345678" />
        <p className="hint">{dict.auth.phoneHint}</p>
      </div>
      <div className="field">
        <label htmlFor="city">
          {dict.auth.city} <span className="hint">({dict.common.optional})</span>
        </label>
        <input id="city" name="city" className="input" maxLength={60} autoComplete="address-level2" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="terms" required className="mt-1" />
        <span>{dict.auth.agreeTerms}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="whatsapp" defaultChecked className="mt-1" />
        <span>{dict.auth.agreeWhatsapp}</span>
      </label>
    </>
  );
}
