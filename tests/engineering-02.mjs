import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.VOID_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/engineering-02';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()),
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ],
});
const checks = [],
  errors = [];
async function resetProgress(page) {
  await page.goto(url);
  await page.locator('[data-action=start]').click();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => document.querySelector('#score').textContent === '0100');
  // Reload while playing, without pausing first: this exercises the real leave-page save.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#score')?.textContent === '0100');
  assert.match(await page.locator('#start-button').textContent(), /继续旅程/);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('void-explorer-save-v1')),
  );
  assert.equal(saved.discoveries['0-0'].scan, true);
  checks.push('普通刷新保留已扫描进度，并可继续旅程');

  await page.locator('[data-action=start]').click();
  await page.locator('[data-action=settings]').click();
  const reset = page.locator('[data-action=reset]');
  await reset.click();
  assert.match(await reset.textContent(), /确认清除/);
  assert.notEqual(await page.evaluate(() => localStorage.getItem('void-explorer-save-v1')), null);
  await Promise.all([page.waitForEvent('load'), reset.click()]);
  await page.waitForSelector('#start-button');
  assert.equal(await page.evaluate(() => localStorage.getItem('void-explorer-save-v1')), null);
  await page.waitForFunction(() => document.querySelector('#score')?.textContent === '0000');
  assert.match(await page.locator('#start-button').textContent(), /开始航行/);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#score')?.textContent === '0000');
  assert.equal(await page.evaluate(() => localStorage.getItem('void-explorer-save-v1')), null);
  await page.locator('[data-action=start]').click();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => document.querySelector('#score').textContent === '0100');
  checks.push('两次确认重置后旧存档不恢复，再次刷新仍为新游戏，且可重新获得积分');
}

async function markers(page) {
  await page.goto(url);
  await page.locator('[data-action=start]').click();
  const readMarkers = () =>
    page.locator('#contact-markers button').evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: node.querySelector('small').textContent,
        label: node.getAttribute('aria-label'),
        index: Number(node.dataset.value),
      })),
    );
  const expectedMarkers = (names) =>
    names.map((name, index) => ({ name, label: `锁定 ${name}`, index }));
  await page.keyboard.press('KeyM');
  const before = await page.locator('.map-planets strong').allTextContents();
  assert.deepEqual(await readMarkers(), expectedMarkers(before));
  await page.locator('[data-action=map-select][data-value="1"]').click();
  const after = await page.locator('.map-planets strong').allTextContents();
  assert.notDeepEqual(after, before);
  await page.locator('[data-action=jump]').click();
  // The target panel is updated after the real simulation jump and scene sync.
  await page.waitForFunction(
    (name) => document.querySelector('#target-name').textContent === name,
    after[0],
  );
  assert.deepEqual(await readMarkers(), expectedMarkers(after));
  checks.push('实际跨星系跃迁后，标记文字、aria-label、索引与当前星图一致');
  // Repeat the lifecycle by returning to the original system, without diagnostic placement.
  await page.keyboard.press('KeyM');
  await page.locator('[data-action=map-select][data-value="0"]').click();
  await page.locator('[data-action=jump]').click();
  await page.waitForFunction(
    (name) => document.querySelector('#target-name').textContent === name,
    before[0],
  );
  assert.deepEqual(await readMarkers(), expectedMarkers(before));
  checks.push('返回原星系后标记再次同步，目标索引保持原有规则');
}

let failure = null;
try {
  const selected = process.env.VOID_ENGINEERING_CASE;
  assert(selected === undefined || ['reset', 'contacts'].includes(selected));
  for (const [name, run] of [
    ['reset', resetProgress],
    ['contacts', markers],
  ]) {
    if (selected && selected !== name) continue;
    // Separate contexts prevent one regression from supplying another's saved state.
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await run(page);
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  checks.forEach((check) => console.log('PASS', check));
} catch (error) {
  failure = error;
  console.error(error);
  throw error;
} finally {
  try {
    await writeFile(
      `${out}/report.json`,
      JSON.stringify({ url, checks, errors, failure: failure?.stack ?? null }, null, 2),
    );
  } catch (error) {
    console.error('附加报告写入失败', error);
    if (!failure) throw error;
  } finally {
    await browser.close().catch((error) => {
      console.error('附加浏览器清理失败', error);
      if (!failure) throw error;
    });
  }
}
