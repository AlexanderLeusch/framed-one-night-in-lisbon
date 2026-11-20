// ### One half of the chase browser tests (room 2), for CI, which runs the parts side by side. See browser.test.js.
process.env.BROWSER_PART = 'chase-pages';
require('./browser.test.js');
