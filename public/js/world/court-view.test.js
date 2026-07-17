// public/js/world/court-view.test.js — Story 3.1.
//
// buildCourtView is the DOM-free join/grouping that assembles the Court page's
// three-section model from the two already-projected payloads. It is pure, so
// it is unit-tested directly under node:test (mirroring world.test.js's
// buildWorldView coverage) — no browser, no jsdom. These tests pin the join
// discipline (String-normalised _id, honest gaps, no fabricated holder), the
// Regents-only rule, the covenant grouping + catch-all, the office-badge
// agreement between Court and Who's Who, and the truthful counts/empty states.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourtView } from './court-view.js';

// A small fixture: three active characters, one holding a title, one a regent,
// plus a title-holder who is NOT on the active roster (honest-gap case).
function fixture() {
  const roster = {
    characters: [
      { _id: 'a1', name: 'Eve Lockridge', honorific: 'Head of State', clan: 'Daeva', covenant: 'Carthian Movement' },
      { _id: 'b2', name: 'Jack Fallow', clan: 'Mekhet', covenant: 'Circle of the Crone' },
      { _id: 'c3', name: 'Xavier Boussade', clan: 'Nosferatu', covenant: 'Carthian Movement' },
    ],
  };
  const world = {
    territories: [
      { territory: 'The Academy', regent: { _id: 'b2', name: 'Jack Fallow', honorific: 'The Academy' } },
      { territory: 'The Dockyards', regent: null },
    ],
    titleGroups: [
      { honorific: 'Head of State', holders: [{ _id: 'a1', name: 'Eve Lockridge', honorific: 'Head of State' }] },
      // A title-holder absent from the active roster: still renders, name + badge only.
      { honorific: 'Ghost Office', holders: [{ _id: 'zz', name: 'Departed Elder', honorific: 'Ghost Office' }] },
    ],
  };
  return { world, roster };
}

test('Court: one row per title-holder, clan/covenant resolved from roster', () => {
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  assert.equal(view.court.length, 2);
  const eve = view.court.find((r) => r.id === 'a1');
  assert.equal(eve.name, 'Eve Lockridge');
  assert.equal(eve.title, 'Head of State');
  assert.equal(eve.clan, 'Daeva');
  assert.equal(eve.covSlug, 'carthian-movement');
});

test('Court: a title-holder absent from the active roster renders name + badge only (honest gap)', () => {
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  const ghost = view.court.find((r) => r.id === 'zz');
  assert.ok(ghost, 'the off-roster holder still appears');
  assert.equal(ghost.name, 'Departed Elder');
  assert.equal(ghost.title, 'Ghost Office');
  assert.equal(ghost.clan, null); // no clan guessed
  assert.equal(ghost.covSlug, null); // no crest guessed
});

test('Regencies: one row per territory, Regent only, vacant seat honest', () => {
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  assert.equal(view.regencies.length, 2);
  const academy = view.regencies.find((r) => r.territory === 'The Academy');
  assert.equal(academy.vacant, false);
  assert.equal(academy.name, 'Jack Fallow');
  assert.equal(academy.clan, 'Mekhet');
  assert.equal(academy.covSlug, 'circle-of-the-crone');
  const docks = view.regencies.find((r) => r.territory === 'The Dockyards');
  assert.equal(docks.vacant, true);
  assert.equal(docks.name, undefined); // never a fabricated holder
});

test('Regencies: a Lieutenant never appears (Regents only)', () => {
  const world = {
    territories: [{
      territory: 'The Harbour',
      regent: null,
      lieutenant: { _id: 'x9', name: 'Some Lieutenant' },
    }],
    titleGroups: [],
  };
  const view = buildCourtView(world, { characters: [] });
  assert.equal(view.regencies.length, 1);
  assert.equal(view.regencies[0].vacant, true); // regent null -> Vacant, lieutenant ignored
  const serialised = JSON.stringify(view);
  assert.ok(!serialised.includes('Some Lieutenant'), 'lieutenant is never surfaced');
});

