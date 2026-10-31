// 공유 썸네일 생성: scripts/og/og.html 을 Playwright(chromium)로 찍는다.
//   public/og-image.jpg        1200x630  (og:image, twitter:image)
//   public/apple-touch-icon.png 180x180  (홈 화면 아이콘)
// 실행: node scripts/og/render-og.cjs
//   playwright 는 이 레포 의존성이 아니라서 PLAYWRIGHT_PATH(기본: C:/dev/qa-playwright-harness/node_modules/playwright)에서 불러온다.
const path = require('path');
const { pathToFileURL } = require('url');

const PW = process.env.PLAYWRIGHT_PATH || 'C:/dev/qa-playwright-harness/node_modules/playwright';
const { chromium } = require(PW);

const root = path.resolve(__dirname, '..', '..');
const page = pathToFileURL(path.join(__dirname, 'og.html')).href;

(async () => {
  const browser = await chromium.launch();
  const shoot = async (w, h, query, out) => {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(page + query);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const jpg = out.endsWith('.jpg');
    await p.screenshot({ path: path.join(root, 'public', out), ...(jpg ? { type: 'jpeg', quality: 88 } : {}) });
    await p.close();
    console.log('wrote public/' + out);
  };
  await shoot(1200, 630, '', 'og-image.jpg');
  await shoot(180, 180, '?icon', 'apple-touch-icon.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
