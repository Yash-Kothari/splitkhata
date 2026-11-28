import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topBlurGap, TOP_BLUR_GAP } from '../lib/homeScreen.js';

test('only the iPhone Home Screen app leaves the blurred strip at the top empty', () => {
  assert.equal(topBlurGap({ navigator: { standalone: true } }), TOP_BLUR_GAP);
  for (const win of [{ navigator: { standalone: false } }, { navigator: {} }, {}, undefined]) assert.equal(topBlurGap(win), 0);
});
