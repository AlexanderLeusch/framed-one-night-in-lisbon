// ### The chase part of the browser tests (room 2): both of its halves, one after the other, for running them here. See browser.test.js.
process.env.BROWSER_PART = 'chase';
require('./browser.test.js');
