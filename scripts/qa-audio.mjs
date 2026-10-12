import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
try {
  const page = await browser.newPage();
  const url = process.env.QA_URL || 'http://127.0.0.1:5173';
  await page.goto(`${url}/src/core/recorded-audio.js`);
  const report = await page.evaluate(async () => {
    const { createRecordedAudio } = await import('/src/core/recorded-audio.js');
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
    return { left, right, distances };
  });
  assert.ok(report.left.left > report.left.right * 1.1); assert.ok(report.right.right > report.right.left * 1.1);
  assert.ok(report.distances.every(value => value.left > 0 && value.right > 0));
  assert.ok(report.distances[0].left > report.distances[1].left && report.distances[1].left > report.distances[2].left);
  console.log(JSON.stringify({ ok: true, ...report }));
} finally { await browser.close(); }
