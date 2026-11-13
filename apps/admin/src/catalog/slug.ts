// The readable part of a web address, such as "hair-care" (ADR 0020). The
// same rules and the same conversion as the API, so staff see the slug the
// API will make.
export const SLUG_MAX = 60;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// "Café Crème (Natural)" becomes "cafe-creme-natural". A name without
// Latin letters or digits gives "".
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}
