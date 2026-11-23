// Runs in the shop's <head>, before the page is drawn, so a page chosen
// dark never flashes light first. The website writes it inline, under
// each page's own nonce, so nothing is fetched before it runs (part 14B);
// the design preview, whose policy has no nonce, loads it as its own file.
import { applyThemeChoice, deviceStorage, readThemeChoice } from './theme.ts';

applyThemeChoice(document.documentElement, readThemeChoice(deviceStorage()));
