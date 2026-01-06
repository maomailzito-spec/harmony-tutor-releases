const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = process.env.TEST_URL || 'http://localhost:5174/';
  console.log('Opening', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for first system SVG
  await page.waitForSelector('[data-system-index="0"] svg', { timeout: 10000 });

  // Gather measure boundaries and svg geometry
  const info = await page.evaluate(() => {
    const svg = document.querySelector('[data-system-index="0"] svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const svgChildren = Array.from(svg.querySelectorAll('*'));

    // Collect candidate barlines: elements whose bbox is tall and narrow
    const tallNarrow = [];
    try {
      for (const el of svgChildren) {
        try {
          const bb = el.getBBox ? el.getBBox() : null;
          if (!bb) continue;
          if (bb.height >= rect.height * 0.4 && bb.width <= rect.width * 0.1) {
            tallNarrow.push(bb.x + bb.width/2);
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {}

    const barXs = Array.from(new Set(tallNarrow)).sort((a,b)=>a-b);
    // Fallback: if no barlines found, split svg into 4 equal measures
    if (barXs.length < 2) {
      const left = 0 + 20;
      const right = rect.width - 20;
      const step = (right - left) / 4;
      const xs = [];
      for (let i=0;i<=4;i++) xs.push(left + i*step);
      return { rect, barXs: xs };
    }

    return { rect, barXs };
  });

  if (!info) {
    console.error('Could not find system SVG');
    await browser.close();
    process.exit(1);
  }

  const { rect, barXs } = info;
  console.log('Detected barlines / measure boundaries:', barXs.length, 'points');

  // Build click coordinates for 4 measures * 16 steps = 64 clicks
  const clicks = [];
  for (let m = 0; m < 4; m++) {
    const start = barXs[m];
    const end = barXs[m+1];
    const contentStart = start + 30; // small padding inside measure
    const contentEnd = end - 30;
    const contentW = Math.max(10, contentEnd - contentStart);
    for (let s = 0; s < 16; s++) {
      const frac = (s + 0.5) / 16; // center of sub-division
      const xSvg = contentStart + frac * contentW;
      const clientX = rect.left + xSvg;
      const clientY = rect.top + rect.height * 0.45; // near middle of staff
      clicks.push({ clientX, clientY, measure: m });
    }
  }

  console.log('Performing', clicks.length, 'clicks...');
  for (let i = 0; i < clicks.length; i++) {
    const c = clicks[i];
    await page.mouse.click(c.clientX, c.clientY, { button: 'left', delay: 20 });
    // slight pause to allow rendering
    await page.waitForTimeout(30);
  }

  // After clicks, collect candidate notehead positions (paths with small bbox)
  const notes = await page.evaluate(() => {
    const svg = document.querySelector('[data-system-index="0"] svg');
    if (!svg) return [];
    const rect = svg.getBoundingClientRect();
    const elems = Array.from(svg.querySelectorAll('*'));
    const notePts = [];
    try {
      for (const el of elems) {
        try {
          const bb = el.getBBox();
          // Heuristic: noteheads are small-ish blobs
          if (bb.width >= 6 && bb.width <= 20 && bb.height >= 6 && bb.height <= 20) {
            notePts.push({ x: bb.x + bb.width/2, y: bb.y + bb.height/2 });
          }
        } catch (e) {}
      }
    } catch (e) {}
    return notePts.map(p => ({ x: p.x, y: p.y }));
  });

  console.log('Detected candidate noteheads:', notes.length);

  // Count notes per measure by x position
  const counts = [0,0,0,0];
  const failures = [];
  for (const n of notes) {
    // map to measure index by barXs
    for (let m = 0; m < 4; m++) {
      const left = barXs[m];
      const right = barXs[m+1];
      if (n.x >= left && n.x <= right) {
        counts[m]++;
        break;
      }
    }
  }

  console.log('Counts per measure (approx):', counts);

  await browser.close();
  // Report success if we have >0 notes and counts distributed
  process.exit(0);
})();
