import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deviceBrowser } from './device-browser.mjs';
import { finishWithEvidence } from './failure-evidence.mjs';

const url = process.env.VOID_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.VOID_AUDIO_OUT ?? 'test-results/product-polish-02';
await mkdir(out, { recursive: true });
const report = { url, checks: [], errors: [], samples: [], status: 'running' };
const { browser } = await deviceBrowser();
report.browser = await browser.version();
let failure = null;
let page;
const check = (name) => {
  report.checks.push(name);
  console.log('PASS', name);
};
async function newPage(mode = '') {
  const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  p.on('pageerror', (e) => report.errors.push(e.stack));
  await p.addInitScript((mode) => {
    if (mode === 'legacy-param') AudioParam.prototype.cancelAndHoldAtTime = undefined;
    const Native = window.AudioContext;
    const state = (window.__audioTest = {
      contexts: [],
      sources: [],
      gains: [],
      oscillators: [],
      resumes: 0,
      decodes: 0,
    });
    if (mode === 'unsupported') {
      window.AudioContext = undefined;
      return;
    }
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        state.contexts.push(this);
      }
      createGain() {
        const g = super.createGain();
        state.gains.push(g);
        return g;
      }
      createOscillator() {
        const o = super.createOscillator();
        state.oscillators.push(o);
        return o;
      }
      createBufferSource() {
        const s = super.createBufferSource();
        state.sources.push(s);
        return s;
      }
      decodeAudioData(...args) {
        state.decodes++;
        return super.decodeAudioData(...args);
      }
      resume() {
        state.resumes++;
        return mode === 'denied' && !state.allowResume
          ? Promise.reject(new DOMException('Test policy denial', 'NotAllowedError'))
          : super.resume();
      }
    };
  }, mode);
  await p.goto(url);
  await p.waitForFunction(() => !document.querySelector('#start-button').disabled, null, {
    timeout: 120000,
  });
  return p;
}
async function state(p = page) {
  return p.evaluate(() => {
    const a = window.__audioTest,
      c = a.contexts[0],
      b = a.sources[0]?.buffer;
    return {
      contexts: a.contexts.length,
      state: c?.state,
      time: c?.currentTime,
      sources: a.sources.length,
      decodes: a.decodes,
      duration: b?.duration,
      bytes: b ? b.length * b.numberOfChannels * 4 : 0,
      gains: a.gains.map((g) => g.gain.value),
      resumes: a.resumes,
      oscillators: a.oscillators.length,
      sampleRate: c?.sampleRate,
      heap: performance.memory?.usedJSHeapSize,
    };
  });
}
const waitState = (p, state) =>
  p.waitForFunction((s) => window.__audioTest.contexts[0]?.state === s, state, { timeout: 15000 });
