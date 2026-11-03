// The readable part of a web address, such as "hair-care": lowercase
// letters, digits and single hyphens (ADR 0020).
export const SLUG_MAX = 60;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Makes a slug from a name: "Café Crème (Natural)" becomes
// "cafe-creme-natural". Accents are dropped, and every run of anything else
// becomes one hyphen. A name without Latin letters or digits gives "".
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}
