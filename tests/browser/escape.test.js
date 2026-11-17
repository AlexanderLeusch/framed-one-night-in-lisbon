// ### The escape room half of the browser tests (the start page and room 1), for CI, which runs the two halves side by side. See browser.test.js.
process.env.BROWSER_PART = 'escape';
require('./browser.test.js');
