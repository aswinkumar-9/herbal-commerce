// Runs in the shop's <head>, before the page is drawn, so a page chosen
// dark never flashes light first. Loaded as its own file
// (<script src="…">), never inline: the page's security policy forbids
// inline scripts.
import { applyThemeChoice, deviceStorage, readThemeChoice } from './theme.ts';

applyThemeChoice(document.documentElement, readThemeChoice(deviceStorage()));