const settings = async (p = page) => {
  await p.locator('.topbar [data-action=settings]').click();
  await p.waitForSelector('#music-setting');
};
const close = async (p = page) => p.locator('.modal [data-action=close]').click();
try {
  page = await newPage();
  let musicRequests = 0;
  page.on('request', (r) => {
    if (/\.mp3(?:\?|$)/.test(r.url())) musicRequests++;
  });
  assert.equal((await state()).contexts, 0);
  assert.equal(
    await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter(
            (r) =>
              /\.mp3$/.test(new URL(r.name).pathname) &&
              !new URL(r.name).searchParams.has('import'),
          ).length,
    ),
    0,
  );
  check('no AudioContext or music request before user interaction');
  const started = Date.now();
  await page.locator('.welcome [data-action=help]').click();
  await page.waitForFunction(() => window.__audioTest.sources[0]?.buffer, null, { timeout: 30000 });
  await waitState(page, 'running');
  report.readyMs = Date.now() - started;
  let s = await state();
  assert.equal(s.contexts, 1);
  assert.equal(s.sources, 1);
  assert.equal(s.decodes, 1);
  assert(Math.abs(s.duration - 144) < 0.02);
  assert(s.bytes <= 56 * 1024 * 1024);
  assert.equal(musicRequests, 1);
  report.samples.push(s);
  check('opening gesture unlocks one looping 144-second score without blocking UI');
  await close();
  await settings();
  await page.locator('#music-setting').click();
  await page.waitForTimeout(1000);
  assert((await state()).gains[2] < 0.01);
  assert.equal((await state()).state, 'running');
  await page.locator('#music-setting').click();
  await page.locator('#audio-setting').click();
  await waitState(page, 'suspended');
  const paused = (await state()).time;
  await page.waitForTimeout(500);
  assert.equal((await state()).time, paused);
  await page.locator('#audio-setting').click();
  await waitState(page, 'running');
  check('independent music control preserves effects; total mute suspends the audio clock');
  await close();
  await page.locator('#start-button').click();
  await waitState(page, 'running');
  await page.keyboard.press('Escape');
  await waitState(page, 'suspended');
  await page.locator('[data-action=resume]').click();
  await waitState(page, 'running');
  check('start and pause/resume keep the same context/source and continuous musical position');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitState(page, 'suspended');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(350);
  assert.equal((await state()).state, 'suspended', 'focus must not dismiss game pause');
  await page.locator('[data-action=resume]').click();
  await waitState(page, 'running');
  check('blur fades and suspends; focus respects the existing game pause');
  for (let i = 0; i < 8; i++) {
    await settings();
    await waitState(page, 'suspended');
    await page.locator('#music-setting').click();
    await page.locator('#music-setting').click();
    await close();
    await waitState(page, 'running');
  }
  s = await state();
  assert.equal(s.contexts, 1);
  assert.equal(s.sources, 1);
  assert.equal(s.decodes, 1);
  report.samples.push(s);
  check('eight menu/toggle cycles create no duplicate context, source, or decode');
  // Inspect the real browser decoder and render the last/first 12 seconds together.
  report.loop = await page.evaluate(async () => {
    const b = window.__audioTest.sources[0].buffer,
      rate = b.sampleRate;
    const offline = new OfflineAudioContext(2, rate * 24, rate);
    const source = offline.createBufferSource();
    source.buffer = b;
    source.loop = true;
    source.loopEnd = 144;
    source.connect(offline.destination);
    source.start(0, 132);
    const rendered = await offline.startRendering();
    let max = 0,
      clipped = 0,
      seam = 0,
      nearby = 0;
    for (let c = 0; c < 2; c++) {
      const d = rendered.getChannelData(c);
      seam = Math.max(seam, Math.abs(d[12 * rate] - d[12 * rate - 1]));
      for (let i = 1; i < d.length; i++) {
        max = Math.max(max, Math.abs(d[i]));
        if (Math.abs(d[i]) >= 1) clipped++;
        if (Math.abs(i - 12 * rate) < rate) nearby = Math.max(nearby, Math.abs(d[i] - d[i - 1]));
      }
    }
    return {
      seconds: rendered.duration,
      sampleRate: rate,
      seamDelta: seam,
      nearbyMaxDelta: nearby,
      peak: max,
      clipped,
    };
  });
  assert.equal(report.loop.clipped, 0);
  assert(report.loop.seamDelta <= report.loop.nearbyMaxDelta);
  check('actual browser decoded loop has exact duration, no clipping, and bounded seam derivative');
  // Real audio-clock playback, no seek/rate change. Allow cloud scheduling delay,
  // but require the full requested duration to actually traverse the source.
  const seconds = Number(process.env.VOID_AUDIO_SECONDS ?? 150);
  const begin = await state();
  const wallStart = Date.now();
  let end = begin;
  while (end.time - begin.time < seconds) {
    await page.waitForTimeout(15000);
    end = await state();
    report.samples.push(end);
    assert.equal(end.state, 'running');
    assert.equal(end.sources, 1);
    assert.equal(end.contexts, 1);
    assert(Date.now() - wallStart < (seconds * 2 + 30) * 1000, 'audio clock stalled');
    console.log('PLAYBACK audio seconds', end.time - begin.time);
  }
  report.continuousSeconds = end.time - begin.time;
  report.playbackWallSeconds = (Date.now() - wallStart) / 1000;
  check(`${seconds}s actual audio-clock playback: one source and one decoded buffer`);
  await settings();
  await page.locator('#music-setting').click();
  await page.locator('#audio-setting').click();
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#start-button').disabled);
  await settings();
  assert.equal(await page.locator('#music-setting').textContent(), '已关闭');
  assert.equal(await page.locator('#audio-setting').textContent(), '已关闭');
  assert.equal((await state()).contexts, 0);
  check('settings reload preserves both switches without autoplay or preload');
  await page.close();
  for (const mode of ['missing', 'corrupt', 'denied', 'unsupported']) {
    page = await newPage(mode);
    if (mode === 'missing')
      await page.route('**/*.mp3', (r) =>
        r.fulfill({ status: 404, body: 'deliberately missing test asset' }),
      );
    if (mode === 'corrupt')
      await page.route('**/*.mp3', (r) =>
        r.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'invalid audio bytes' }),
      );
    await page.locator('#start-button').click();
    await page.waitForSelector('#interface.playing');
    if (mode === 'missing' || mode === 'corrupt') {
      await page.waitForTimeout(2500);
      assert.equal((await state()).sources, 0);
      assert.equal((await state()).state, 'running');
    }
    if (mode === 'denied') {
      await page.waitForTimeout(500);
      assert((await state()).resumes <= 2);
    }
    await settings();
    assert.match(await page.locator('#music-status').textContent(), /暂不可用|浏览器未开启声音/);
    if (mode === 'denied') {
      await page.evaluate(() => {
        window.__audioTest.allowResume = true;
      });
      await page.locator('#audio-setting').click();
      await page.locator('#audio-setting').click();
    }
    await close();
    if (mode === 'denied') {
      await waitState(page, 'running');
      await settings();
      assert.doesNotMatch(await page.locator('#music-status').textContent(), /浏览器未开启声音/);
      await close();
    }
    assert.equal(await page.locator('#interface.playing').count(), 1);
    check(`${mode}: audio failure does not block start, controls, or settings`);
    await page.close();
  }
  page = await newPage('legacy-param');
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__audioTest.sources[0]?.buffer);
  await waitState(page, 'running');
  await settings();
  await page.locator('#audio-setting').click();
  await waitState(page, 'suspended');
  await page.locator('#audio-setting').click();
  await close();
  await waitState(page, 'running');
  assert.equal((await state()).sources, 1);
  check('missing hold API: portable gain automation plays, mutes, and resumes safely');
  await page.close();
  page = await newPage();
  await page.route('**/*.mp3', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await r.continue().catch(() => {});
  });
  await page.locator('#start-button').click();
  await page.evaluate(() =>
    document
      .querySelector('canvas')
      .getContext('webgl2')
      .getExtension('WEBGL_lose_context')
      .loseContext(),
  );
  await page.waitForTimeout(2500);
  assert.equal((await state()).state, 'closed');
  assert.equal((await state()).sources, 0);
  check('context loss during async load closes audio and never starts a late source');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (e) {
  failure = e;
  report.status = 'failed';
}
report.failure = failure?.stack;
await finishWithEvidence(
  failure,
  async () => {
    if (failure && page && !page.isClosed()) {
      report.final = await state();
      await page.screenshot({ path: `${out}/failure.png` });
    }
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  },
  () => browser.close(),
);
