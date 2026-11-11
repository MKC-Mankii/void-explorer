import { chromium, firefox, webkit } from '@playwright/test';
import { existsSync } from 'node:fs';

export async function deviceBrowser() {
  const name = process.env.VOID_BROWSER ?? 'chromium';
  const type = { chromium, firefox, webkit }[name];
  if (!type) throw new Error(`Unknown browser: ${name}`);
  const software = process.env.VOID_SOFTWARE === '1';
  const executablePath =
    process.env.VOID_BROWSER_PATH ??
    (name === 'chromium' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const args =
    name === 'chromium'
      ? [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          ...(software ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : []),
        ]
      : [];
  const browser = await type.launch({
    executablePath,
    headless: process.env.VOID_HEADED !== '1',
    args,
  });
  return { browser, name, software, executablePath: executablePath ?? type.executablePath() };
}

// Counts API object lifetimes, not bytes or driver allocations. WeakSets do not retain GL objects.
export function installGLCounters() {
  const counters = {};
  window.__glCounters = counters;
  for (const type of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader']) {
    const proto = WebGL2RenderingContext.prototype;
    const create = proto[`create${type}`],
      remove = proto[`delete${type}`];
    const live = new WeakSet();
    const count = (counters[type] = { created: 0, deleted: 0, live: 0 });
    proto[`create${type}`] = function (...args) {
      const object = create.apply(this, args);
      if (object) {
        live.add(object);
        count.created++;
        count.live++;
      }
      return object;
    };
    proto[`delete${type}`] = function (object) {
      if (object && live.has(object)) {
        live.delete(object);
        count.deleted++;
        count.live--;
      }
      return remove.call(this, object);
    };
  }
}