test("Who's Who: full roster grouped by covenant, alphabetical", () => {
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  const names = view.whosWho.map((g) => g.covenant);
  assert.deepEqual(names, ['Carthian Movement', 'Circle of the Crone']);
  const carthian = view.whosWho.find((g) => g.covenant === 'Carthian Movement');
  assert.equal(carthian.covSlug, 'carthian-movement');
  // Two Carthians (Eve, Xavier), sorted by sortName.
  assert.deepEqual(carthian.rows.map((r) => r.name), ['Eve Lockridge', 'Xavier Boussade']);
});

test("Who's Who: office badge cross-references the SAME title index as Court", () => {
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  const carthian = view.whosWho.find((g) => g.covenant === 'Carthian Movement');
  const eve = carthian.rows.find((r) => r.id === 'a1');
  assert.equal(eve.title, 'Head of State'); // she holds a title -> badge
  const xavier = carthian.rows.find((r) => r.id === 'c3');
  assert.equal(xavier.title, null); // no title -> no badge
});

test("Who's Who: empty/absent/unrecognised covenant falls into an honest catch-all, last", () => {
  const roster = {
    characters: [
      { _id: 'p1', name: 'No Cov', clan: 'Ventrue' }, // covenant absent
      { _id: 'p2', name: 'Weird Cov', clan: 'Daeva', covenant: 'Made Up Sect' }, // unrecognised
      { _id: 'p3', name: 'Real Cov', clan: 'Mekhet', covenant: 'Invictus' },
      // Ordo Dracul sorts alphabetically AFTER the 'No covenant recorded' label,
      // so it proves the catch-all is forced last by rule, not by coincidence:
      // a plain localeCompare would wrongly place this recognised group after
      // the catch-all (review F1 discrimination gap).
      { _id: 'p4', name: 'Order Man', clan: 'Ventrue', covenant: 'Ordo Dracul' },
    ],
  };
  const view = buildCourtView({ territories: [], titleGroups: [] }, roster);
  const names = view.whosWho.map((g) => g.covenant);
  const last = view.whosWho[view.whosWho.length - 1];
  assert.equal(last.covenant, 'No covenant recorded');
  assert.equal(last.covSlug, null); // no broken icon
  assert.equal(last.rows.length, 2); // both the absent and the unrecognised
  assert.equal(names[0], 'Invictus'); // recognised group first
  // The catch-all is forced last even against an alphabetically-later recognised
  // covenant (Ordo Dracul), not merely by luck of the label sorting last.
  assert.ok(
    names.indexOf('Ordo Dracul') < names.indexOf('No covenant recorded'),
    'catch-all must stay last even against an alphabetically-later recognised covenant',
  );
});

test('join is String-normalised on both _id sides (number vs string)', () => {
  const roster = { characters: [{ _id: 7, name: 'Seven', clan: 'Gangrel', covenant: 'Invictus' }] };
  const world = {
    territories: [{ territory: 'T', regent: { _id: '7', name: 'Seven' } }],
    titleGroups: [{ honorific: 'Boss', holders: [{ _id: '7', name: 'Seven' }] }],
  };
  const view = buildCourtView(world, roster);
  assert.equal(view.court[0].clan, 'Gangrel'); // number 7 matched string '7'
  assert.equal(view.regencies[0].clan, 'Gangrel');
});

test('counts are truthful and empty inputs yield honest empty sections without crashing', () => {
  const empty = buildCourtView({}, {});
  assert.deepEqual(empty.court, []);
  assert.deepEqual(empty.regencies, []);
  assert.deepEqual(empty.whosWho, []);
  const { world, roster } = fixture();
  const view = buildCourtView(world, roster);
  assert.equal(view.court.length, 2);
  assert.equal(view.regencies.length, 2);
  const whosWhoTotal = view.whosWho.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(whosWhoTotal, 3); // full active roster
});
