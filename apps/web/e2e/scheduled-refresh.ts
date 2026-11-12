import type { Page } from '@playwright/test';

export async function controlScheduledRefresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const browser: Window = window;
    const setInterval = browser.setInterval.bind(browser);
    const clearInterval = browser.clearInterval.bind(browser);
    browser.setInterval = (callback, timeout, ...args) => {
      const handle = setInterval(callback, timeout, ...args);
      if (timeout === 9 * 60 * 1000 && typeof callback === 'function') {
        window.addEventListener(
          'test:refresh',
          () => {
            clearInterval(handle);
            callback(...args);
          },
          { once: true },
        );
      }
      return handle;
    };
  });
}

export async function runScheduledRefresh(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('test:refresh')));
}
