// What a page tells search engines and link previews (WhatsApp, and
// others): its title and description, its own address, and a picture.
// Addresses are whole, from the website's own (WEB_ORIGIN), as previews
// need. Only the page's real words and pictures, never made-up facts.
// A page that is one of many views of another (a search, a filter, a later
// page of a list) asks search engines not to list it, and names no
// canonical address of its own. A product's page says it is one, with its
// lowest price on sale, for previews that show it.
import type { MetaDescriptor } from 'react-router';
import { text } from './text/en.ts';

export function pageMeta({
  title,
  description,
  origin,
  path,
  image,
  noindex = false,
  price,
}: {
  title: string;
  description: string;
  origin: string;
  path: string;
  image?: { src: string; alt: string; width?: number; height?: number };
  noindex?: boolean;
  // In whole rupees; given for a product's page only.
  price?: number | null | undefined;
}): MetaDescriptor[] {
  const url = new URL(path, origin).href;
  return [
    { title },
    { name: 'description', content: description },
    noindex
      ? { name: 'robots', content: 'noindex, follow' }
      : { tagName: 'link', rel: 'canonical', href: url },
    {
      property: 'og:type',
      content: price === undefined ? 'website' : 'product',
    },
    { property: 'og:site_name', content: text.shop.name },
    { property: 'og:locale', content: 'en_IN' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    ...(image
      ? [
          { property: 'og:image', content: new URL(image.src, origin).href },
          ...(image.width && image.height
            ? [
                { property: 'og:image:width', content: String(image.width) },
                { property: 'og:image:height', content: String(image.height) },
              ]
            : []),
          { property: 'og:image:alt', content: image.alt },
          { name: 'twitter:card', content: 'summary_large_image' },
        ]
      : [{ name: 'twitter:card', content: 'summary' }]),
    ...(price === undefined || price === null
      ? []
      : [
          { property: 'product:price:amount', content: String(price) },
          { property: 'product:price:currency', content: 'INR' },
        ]),
  ];
}
