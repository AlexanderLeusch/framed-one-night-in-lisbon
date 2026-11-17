// ### The chase half of the browser tests (room 2), for CI, which runs the two halves side by side. See browser.test.js.
process.env.BROWSER_PART = 'chase';
require('./browser.test.js');
