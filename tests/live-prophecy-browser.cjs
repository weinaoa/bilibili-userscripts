// Offline Chromium integration: every URL is intercepted. No real account or
// participation request. Run both document-start iframe injection and parent fallback.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const measurePanelStability = require('./helpers/prophecy-layout.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-live-prophecy.user.js'), 'utf8');
const room = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f1f2f3;font:16px sans-serif;min-height:1800px}#player{width:calc(100% - 470px);height:380px;background:#18191c;margin:64px 16px;color:white}video{width:100%;height:320px}.chat-control-panel{position:absolute;right:16px;top:700px;width:400px}.chat-history-panel{position:absolute;right:16px;top:100px;width:400px;height:600px;z-index:9;background:#fff;overflow:hidden}#chat-history-list{height:100%;overflow:auto}</style>
<div id="player">直播播放器<video muted autoplay playsinline></video><div id="danmaku">弹幕运行中</div></div>
<!--chat-history-->
<div class="chat-control-panel"><textarea>未发送的弹幕</textarea><button id="send">发送</button></div>
<script>window.originalVideo=document.querySelector('video');window.sent=0;document.querySelector('#send').onclick=()=>window.sent++;
const canvas=document.createElement('canvas');canvas.width=80;canvas.height=45;const ctx=canvas.getContext('2d');let tick=0;setInterval(()=>{ctx.fillStyle=++tick%2?'#0084b0':'#fb7299';ctx.fillRect(0,0,80,45);document.querySelector('#danmaku').textContent='弹幕 '+tick},50);originalVideo.srcObject=canvas.captureStream(10);originalVideo.play();</script>`;
const official = `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="app"><div id="main"><div class="user-detail-content">
<h3>官方组件交互 fixture</h3><button id="choice">选择预言选项</button><a href="#/history" target="_blank" id="history">参与历史</a><a href="#/doc" target="_blank" id="rules">规则</a><p style="height:1500px">内部滚动内容</p></div></div></main>
<script>
window.initCount=(window.initCount||0)+1;window.calls=[];window.outcomes=[];
const sdk={getEnvSync:()=>-1,Request:function OfficialRequest(){},showConfirm:()=>{throw Error('native bridge must be adapted')}};
const api={post:(url,data)=>{calls.push({url,data});return new Promise(resolve=>window.finishRequest=resolve)}};
const modules={1171(m,e){e.Ay=sdk},6151(m,e){e.E=api}},cache={};
const require=id=>{if(!cache[id]){cache[id]={};modules[id]({},cache[id],require)}return cache[id]};require.m=modules;
const queue=window.webpackChunkguessing_game=window.webpackChunkguessing_game||[];
const records=[...queue];queue.push=record=>{Object.assign(modules,record[1]);record[2]?.(require);return Array.prototype.push.call(queue,record)};records.forEach(record=>queue.push(record));
window.sdk=require(1171).Ay;window.api=require(6151).E;
document.querySelector('#choice').onclick=async()=>{const result=await sdk.showConfirm({title:'模拟确认',content:'仅本地 fixture，取消不会产生请求'});outcomes.push(result);if(result.confirm){await new Promise(resolve=>window.finishBalance=resolve);await api.post('/xlive/app-ucenter/v1/elden/user_join',{answer:1});sdk.showToast({msg:'模拟响应已返回'})}};
</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'chrome' }) });
  let passed = 0;
  try {
    for (const injectChild of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/room/v1/Room/room_init') return route.fulfill({ json: { code: 0, data: { uid: url.searchParams.get('id') === '999' ? 777 : 353609978 } }, headers: { 'access-control-allow-origin': '*' } });
        if (url.pathname === '/p/html/live-app-guessing-game/index.html') return route.fulfill({ contentType: 'text/html', body: official });
        if (/^\/\d+$/.test(url.pathname)) {
          const history = injectChild ? '<div class="chat-history-panel"><div id="chat-history-list"><p style="height:1400px">弹幕列表</p></div></div>' : '';
          return route.fulfill({ contentType: 'text/html', body: room.replace('<!--chat-history-->', history) });
        }
        return route.abort();
      });
      await context.addInitScript(({ source, injectChild }) => {
        if (window === top || injectChild) { window.unsafeWindow = window; window.eval(source); }
      }, { source, injectChild });
      await page.goto('https://live.bilibili.com/13233348');
      const open = page.locator('#bili-prophecy-root button');
      const entry = page.locator('#bili-prophecy-root');
      await entry.locator('button[data-state="ready"]').waitFor();
      const opacity = () => open.evaluate(button => getComputedStyle(button).opacity);
      assert.equal(await entry.getAttribute('data-placement'), injectChild ? 'history' : 'composer'); passed++;
      assert.equal(await opacity(), '0.55'); passed++;
      await open.hover();
      assert.equal(await opacity(), '1'); passed++;
      assert.equal(await page.locator('#bili-prophecy-panel').count(), 0); passed++;
      await open.click();
      const host = page.locator('#bili-prophecy-panel');
      const ready = () => page.waitForFunction(() => document.getElementById('bili-prophecy-panel')?.shadowRoot.querySelector('.status').hidden);
      await ready();
      await page.mouse.move(5, 5);
      assert.equal(await opacity(), '1'); passed++;
      assert(await host.isVisible()); passed++;
      const frame = page.frames().find(frame => frame.url().includes('/live-app-guessing-game/'));
      assert(frame);
      assert.equal((await host.boundingBox()).width, 420); passed++;
      assert.equal((await host.boundingBox()).height, 600); passed++;
      assert.equal(await frame.evaluate(() => initCount), 1); passed++;
      // Fractional toolbar dimensions reproduce the old 250ms resize loop,
      // including a 1px oscillation of the official viewport at CSS zoom 1.25.
      for (const zoom of [1, 1.1, 1.25, 1.33]) {
        await entry.evaluate((entry, zoom) => {
          document.body.style.zoom = String(zoom);
          const anchor = entry.parentElement;
          anchor.style.width = '400.375px'; anchor.style.height = '43.39px';
          const offset = entry.dataset.placement === 'history' ? 43.39 : 0;
          anchor.style.top = `${700 / zoom - offset}px`;
          dispatchEvent(new Event('resize'));
        }, zoom);
        await page.waitForTimeout(300);
        const placement = await entry.evaluate(entry => ({
          anchor: entry.parentElement.getBoundingClientRect().toJSON(),
          entry: entry.getBoundingClientRect().toJSON(),
          panel: document.getElementById('bili-prophecy-panel').getBoundingClientRect().toJSON(),
        }));
        const edge = injectChild ? placement.anchor.bottom : placement.anchor.top;
        assert(Math.abs(placement.anchor.right - placement.entry.right - 10 * zoom) < .05, `entry right inset at zoom ${zoom}`); passed++;
        assert(Math.abs(edge - placement.entry.bottom - 10 * zoom) < .05, `entry bottom inset at zoom ${zoom}`); passed++;
        assert(Math.abs(placement.entry.top - placement.panel.bottom - 8 * zoom) < .05, `panel gap at zoom ${zoom}`); passed++;
        assert(Math.abs(placement.panel.width - 420 * zoom) < .05, `subpixel width at zoom ${zoom}`); passed++;
        const stability = await measurePanelStability(page);
        assert.equal(stability.mutations, 0, `idle DOM at zoom ${zoom}: ${JSON.stringify(stability)}`); passed++;
        assert(Object.values(stability.maxDelta).every(delta => delta === 0), `fractional layout at zoom ${zoom}: ${JSON.stringify(stability)}`); passed++;
      }
      await entry.evaluate(entry => {
        document.body.style.zoom = '';
        entry.parentElement.removeAttribute('style');
        dispatchEvent(new Event('resize'));
      });
      await page.evaluate(() => scrollTo(0, 0));
      await frame.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const frameRect = await page.locator('#bili-prophecy-panel iframe').boundingBox();
      await page.mouse.move(frameRect.x + 100, frameRect.y + 100);
      await page.mouse.wheel(0, 500);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => scrollY), 0); passed++;
      await frame.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.querySelector('video') === originalVideo && !originalVideo.paused), true); passed++;
      const time = await page.evaluate(() => originalVideo.currentTime);
      await page.locator('#send').click();
      assert.equal(await page.evaluate(() => sent), 1); passed++;
      assert(await host.isVisible()); passed++;
      await open.click();
      assert.equal(await host.isVisible(), false); passed++;
      await open.click();
      assert.equal(await frame.evaluate(() => initCount), 1); passed++;
      await frame.locator('#choice').click();
      const cancel = frame.locator('#bili-prophecy-desktop [data-desktop-action="cancel"]');
      await cancel.waitFor();
      await cancel.click();
      assert.equal(await frame.evaluate(() => outcomes[0].cancel && calls.length === 0), true); passed++;
      await frame.locator('#choice').click();
      await frame.locator('#bili-prophecy-desktop [data-desktop-action="cancel"]').waitFor();
      await page.locator('#bili-prophecy-panel [data-panel-action="close"]').click();
      assert.equal(await frame.evaluate(() => outcomes[1].cancel && calls.length === 0), true); passed++;
      // Use the menu-equivalent real button without scrolling the room around.
      await open.evaluate(button => button.click());
      await ready();
      assert.equal(await frame.evaluate(() => initCount), 1); passed++;
      await frame.locator('#choice').click();
      await cancel.waitFor();
      await cancel.press('Escape');
      assert(await host.isVisible()); passed++;
      assert.equal(await frame.evaluate(() => outcomes.at(-1).cancel && calls.length === 0), true); passed++;
      await frame.locator('#choice').focus();
      await frame.locator('#choice').press('Escape');
      assert.equal(await host.isVisible(), false); passed++;
      await open.evaluate(button => button.click());
      await frame.locator('#choice').click();
      await cancel.waitFor();
      await frame.locator('#bili-prophecy-desktop [data-desktop-action="confirm"]').click();
      await page.waitForFunction(() => document.getElementById('bili-prophecy-panel').shadowRoot.querySelector('[data-panel-action="refresh"]').disabled);
      assert.equal(await frame.locator('#app').evaluate(node => node.inert), true); passed++;
      await frame.evaluate(() => finishBalance());
      await frame.waitForFunction(() => calls.length === 1);
      await frame.evaluate(() => { window.duplicate = api.post('/xlive/app-ucenter/v1/elden/user_join', {answer:1}); });
      await frame.evaluate(() => finishRequest({code:-400}));
      await page.waitForFunction(() => !document.getElementById('bili-prophecy-panel').shadowRoot.querySelector('[data-panel-action="refresh"]').disabled);
      assert.equal(await frame.evaluate(() => calls.length), 1); passed++;
      await frame.locator('#history').click();
      await frame.waitForURL('**#/history');
      await frame.locator('#rules').click();
      await frame.waitForURL('**#/doc');
      assert.equal(context.pages().length, 1); passed++;
      await page.locator('#bili-prophecy-panel [data-view="current"]').click();
      await frame.waitForURL('**#/');
      // Pointer capture keeps dragging when the pointer crosses the iframe.
      const header = page.locator('#bili-prophecy-panel header');
      let r = await header.boundingBox();
      await page.mouse.move(r.x + 60, r.y + 22); await page.mouse.down();
      await page.mouse.move(150, 180, { steps: 8 }); await page.mouse.up();
      let moved = await host.boundingBox(); assert(moved.x < 200 && moved.y < 200); passed++;
      await page.locator('#bili-prophecy-panel header [data-panel-action="refresh"]').click();
      await ready();
      assert(Math.abs((await host.boundingBox()).x - moved.x) < 1); passed++;
      assert.equal(await page.evaluate(() => originalVideo.currentTime > 0 && document.querySelector('video') === originalVideo && !originalVideo.paused), true); passed++;
      assert(await page.evaluate(() => originalVideo.currentTime) > time); passed++;
      if (process.env.PROPHECY_SCREENSHOT_DIR && injectChild) {
        fs.mkdirSync(process.env.PROPHECY_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.PROPHECY_SCREENSHOT_DIR, 'panel.png') });
      }
      // Fullscreen must retain the same child browsing context.
      await page.evaluate(() => { window.savedFrameWindow = document.getElementById('bili-prophecy-panel').shadowRoot.querySelector('iframe').contentWindow; });
      await page.locator('#player').evaluate(node => node.requestFullscreen());
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      assert(await host.evaluate(node => node.matches(':popover-open'))); passed++;
      assert.equal(await page.locator('#bili-prophecy-panel iframe').count(), 1); passed++;
      assert(await page.evaluate(() => savedFrameWindow === document.getElementById('bili-prophecy-panel').shadowRoot.querySelector('iframe').contentWindow)); passed++;
      await page.evaluate(() => document.exitFullscreen());
      for (const [width, height] of [[1280,720],[820,620],[420,600],[320,300]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => { const r = document.getElementById('bili-prophecy-panel').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; });
        const rect = await host.boundingBox();
        assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height); passed++;
      }
      const current = page.frames().find(frame => frame.url().includes('/live-app-guessing-game/'));
      await current.locator('#choice').click();
      const smallCancel = current.locator('#bili-prophecy-desktop [data-desktop-action="cancel"]');
      await smallCancel.click(); // Must remain reachable by scrolling the dialog.
      assert.equal(await current.evaluate(() => outcomes[0].cancel), true); passed++;
      await page.setViewportSize({width:1440,height:900});
      // Pinch/page-scale viewport models the visual viewport resize under zoom.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:1.5});
      await page.waitForFunction(() => {const r=document.getElementById('bili-prophecy-panel').getBoundingClientRect(),v=visualViewport;return r.right<=v.offsetLeft+v.width+1&&r.bottom<=v.offsetTop+v.height+1}); passed++;
      await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:1});
      await page.evaluate(() => history.pushState({}, '', '/999'));
      await page.waitForFunction(() => !document.getElementById('bili-prophecy-panel'));
      await open.evaluate(button => button.click());
      await ready();
      assert.match(await page.locator('#bili-prophecy-panel iframe').getAttribute('src'), /anchorId=777/); passed++;
      assert(Math.abs((await host.boundingBox()).x - moved.x) < 1, 'drag position survives room changes in this session'); passed++;
      const reset = header.getByRole('button', { name: '重置位置' });
      assert.deepEqual(await header.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.panelAction)), ['reset-position', 'refresh', 'close']); passed++;
      const roomFrame = page.frames().find(frame => frame.url().includes('/live-app-guessing-game/'));
      await host.getByRole('button', { name: '参与历史' }).click();
      await roomFrame.waitForURL('**#/history');
      const historyDocument = await roomFrame.evaluateHandle(() => document);
      await reset.click();
      const gaps = await entry.evaluate(node => {
        const panel = document.getElementById('bili-prophecy-panel').getBoundingClientRect();
        return {
          right: node.parentElement.getBoundingClientRect().right - panel.right,
          bottom: node.getBoundingClientRect().top - panel.bottom,
        };
      });
      assert.deepEqual(gaps, { right: 0, bottom: 8 }); passed++;
      assert.equal(await page.evaluate(() => sessionStorage.getItem('bili-prophecy-panel-position-v3')), null); passed++;
      assert.equal(await historyDocument.evaluate(previous => previous === document && location.hash === '#/history'), true); passed++;
      await historyDocument.dispose();
      const docked = await host.boundingBox();
      await header.getByRole('button', { name: '关闭面板' }).click();
      await open.click();
      assert.deepEqual(await host.boundingBox(), docked); passed++;
      assert.equal(await page.locator('textarea').inputValue(), '未发送的弹幕'); passed++;
      assert.deepEqual(errors, []); passed++;
      await context.close();
    }
    console.log(`${passed} Chromium assertions passed (child injection + parent fallback; zero network access).`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
