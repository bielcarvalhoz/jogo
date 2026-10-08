import test from 'node:test';
import assert from 'node:assert/strict';
import { planEntranceStairs, chooseEntranceStairs } from '../../src/campus/stairs.js';

const C = { RI: { clearance: () => ({ d: 20 }) }, inRegion: () => true, insideSolid: () => false };
const e = { x: 0, z: 0, dx: 1, dz: 0, nx: 0, nz: 1, L: 50, clearance: 20 };
const flat = { heightAt: () => 0 };

test('a pavilion entrance replaces two tall steps with walkable rises and generous treads', () => {
  const p = planEntranceStairs(C, { style: 'pavilion' }, { gMin: .2 }, e, flat);
  assert.ok(p);
  assert.equal(p.steps, 4);
  assert.ok(p.dh <= .17 && p.tread >= .27);
  assert.equal(p.landing + p.run, 2.65);
  let previous = p.bottomY;
  for (let i = 1; i <= p.steps; i++) {
    const y = p.entryY - (p.steps - i) * p.dh;
    assert.ok(y - previous <= .1700001, 'the ground-to-first-tread rise also stays below 17 cm');
    previous = y;
  }
  assert.ok(Math.abs(previous - p.entryY) < 1e-8);
});

test('an elevated building extends the stair run instead of packing more risers into 2.15 m', () => {
  const p = planEntranceStairs(C, { planId: 'b28' }, { gMin: 2.4 }, e, flat);
  assert.ok(p);
  assert.ok(p.steps >= 20 && p.run >= 6);
  assert.ok(p.dh <= .17 && p.tread >= .27);
  assert.ok(p.landing + p.run <= e.clearance - .55);
  assert.ok(Math.abs(p.entryY - 3.3) < 1e-8);
});

test('a narrow setback cannot produce an impossible staircase over the roadway', () => {
  assert.equal(planEntranceStairs(C, { planId: 'b3' }, { gMin: 3 }, { ...e, clearance: 4.9 }, flat), null);
});

test('a road bend or obstruction between clear endpoints rejects the entire run', () => {
  const obstruction = { ...C, insideSolid: (_x, z) => z > 1.8 && z < 2.2 };
  assert.equal(planEntranceStairs(obstruction, {}, { gMin: .3 }, e, flat), null);
  const roadBend = { ...C, RI: { clearance: (_x, z) => ({ d: z > 1.8 && z < 2.2 ? .1 : 20 }) } };
  assert.equal(planEntranceStairs(roadBend, {}, { gMin: .3 }, e, flat), null);
});

test('a blocked frontage chooses a real side facade, while photographed paired doors stay fixed', () => {
  const b = { rings: [[[0,0],[20,0],[20,12],[0,12]]] };
  const frontage = { ...e, x: 10, z: 12, clearance: 7.5 };
  const roads = [{ internal: true, w: 5, pts: [[0,22],[20,22]] }, { internal: true, w: 5, pts: [[30,0],[30,12]] }];
  const site = { ...C, RI: { clearance: (_x, z) => ({ d: z > 13 && z < 15 ? .1 : 20 }) } };
  const choice = chooseEntranceStairs(site, b, { gMin: .4 }, frontage, flat, roads);
  assert.ok(choice);
  assert.equal(choice.frontage.x, 20);
  assert.equal(choice.frontage.z, 6);
  assert.ok(choice.stairs.dh <= .17 && choice.stairs.tread >= .27);
  assert.equal(chooseEntranceStairs(site, { ...b, planId: 'b3' }, { gMin: .4 }, frontage, flat, roads), null);
});
