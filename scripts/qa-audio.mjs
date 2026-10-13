import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
try {
  const page = await browser.newPage();
  const url = process.env.QA_URL || 'http://127.0.0.1:5173';
  await page.goto(`${url}/src/core/recorded-audio.js`);
  const report = await page.evaluate(async () => {
    const { createRecordedAudio, SHOT_PROFILES } = await import('/src/core/recorded-audio.js');
    const fidelity = [];
    for (const [weapon, { volume }] of Object.entries(SHOT_PROFILES)) {
      const context = new OfflineAudioContext(2, 48000 * 8, 48000);
      const audio = createRecordedAudio({ context, bus: context.destination, audible: () => true });
      await audio.preload();
      audio.setListener({ x: 0, y: 0, z: 4 });
      audio.shot(weapon, { local: true, position: { x: .18, y: -.24, z: -.4 } });
      const actual = await context.startRendering();
      const reference = new OfflineAudioContext(2, actual.length, actual.sampleRate);
      const file = weapon === 'pistol' ? 'pistol-clean.wav' : `${weapon}.mp3`;
      const source = reference.createBufferSource();
      source.buffer = await reference.decodeAudioData(await (await fetch(`/audio/snakef8/${file}`)).arrayBuffer());
      const gain = reference.createGain(); gain.gain.value = volume;
      source.connect(gain); gain.connect(reference.destination); source.start();
      const expected = await reference.startRendering();
      let maxError = 0, errorEnergy = 0, referenceEnergy = 0;
      for (let channel = 0; channel < 2; channel++) {
        const a = actual.getChannelData(channel), b = expected.getChannelData(channel);
        for (let i = 0; i < a.length; i++) {
          const error = a[i] - b[i]; maxError = Math.max(maxError, Math.abs(error));
          errorEnergy += error * error; referenceEnergy += b[i] * b[i];
        }
      }
      fidelity.push({ weapon, maxError, relativeError: Math.sqrt(errorEnergy / referenceEnergy) });
      audio.dispose();
    }
    async function render(position) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const audio = createRecordedAudio({ context, bus: context.destination, audible: () => true, random: () => .5 });
      await audio.preload(); audio.setListener({ x: 0, y: 0, z: 0 }); audio.shot('pistol', { position });
      const buffer = await context.startRendering();
      const rms = channel => Math.sqrt(buffer.getChannelData(channel).reduce((sum, value) => sum + value * value, 0) / buffer.length);
      audio.dispose(); return { left: rms(0), right: rms(1) };
    }
    const left = await render({ x: -3, y: 0, z: -1 }), right = await render({ x: 3, y: 0, z: -1 });
    const distances = [];
    for (const distance of [3, 9, 30]) distances.push({ distance, ...await render({ x: 0, y: 0, z: -distance }) });
    return { fidelity, left, right, distances };
  });
  if (process.env.QA_REPORT_PATH) await fs.writeFile(process.env.QA_REPORT_PATH, JSON.stringify(report, null, 2));
  for (const result of report.fidelity) assert.ok(result.maxError < 1e-7, `${result.weapon}: local shot differs from original recording (${result.maxError})`);
  assert.ok(report.left.left > report.left.right * 1.1); assert.ok(report.right.right > report.right.left * 1.1);
  assert.ok(report.distances.every(value => value.left > 0 && value.right > 0));
  assert.ok(report.distances[0].left > report.distances[1].left && report.distances[1].left > report.distances[2].left);
  console.log(JSON.stringify({ ok: true, ...report }));
} finally { await browser.close(); }
