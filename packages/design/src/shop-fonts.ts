/// <reference types="vite/client" />
// The shop's font files that every page uses from its first screen (the
// regular, medium and semibold of Poppins, Latin letters), for the website
// to preload: the browser then fetches them alongside the stylesheet, not
// only once it has read it. They are the very files the stylesheet names
// (the shop look's imports), so nothing is fetched twice. Bold stays out:
// no text style uses it. For a Vite build only (the ?url imports).
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url';
import poppins500 from '@fontsource/poppins/files/poppins-latin-500-normal.woff2?url';
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2?url';

export const SHOP_FONT_FILES: readonly string[] = [
  poppins400,
  poppins500,
  poppins600,
];
