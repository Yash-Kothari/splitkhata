import { isIosHomeScreenApp } from './googleRedirect.js';

// iOS 26 and later blur a strip at the top of a website opened from a Home Screen icon, even though the status bar is solid
// and the page starts below it. Nothing readable goes there: the app leaves this many points empty at the top.
export const TOP_BLUR_GAP = 28;
export const topBlurGap = (win) => (isIosHomeScreenApp(win) ? TOP_BLUR_GAP : 0);
