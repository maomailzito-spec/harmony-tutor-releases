const puppeteer = require('puppeteer');

(async () => {
  const ports = [5173, 5174];
  for (const port of ports) {
    const url = `http://localhost:${port}/?autotest=16ths`;
    console.log('Trying', url);
    try {
      const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();

      page.on('console', msg => {
        try { console.log('[PAGE]', msg.text()); } catch (_) {}
      });
      page.on('pageerror', err => console.log('[PAGE ERROR]', err && err.toString ? err.toString() : err));

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      } catch (e) {
        console.log('goto error:', e && e.message ? e.message : e);
        await browser.close();
        continue;
      }

      console.log('Opened', url, '- waiting for autotest log (15s)');
      const found = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), 15000);
        page.on('console', m => {
          const t = m.text();
          if (t && t.indexOf && t.indexOf('[autotest-16ths]') !== -1) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
      });

      if (found) {
        console.log('Autotest log found for', url);
        await browser.close();
        process.exit(0);
      }

      console.log('No autotest log for', url);
      await browser.close();
    } catch (e) {
      console.log('Error launching puppeteer or opening page:', e && e.message ? e.message : e);
    }
  }
  console.log('Autotest not found on tested ports');
  process.exit(2);
})();
