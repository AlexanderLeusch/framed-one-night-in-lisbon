// ### Unit tests for the story mode: its one act in Lisbon, retries, the hidden letter, the endings and the radio messages.
// Story mode "The Necklace Job": the act, the letter, endings and retries (room-2-chase/js/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../room-2-chase/js/core.js');

// Plays through the story the way game.js does: begin an act, maybe pick things up, finish or fail
function playthrough(steps){
  const story = Core.newStory();
  for (const step of steps) step(story);
  return story;
}

test('a new story starts in its act with no letter', () => {
  const s = Core.newStory();
  assert.equal(s.act, 0);
  assert.equal(s.letter, false);
  assert.deepEqual(s.times, []);
  assert.equal('clasp' in s, false, 'nothing is left of the acts that were played on the highway and in the countryside');
});

test('the story is one act, played in Lisbon', () => {
  assert.equal(Core.STORY_ACTS, 1);
  assert.deepEqual(Object.keys(Core.MODES), ['city'], 'Lisbon is the only map');
  const s = Core.newStory();
  assert.ok(Core.beginAct(s, 0)); assert.equal(s.act, 0);
});

test('rejected: any act but the first, and non-numbers, do not change the story', () => {
  const s = Core.newStory();
  Core.beginAct(s, 0);
  s.clock = 42;
  for (const bad of [-1, 1, 2, 7, 0.5, NaN, '0', null, undefined]){
    assert.equal(Core.beginAct(s, bad), false, String(bad));
    assert.equal(s.act, 0);
    assert.equal(s.clock, 42, 'a refused act does not restart the clock of the story');
  }
  assert.equal(Core.beginAct(null, 0), false);
});

test('Ending A: the letter found in Lisbon reveals the real culprit', () => {
  const s = playthrough([st => Core.beginAct(st, 0), st => { st.letter = true; }]);
  assert.equal(Core.storyEnding(s), 'A');
});

test('Ending B: without the letter the detective is framed', () => {
  const s = playthrough([st => Core.beginAct(st, 0)]);
  assert.equal(Core.storyEnding(s), 'B');
});

test('the letter only counts if the run it was found in was finished', () => {
  const s = Core.newStory();
  Core.beginAct(s, 0);
  s.letter = true;                    // found it ...
  Core.beginAct(s, Core.retryAct(s)); // ... but got busted and tried again
  assert.equal(s.letter, false);
  assert.equal(s.act, 0);
  assert.equal(Core.storyEnding(s), 'B');
  // found it again and finished: it decides the ending
  s.letter = true;
  assert.equal(Core.storyEnding(s), 'A');
});

test('radio lines play once each, in order, when their time comes', () => {
  const lines = [[5, 'a'], [9, 'b'], [32, 'c']];
  let r = Core.dueRadio(lines, 0, 4.9);
  assert.deepEqual(r, { due: [], idx: 0 });
  r = Core.dueRadio(lines, r.idx, 10);
  assert.deepEqual(r.due.map(l => l[1]), ['a', 'b']);
  r = Core.dueRadio(lines, r.idx, 10);
  assert.deepEqual(r.due, [], 'nothing repeats');
  r = Core.dueRadio(lines, r.idx, 999);
  assert.deepEqual(r, { due: [[32, 'c']], idx: 3 });
  assert.deepEqual(Core.dueRadio(lines, 3, 9999).due, [], 'past the end stays quiet');
});
