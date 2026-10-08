// Optional browser regression: Playwright + Chromium; see docs/ARQUITETURA.md.
// Downloads and 3D loading run normally. Never intercept data to protect the intro.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function run() {
  const url = process.argv[2] || 'http://localhost:4173/';
  const directory = process.env.QA_ARTIFACT_DIR || path.join(os.tmpdir(), 'jogo-intro-qa');
  const [width, height] = (process.env.QA_VIEWPORT || '390x844').split('x').map(Number);
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.QA_CPU_RATE || 4) });
    await page.addInitScript(() => {
      window.introQA = { frames: [], tasks: [], stages: [], canvasAt: null, start: null, end: null };
      new PerformanceObserver(list => {
        for (const task of list.getEntries()) introQA.tasks.push({ start: task.startTime, duration: task.duration });
      }).observe({ type: 'longtask', buffered: true });
      addEventListener('DOMContentLoaded', () => {
        let active = false, previousStage = '';
        const background = () => getComputedStyle(document.querySelector('.menu-art'), '::after').backgroundImage;
        new MutationObserver(() => {
          const stage = document.querySelector('#loading-text')?.textContent;
          if (stage !== previousStage) { previousStage = stage; introQA.stages.push({ t: performance.now(), stage }); }
          if (introQA.canvasAt === null && document.querySelector('#app canvas')) introQA.canvasAt = performance.now();
        }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        function frame(t) {
          if (document.body.classList.contains('intro-playing')) {
            if (!active) { active = true; introQA.start = t; introQA.initialBackground = background(); }
            introQA.frames.push({ t, letters: [...document.querySelectorAll('.logo-letter')].filter(el => Number(getComputedStyle(el).opacity) > .5).length });
          } else if (active) {
            introQA.end = t; introQA.finalBackground = background();
            introQA.frames.push({ t, letters: 25 });
            return;
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => introQA.end !== null, null, { timeout: 180000 });
    const result = await page.evaluate(() => ({ ...introQA, resources: performance.getEntriesByType('resource').filter(r => r.name.includes('/data/')).map(r => ({ name: r.name, end: r.responseEnd })) }));
    const gaps = result.frames.slice(1).map((frame, i) => frame.t - result.frames[i].t);
    const maxGap = Math.max(...gaps), letterCounts = [...new Set(result.frames.map(frame => frame.letters))];
    const fullTitleAt = result.frames.find(frame => frame.letters === 25).t - result.start;
    const longTasks = result.tasks.filter(task => task.start < result.end && task.start + task.duration > result.start);
    fs.writeFileSync(path.join(directory, 'intro.json'), JSON.stringify({ ...result, maxGap, letterCounts, fullTitleAt, errors }, null, 2));
    assert.ok(maxGap < 150, `Opening stalled for ${maxGap.toFixed(1)}ms`);
    assert.ok(letterCounts.length >= 20, 'The title must appear progressively, not jump from gra to the full logo');
    assert.ok(fullTitleAt < 5000, 'All letters must be visible before removing the intro class');
    assert.equal(result.initialBackground, result.finalBackground, 'Finishing must not switch the background abruptly');
    assert.ok(result.canvasAt === null || result.canvasAt >= result.end, 'WebGL must wait for the final opening frame');
    assert.ok(!longTasks.some(task => task.duration >= 150), 'Heavy work must stay outside the intro');
    assert.ok(result.resources.length >= 3 && result.resources.every(r => r.end <= result.end), 'Real data downloads must proceed during the intro');
    assert.ok(await page.locator('.logo-word').evaluateAll(words => words.every(word => word.offsetHeight < parseFloat(getComputedStyle(word).fontSize) * 1.1)), 'Logo words must stay on one line');
    // Only the opening is profiled under throttling; restore normal speed for
    // scene readiness/input checks on headless software WebGL.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.screenshot({ path: path.join(directory, 'intro.png') });
    await page.waitForFunction(() => window.__cdd && !document.querySelector('#play').disabled, null, { timeout: 180000 });
    const idleFrame = await page.evaluate(() => __cdd.renderer.info.render.frame);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => __cdd.renderer.info.render.frame), idleFrame, 'Opaque menus must not redraw the hidden city');
    await page.locator('#play').tap();
    await page.waitForFunction(frame => __cdd.player.active && __cdd.renderer.info.render.frame > frame, idleFrame);
    await page.locator('#btn-menu').tap();
    assert.equal(await page.locator('#settings-open').isEnabled(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport: [width, height], frames: result.frames.length, maxGap, fullTitleAt, letterCounts, longTasks, errors, sceneReady: true }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
