/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> 0-9. Everything stored or compared in the system uses Western digits. */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}
