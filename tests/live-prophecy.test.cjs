const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-live-prophecy.user.js'), 'utf8');
const roomPayload = uid => ({ code: 0, data: { room_id: 13233348, short_id: 0, uid, live_status: 1 } });
// Structure observed on the live site's danmaku controls, including the native icons.
const controls = `<div id="chat-control-panel-vm" class="chat-control-panel">
  <div id="control-panel-ctnr-box" class="control-panel-ctnr">
    <div class="control-panel-icon-row">
      <div class="icon-left-part"><button class="danmaku-preference-btn">设置</button><button class="block-effect-btn">特效</button><button class="block-danmaku-btn">弹幕</button></div>
      <div class="icon-right-part"><button class="like-btn">赞</button><button class="emoticons-panel">表情</button><button class="super-chat">SC</button></div>
    </div>
    <div class="chat-input-ctnr"><textarea class="chat-input" placeholder="发个弹幕呗~">未发送内容</textarea><button class="send-btn">发送</button></div>
  </div>
</div>`;

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

function setup(t, { url = 'https://live.bilibili.com/13233348', response = () => roomPayload(353609978), status = 200, withControls = true, embedded = false, online = true, native = false } = {}) {
  const dom = new JSDOM(embedded ? `<iframe src="${url}"></iframe>` : `<!doctype html><html><body>${withControls ? controls : '<main>直播页</main>'}</body></html>`, {
    url: embedded ? 'https://live.bilibili.com/13233348' : url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const window = embedded ? dom.window.document.querySelector('iframe').contentWindow : dom.window;
  const errors = [];
  window.addEventListener('error', event => errors.push(event.message));
  t.after(() => {
    window.dispatchEvent(new window.Event('pagehide'));
    dom.window.close();
    assert.deepEqual(errors, [], 'unexpected script runtime error');
  });
  if (embedded) {
    window.document.open();
    window.document.write(`<!doctype html><html><body>${withControls ? controls : ''}</body></html>`);
    window.document.close();
  }
  window.AbortController = AbortController;
  let clock = 1800000000000;
  window.Date.now = () => clock;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  const requests = [], opened = [], intervals = new Map(), timeouts = new Map(), menus = new Map();
  let serial = 0;
  window.setInterval = callback => { const id = ++serial; intervals.set(id, callback); return id; };
  window.clearInterval = id => intervals.delete(id);
  window.setTimeout = (callback, delay) => { const id = ++serial; timeouts.set(id, { callback, delay }); return id; };
  window.clearTimeout = id => timeouts.delete(id);
  window.GM_registerMenuCommand = (label, callback) => menus.set(label, callback);
  window.open = (...args) => { opened.push(args); return null; };
  window.fetch = async (input, options) => {
    const target = new URL(input);
    assert.equal(target.origin, 'https://api.live.bilibili.com');
    assert.equal(target.pathname, '/room/v1/Room/room_init');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.method, 'GET');
    requests.push({ url: target, options });
    const body = await response(target.searchParams.get('id'), options.signal);
    return { ok: status === 200, status, json: async () => body };
  };
  const nativeDialog = native ? installNativeDialog(window) : null;
  window.eval(source);
  return {
    window, requests, opened, menus, native: nativeDialog,
    root: () => window.document.getElementById('bili-prophecy-root')?.shadowRoot,
    panel: () => window.document.getElementById('bili-prophecy-panel')?.shadowRoot,
    frame() { return this.panel()?.querySelector('iframe'); },
    tick(delay = 250) { for (const callback of [...intervals.values()]) callback(); },
    button() {
      const button = this.root()?.querySelector('[data-action="open"]');
      assert.ok(button, 'missing prediction panel button');
      return button;
    },
    menu(label = '打开直播预言') { assert.ok(menus.has(label)); menus.get(label)(); },
    addControls() { window.document.body.insertAdjacentHTML('beforeend', controls); },
    navigate(pathname) { window.history.pushState({}, '', pathname); for (const callback of intervals.values()) callback(); },
    timeout(delay) { for (const [id, timer] of [...timeouts]) if (timer.delay === delay) { timeouts.delete(id); timer.callback(); } },
    advance(ms) { clock += ms; },
    intervalCount: () => intervals.size,
    setOnline(value) { online = value; window.dispatchEvent(new window.Event(value ? 'online' : 'offline')); },
  };
}

// Other chat controls can still use the live room's Vue setting dialog.
function installNativeDialog(window) {
  const root = window.document.querySelector('#control-panel-ctnr-box');
  root.style.position = 'relative';
  const anchor = { x: 600, y: 700, left: 600, top: 700, width: 360, height: 110, right: 960, bottom: 810 };
  root.getBoundingClientRect = () => anchor;
  const node = window.document.createElement('div');
  root.append(node);
  const listeners = new Set(), calls = [];
  const dialog = {
    $el: node, $options: { components: {} }, currentContent: {}, isDialogOpen: false,
    $on(name, fn) { listeners.add(fn); }, $off(name, fn) { listeners.delete(fn); },
    $nextTick: fn => fn(),
    closeDialog() { calls.push('close'); this.isDialogOpen = false; for (const fn of listeners) fn(null); },
    mouseClose() { calls.push('mouseClose'); this.closeDialog(); },
  };
  node.getBoundingClientRect = () => ({ left: anchor.left, top: anchor.top - dialog.currentContent.height, width: dialog.currentContent.width, height: dialog.currentContent.height });
  const chat = {
    $refs: { dialog },
    toggleDialog(content) { calls.push(content); dialog.currentContent = content; dialog.isDialogOpen = true; for (const fn of listeners) fn(content.name); },
    closeDialog() { calls.push('scheduleClose'); this.clearCloseTimer(); this.closeDialogTimer = window.setTimeout(() => dialog.closeDialog(), 200); },
    clearCloseTimer() { calls.push('clearClose'); window.clearTimeout(this.closeDialogTimer); },
  };
  root.__vue__ = chat;
  return { chat, dialog, calls, anchor, listeners };
}

const expectedURL = 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html?anchorId=353609978#/';

test('the panel button mounts on the composer above the unchanged danmaku input', async t => {
  const app = setup(t);
  await flush();
  const doc = app.window.document;
  const left = doc.querySelector('.icon-left-part');
  const host = doc.getElementById('bili-prophecy-root');
  assert.equal(host.parentNode, doc.getElementById('chat-control-panel-vm'));
  assert.equal(left.querySelectorAll('button').length, 3);
  assert.equal(doc.querySelector('textarea').value, '未发送内容');
  assert.equal(doc.querySelector('.send-btn').textContent, '发送');
  assert.equal(app.button().textContent, '');
  assert.equal(app.button().querySelectorAll('svg').length, 1);
  assert.equal(app.button().getAttribute('aria-label'), '打开直播预言面板');
  assert.equal(app.button().type, 'button');
  assert.equal(app.requests.length, 1);
  app.button().click();
  assert.deepEqual(app.opened, []);
  assert.equal(app.frame().src, expectedURL);
  assert.equal(app.root().querySelector('iframe, .panel, [data-action="toggle"]'), null);
  assert.equal(doc.querySelectorAll('#bili-prophecy-root').length, 1);
});

test('a short room number opens the returned owner rather than treating the room number as a uid', async t => {
  const app = setup(t, { url: 'https://live.bilibili.com/814?live_from=71002' });
  await flush();
  app.button().click();
  assert.equal(app.requests[0].url.searchParams.get('id'), '814');
  assert.equal(app.frame().src, expectedURL);
});

test('the blanc room route receives its own composer entry', async t => {
  const app = setup(t, { url: 'https://live.bilibili.com/blanc/13233348?liteVersion=true' });
  await flush();
  app.button().click();
  assert.equal(app.frame().src, expectedURL);
});

test('a live room inside an event page frame can open its owner prediction', async t => {
  const app = setup(t, { url: 'https://live.bilibili.com/blanc/13233348?liteVersion=true', embedded: true });
  assert.notEqual(app.window.top, app.window);
  await flush();
  app.button().click();
  assert.equal(app.frame().src, expectedURL);
});

test('a late composer mounts the entry', async t => {
  const app = setup(t, { withControls: false });
  await flush();
  assert.equal(app.root(), undefined);
  app.addControls();
  await flush();
  assert.equal(app.root().host.parentElement.id, 'chat-control-panel-vm');
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('a replacement composer receives the same working entry exactly once', async t => {
  const app = setup(t);
  await flush();
  const host = app.window.document.getElementById('bili-prophecy-root');
  app.window.document.getElementById('chat-control-panel-vm').remove();
  app.addControls();
  await flush();
  assert.equal(app.window.document.getElementById('bili-prophecy-root'), host);
  assert.equal(app.window.document.querySelectorAll('#bili-prophecy-root').length, 1);
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
  assert.equal(app.requests.length, 1);
});

test('the composer receives an entry without a native toolbar', async t => {
  const app = setup(t, { withControls: false });
  app.window.document.body.innerHTML = '<div class="chat-control-panel"><div class="chat-input-ctnr"><textarea></textarea></div></div>';
  await flush();
  assert.equal(app.root().host.parentElement, app.window.document.querySelector('.chat-control-panel'));
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('the userscript menu opens a panel even if the room has no chat toolbar', async t => {
  const app = setup(t, { withControls: false });
  await flush();
  app.menu();
  assert.equal(app.root(), undefined);
  assert.equal(app.frame().src, expectedURL);
});

for (const route of ['/', '/p/html/live-app-guessing-game/index.html?anchorId=353609978', '/123/not-a-room', '/blanc/0']) {
  test(`non-room route ${route} does not receive a prediction entry or owner request`, async t => {
    const app = setup(t, { url: `https://live.bilibili.com${route}` });
    await flush();
    assert.equal(app.root(), undefined);
    assert.equal(app.requests.length, 0);
    assert.equal(app.opened.length, 0);
  });
}

test('a failed owner lookup retries on click without opening a page asynchronously', async t => {
  let failed = true;
  const app = setup(t, { response: () => failed ? { code: -400, data: null } : roomPayload(353609978) });
  await flush();
  assert.equal(app.button().disabled, false);
  assert.match(app.button().title, /重试/);
  failed = false;
  app.button().click();
  assert.equal(app.button().disabled, true);
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.opened.length, 0);
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('an invalid owner uid cannot open an unrelated prediction page', async t => {
  const app = setup(t, { response: () => roomPayload('not-a-uid') });
  await flush();
  app.button().click();
  app.menu();
  await flush();
  assert.equal(app.opened.length, 0);
  assert.match(app.button().title, /重试/);
});

test('loading the owner disables the button and never automatically opens a window', async t => {
  let finish;
  const app = setup(t, { response: () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  assert.equal(app.button().disabled, true);
  assert.equal(app.button().getAttribute('aria-busy'), 'true');
  app.button().click();
  app.menu();
  assert.equal(app.opened.length, 0);
  finish(roomPayload(353609978));
  await flush();
  assert.equal(app.button().disabled, false);
  assert.equal(app.button().getAttribute('aria-busy'), 'false');
  assert.equal(app.opened.length, 0);
  app.button().click();
  // Recorded synchronously, while the click gesture is still active.
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('a late result from the previous room cannot replace the current owner', async t => {
  let finish;
  const app = setup(t, { response: id => id === '13233348' ? new Promise(resolve => { finish = resolve; }) : roomPayload(777) });
  await flush();
  app.navigate('/999');
  await flush();
  finish(roomPayload(353609978));
  await flush();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.button().click();
  assert.equal(app.frame().src, 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html?anchorId=777#/');
});

test('leaving a room removes its entry and entering another recreates one button', async t => {
  const app = setup(t);
  await flush();
  app.navigate('/');
  assert.equal(app.root(), undefined);
  app.menu();
  assert.equal(app.opened.length, 0);
  app.navigate('/456');
  await flush();
  assert.equal(app.window.document.querySelectorAll('#bili-prophecy-root').length, 1);
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('a timed-out lookup enables a retry without leaving the button busy', async t => {
  const app = setup(t, { response: (id, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await flush();
  app.timeout(8000);
  await flush();
  assert.equal(app.requests[0].options.signal.aborted, true);
  assert.equal(app.button().disabled, false);
  assert.equal(app.button().getAttribute('aria-busy'), 'false');
  assert.match(app.button().title, /超时.*重试/);
  assert.equal(app.opened.length, 0);
});

test('a late result after leaving the room cannot recreate the entry', async t => {
  let finish;
  const app = setup(t, { response: () => new Promise(resolve => { finish = resolve; }) });
  await flush();
  app.navigate('/');
  finish(roomPayload(353609978));
  await flush();
  assert.equal(app.root(), undefined);
  assert.equal(app.opened.length, 0);
});

test('a click immediately after an SPA route change cannot open the previous owner', async t => {
  const app = setup(t, { response: id => roomPayload(id === '13233348' ? 353609978 : 777) });
  await flush();
  app.window.history.pushState({}, '', '/999');
  app.button().click();
  assert.equal(app.opened.length, 0);
  await flush();
  app.button().click();
  assert.equal(app.frame().src, 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html?anchorId=777#/');
});

test('a lookup interrupted by pagehide resumes on pageshow without opening a window', async t => {
  let count = 0;
  const app = setup(t, { response: (id, signal) => {
    if (++count > 1) return roomPayload(353609978);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await flush();
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  app.window.dispatchEvent(new app.window.Event('pageshow'));
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.opened.length, 0);
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('the restored page resumes observing a replacement chat toolbar', async t => {
  const app = setup(t);
  await flush();
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  app.window.document.getElementById('chat-control-panel-vm').remove();
  app.window.dispatchEvent(new app.window.Event('pageshow'));
  app.addControls();
  await flush();
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
  assert.equal(app.requests.length, 1);
});

test('reinjecting before the toolbar arrives does not duplicate requests or entries', async t => {
  const app = setup(t, { withControls: false });
  app.window.eval(source);
  await flush();
  app.addControls();
  await flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.window.document.querySelectorAll('#bili-prophecy-root').length, 1);
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('an HTTP error leaves a retry entry and cannot open a prediction', async t => {
  const app = setup(t, { status: 403 });
  await flush();
  assert.match(app.button().title, /重试/);
  app.button().click();
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.opened.length, 0);
});

test('Shift clicking the icon opens the official participation history', async t => {
  const app = setup(t);
  await flush();
  app.button().dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(app.frame().src, 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html?anchorId=353609978#/history');
});

test('history remains accessible from the menu when owner lookup fails', async t => {
  const app = setup(t, { response: () => ({ code: -400, data: null }) });
  await flush();
  app.menu('查看预言参与记录');
  assert.equal(app.frame().src, 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html#/history');
});

test('a room revisit reuses its validated owner for five minutes only', async t => {
  const app = setup(t, { response: id => roomPayload(id === '13233348' ? 353609978 : 777) });
  await flush();
  app.navigate('/999');
  await flush();
  app.navigate('/13233348');
  assert.equal(app.requests.length, 2);
  assert.equal(app.button().disabled, false);
  app.button().click();
  assert.equal(app.frame().src, expectedURL);
  app.navigate('/999');
  app.advance(300001);
  app.navigate('/13233348');
  await flush();
  assert.equal(app.requests.length, 3);
});

test('the owner cache evicts its oldest room after 32 rooms', async t => {
  const app = setup(t);
  await flush();
  for (let i = 1; i <= 32; i++) { app.navigate(`/${i}`); await flush(); }
  app.navigate('/31');
  await flush();
  assert.equal(app.requests.length, 33);
  app.navigate('/13233348');
  await flush();
  assert.equal(app.requests.length, 34);
});

test('repeated icon clicks toggle one iframe without reinitializing the official document', async t => {
  const app = setup(t);
  await flush();
  app.button().click();
  const frame = app.frame(), panel = app.panel().host;
  assert.equal(panel.hidden, false);
  assert.equal(app.button().getAttribute('aria-expanded'), 'true');
  app.button().click();
  assert.equal(panel.hidden, true);
  assert.equal(app.button().getAttribute('aria-expanded'), 'false');
  app.button().click();
  app.menu();
  assert.equal(panel.hidden, false);
  assert.equal(app.frame(), frame);
  assert.equal(app.opened.length, 0);
});

test('a transient network failure receives one automatic retry without opening a window', async t => {
  let attempts = 0;
  const app = setup(t, { response: () => { if (++attempts === 1) throw new TypeError('offline transport'); return roomPayload(353609978); } });
  await flush();
  assert.equal(app.button().disabled, false);
  app.timeout(1200);
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.button().dataset.state, 'ready');
  assert.equal(app.opened.length, 0);
});

test('automatic retry stops after a second transport failure', async t => {
  const app = setup(t, { response: () => { throw new TypeError('broken transport'); } });
  await flush();
  app.timeout(1200);
  await flush();
  app.timeout(1200);
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.button().dataset.state, 'error');
});

test('an empty owner response is rejected without treating it as a transport failure', async t => {
  const app = setup(t, { response: () => null });
  await flush();
  app.timeout(1200);
  await flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.button().dataset.state, 'error');
  assert.equal(app.opened.length, 0);
});

test('a scheduled retry cannot request the room after navigation away', async t => {
  const app = setup(t, { response: () => { throw new TypeError('broken transport'); } });
  await flush();
  app.navigate('/');
  app.timeout(1200);
  await flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.root(), undefined);
});

test('an offline page waits for reconnect before identifying its owner', async t => {
  const app = setup(t, { online: false });
  await flush();
  assert.equal(app.requests.length, 0);
  assert.match(app.button().title, /网络|联网/);
  app.setOnline(true);
  await flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.button().dataset.state, 'ready');
  assert.equal(app.opened.length, 0);
});

test('hidden rooms suspend route polling and resume exactly once when visible', async t => {
  const app = setup(t);
  await flush();
  let hidden = true;
  Object.defineProperty(app.window.document, 'hidden', { configurable: true, get: () => hidden });
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  assert.equal(app.intervalCount(), 0);
  hidden = false;
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  app.window.document.dispatchEvent(new app.window.Event('visibilitychange'));
  assert.equal(app.intervalCount(), 1);
  assert.equal(app.requests.length, 1);
});

test('the icon adapts when the native input background changes from dark to light', async t => {
  const app = setup(t);
  await flush();
  const input = app.window.document.querySelector('.chat-input-ctnr');
  const host = app.window.document.getElementById('bili-prophecy-root');
  input.style.backgroundColor = '#1c1d1f';
  await flush();
  assert.equal(host.dataset.theme, 'dark');
  input.style.backgroundColor = '#ffffff';
  await flush();
  assert.equal(host.dataset.theme, 'light');
  app.button().click();
  assert.ok(app.frame());
  assert.equal(app.opened.length, 0);
});

test('replacing only the native input updates the icon theme and observes the replacement', async t => {
  const app = setup(t);
  await flush();
  const doc = app.window.document;
  const host = doc.getElementById('bili-prophecy-root');
  const input = doc.querySelector('.chat-input-ctnr');
  input.style.backgroundColor = '#ffffff';
  await flush();
  assert.equal(host.dataset.theme, 'light');
  const replacement = input.cloneNode(true);
  replacement.style.backgroundColor = '#1c1d1f';
  input.replaceWith(replacement);
  await flush();
  assert.equal(host.dataset.theme, 'dark');
  replacement.style.backgroundColor = '#ffffff';
  await flush();
  assert.equal(host.dataset.theme, 'light');
  assert.equal(doc.querySelectorAll('#bili-prophecy-root').length, 1);
});

// A separate official document models the iframe; jsdom does not construct a
// browsing context for frames in Shadow DOM. Chromium tests cover that boundary.
function attachOfficial(t, app, { sdkReady = true, content = true, post = async () => ({ code: 0 }) } = {}) {
  const frame = app.frame();
  const dom = new JSDOM(`<!doctype html><html><body><main id="app"><div id="main">${content ? '<div class="user-detail-content"><button>官方选项</button></div>' : ''}</div></main></body></html>`, {
    url: frame.src, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  dom.reconfigure({ windowTop: app.window });
  const page = dom.window;
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: page });
  const errors = [];
  page.addEventListener('error', event => errors.push(event.message));
  t.after(() => { page.close(); assert.deepEqual(errors, []); });
  const calls = [], opened = [];
  page.open = (...args) => opened.push(args);
  const sdk = { getEnvSync: () => -1, Request: function OfficialRequest() {}, showConfirm() {}, openView() {} };
  const api = { post: (...args) => { calls.push(args); return post(...args); } };
  const modules = { 6151(module, exports) { exports.E = api; } };
  if (sdkReady) modules[1171] = (module, exports) => { exports.Ay = sdk; };
  const cache = new Map();
  const require = id => {
    if (!cache.has(id)) { const exports = {}; modules[id]({}, exports, require); cache.set(id, exports); }
    return cache.get(id);
  };
  require.m = modules;
  page.webpackChunkguessing_game = [];
  page.webpackChunkguessing_game.push = record => { Object.assign(modules, record[1]); record[2]?.(require); };
  app.tick();
  return { page, sdk, api, calls, opened, adapter: page.__biliProphecyDesktopAdapter__, root: () => page.document.getElementById('bili-prophecy-desktop')?.shadowRoot };
}

test('iframe readiness requires the SDK adapter, request guard and rendered official content', async t => {
  const app = setup(t);
  await flush();
  app.menu();
  assert.equal(app.panel().querySelector('.status').hidden, false);
  const official = attachOfficial(t, app);
  assert.equal(official.adapter.status, 'ready');
  assert.equal(official.adapter.apiReady, true);
  assert.equal(app.panel().querySelector('.status').hidden, true);
  assert.equal(app.frame().style.visibility, '');
  app.timeout(20000);
  assert.equal(app.panel().querySelector('.status').hidden, true);
  const adapter = official.adapter;
  app.tick(); app.menu(); app.menu();
  assert.equal(official.page.__biliProphecyDesktopAdapter__, adapter);
});

for (const missing of ['sdk', 'content']) test(`iframe with missing ${missing} reaches a retryable timeout`, async t => {
  const app = setup(t);
  await flush(); app.menu();
  attachOfficial(t, app, { sdkReady: missing !== 'sdk', content: missing !== 'content' });
  app.timeout(20000);
  assert.equal(app.panel().querySelector('.status').hidden, false);
  assert.match(app.panel().querySelector('.status').textContent, /20 秒/);
  const previous = app.frame();
  app.panel().querySelector('.status button').click();
  assert.notEqual(app.frame(), previous);
  assert.equal(app.frame().src, expectedURL);
  assert.equal(app.opened.length, 0);
});

test('iframe error and a blocked document both show an actionable error', async t => {
  const app = setup(t);
  await flush(); app.menu();
  app.frame().dispatchEvent(new app.window.Event('error'));
  assert.match(app.panel().querySelector('.status').textContent, /加载失败/);
  app.panel().querySelector('.status button').click();
  Object.defineProperty(app.frame(), 'contentWindow', { get() { throw new Error('SecurityError'); } });
  app.tick();
  assert.match(app.panel().querySelector('.status').textContent, /嵌入策略/);
  assert.equal(app.opened.length, 0);
});

test('closing a confirmation cancels it once and reopening reuses the same iframe', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app), frame = app.frame();
  let callbacks = 0;
  const pending = official.sdk.showConfirm({ content: '硬币参与', callback(result) { callbacks++; assert.equal(result.confirm, false); } });
  app.tick();
  assert.equal(app.panel().querySelector('[data-panel-action="refresh"]').disabled, true);
  app.panel().querySelector('[data-view="history"]').click();
  assert.equal(official.page.location.hash, '#/');
  app.panel().querySelector('[data-panel-action="close"]').click();
  assert.equal((await pending).cancel, true);
  assert.equal(callbacks, 1);
  assert.equal(official.root().querySelector('[role="dialog"]'), null);
  app.button().click();
  assert.equal(app.frame(), frame);
  assert.equal(official.calls.length, 0);
  assert.equal(app.opened.length, 0);
});

test('refresh replaces only the iframe and preserves the selected history route', async t => {
  const app = setup(t);
  await flush(); app.menu('查看预言参与记录');
  const frame = app.frame(), input = app.window.document.querySelector('textarea');
  attachOfficial(t, app);
  app.panel().querySelector('[data-panel-action="refresh"]').click();
  assert.notEqual(app.frame(), frame);
  assert.equal(app.frame().src, expectedURL.replace('#/', '#/history'));
  assert.equal(app.window.document.querySelector('textarea'), input);
  assert.equal(input.value, '未发送内容');
});

test('history and rules stay in the iframe and retain its anchor', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app), frame = app.frame();
  app.panel().querySelector('[data-view="history"]').click();
  assert.equal(official.page.location.hash, '#/history');
  app.panel().querySelector('[data-view="current"]').click();
  assert.equal(official.page.location.hash, '#/');
  official.page.open('https://live.bilibili.com/p/html/live-app-guessing-game/index.html#/doc');
  assert.equal(official.page.location.hash, '#/doc');
  assert.equal(official.page.location.search, '?anchorId=353609978');
  app.panel().querySelector('[data-view="current"]').click();
  assert.equal(official.page.location.hash, '#/');
  official.page.open('https://live.bilibili.com/p/html/live-app-guessing-game/index.html#/doc');
  app.panel().querySelector('[data-panel-action="refresh"]').click();
  assert.equal(app.frame().src, expectedURL.replace('#/', '#/doc'));
  assert.notEqual(app.frame(), frame);
  assert.equal(app.opened.length, 0);
});

test('an owner resolved after opening history is used when switching to current predictions', async t => {
  let finish;
  const app = setup(t, { response: () => new Promise(resolve => { finish = resolve; }) });
  await flush(); app.menu('查看预言参与记录');
  const frame = app.frame();
  attachOfficial(t, app);
  finish(roomPayload(353609978)); await flush();
  app.panel().querySelector('[data-view="current"]').click();
  assert.notEqual(app.frame(), frame);
  assert.equal(app.frame().src, expectedURL);
});

test('switching rooms destroys the old frame and cancels its unconfirmed choice', async t => {
  const app = setup(t, { response: id => roomPayload(id === '999' ? 777 : 353609978) });
  await flush(); app.menu();
  const official = attachOfficial(t, app), frame = app.frame();
  const pending = official.sdk.showConfirm({ content: '旧房间' });
  app.navigate('/999');
  assert.equal((await pending).confirm, false);
  assert.equal(app.panel(), undefined);
  assert.equal(frame.isConnected, false);
  await flush(); app.menu();
  assert.match(app.frame().src, /anchorId=777/);
});

test('a room change before polling refuses a stale confirmation and participation call', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app);
  app.window.history.pushState({}, '', '/999');
  assert.equal((await official.sdk.showConfirm({ content: '旧房间' })).confirm, false);
  await assert.rejects(official.api.post('/xlive/app-ucenter/v1/elden/user_join', {}), /离开当前直播间/);
  assert.equal(official.calls.length, 0);
});

test('participation stays locked across the balance check and deduplicates an in-flight request', async t => {
  let finish;
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app, { post: () => new Promise(resolve => { finish = resolve; }) });
  const pending = official.sdk.showConfirm({ content: '模拟参与，仅内存请求' });
  official.root().querySelector('[data-desktop-action="confirm"]').click();
  assert.equal((await pending).confirm, true);
  assert.equal(official.adapter.processing, true);
  app.tick();
  const frame = app.frame();
  app.panel().querySelector('[data-panel-action="refresh"]').click();
  assert.equal(app.frame(), frame);
  const args = { prophet_id: 1, answer: 1, anchor_id: 353609978, uid: 1 };
  const first = official.api.post('/xlive/app-ucenter/v1/elden/user_join', args);
  const duplicate = official.api.post('/xlive/app-ucenter/v1/elden/user_join', args);
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(official.calls.length, 1);
  assert.equal(official.calls[0][1], args);
  app.panel().querySelector('[data-panel-action="close"]').click();
  app.button().click(); app.tick();
  assert.equal(app.frame(), frame);
  assert.equal(app.panel().querySelector('[data-panel-action="refresh"]').disabled, true);
  const response = { code: -400, message: '模拟官方错误，不代表真实参与结果' };
  finish(response);
  assert.equal(await first, response);
  assert.equal(official.adapter.processing, false);
  app.tick();
  assert.equal(app.panel().querySelector('[data-panel-action="refresh"]').disabled, false);
});

test('participation rejection releases the interaction lock without retrying', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app, { post: () => Promise.reject(new Error('network failure')) });
  await assert.rejects(official.api.post('/xlive/app-ucenter/v1/elden/user_join', {}), /network failure/);
  assert.equal(official.adapter.processing, false);
  assert.equal(official.calls.length, 1);
  assert.equal(official.page.document.getElementById('app').inert, false);
});

test('only the manual compatibility button opens a new tab', async t => {
  const app = setup(t);
  await flush(); app.menu('查看预言参与记录');
  assert.equal(app.opened.length, 0);
  app.panel().querySelector('[data-panel-action="external"]').click();
  assert.deepEqual(app.opened, [[expectedURL.replace('#/', '#/history'), '_blank', 'noopener,noreferrer']]);
});

test('SDK external help requires a manual link and login remains an explicit external flow', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app);
  await official.sdk.openView({ url: 'https://www.bilibili.com/blackboard/help.html' });
  assert.equal(official.opened.length, 0);
  assert.match(official.root().querySelector('a').textContent, /新标签页/);
  official.page.open('https://passport.bilibili.com/login');
  assert.equal(official.opened.length, 1);
  official.page.open('javascript:alert(1)');
  assert.equal(official.opened.length, 1);
});

test('a frame error while confirming cancels the choice and allows retry', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app);
  const pending = official.sdk.showConfirm({ content: '加载失败时取消' });
  app.tick();
  app.frame().dispatchEvent(new app.window.Event('error'));
  assert.equal((await pending).confirm, false);
  assert.equal(app.panel().querySelector('.status button').disabled, false);
  const old = app.frame();
  app.panel().querySelector('.status button').click();
  assert.notEqual(app.frame(), old);
  assert.equal(official.calls.length, 0);
});

test('a queued participation cannot be sent after a synchronous room change', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app);
  const pending = official.api.post('/xlive/app-ucenter/v1/elden/user_join', {});
  app.navigate('/999');
  await assert.rejects(pending, /离开当前直播间/);
  assert.equal(official.calls.length, 0);
});

test('hover leaves the composer focused and click opens the panel above the entry', async t => {
  const app = setup(t, { native: true });
  await flush();
  const input = app.window.document.querySelector('textarea');
  input.focus();
  app.root().host.parentElement.getBoundingClientRect = () => app.native.anchor;
  app.root().host.getBoundingClientRect = () => ({ width: 32, top: 658, left: 918, right: 950 });
  app.button().dispatchEvent(new app.window.MouseEvent('mouseenter'));
  assert.equal(app.panel(), undefined);
  assert.equal(app.window.document.activeElement, input);
  app.button().click();
  const host = app.panel().host;
  assert.deepEqual(app.native.calls, []);
  assert.equal(app.window.document.querySelector('#control-panel-ctnr-box').contains(host), false, 'panel must escape the sidebar clipping subtree');
  assert.equal(host.getAttribute('popover'), 'manual');
  assert.equal(host.style.position, 'fixed');
  assert.equal(host.style.top, '50px');
  assert.equal(host.style.left, '540px');
  assert.equal(host.style.width, '420px');
  assert.equal(app.opened.length, 0);
});

test('pointer leave and outside clicks keep the panel open, and click toggling reuses the iframe', async t => {
  const app = setup(t);
  await flush();
  app.button().click();
  const frame = app.frame();
  app.button().dispatchEvent(new app.window.MouseEvent('mouseleave'));
  app.panel().host.dispatchEvent(new app.window.MouseEvent('mouseleave'));
  app.window.document.querySelector('.send-btn').click();
  assert.equal(app.panel().host.hidden, false);
  assert.equal(app.button().getAttribute('aria-expanded'), 'true');
  app.button().click();
  assert.equal(app.panel().host.hidden, true);
  assert.equal(app.button().getAttribute('aria-expanded'), 'false');
  app.button().click();
  assert.equal(app.frame(), frame);
});

test('native settings and pending prediction confirmation stay independent', async t => {
  const app = setup(t, { native: true });
  await flush(); app.menu();
  const official = attachOfficial(t, app);
  const close = app.native.dialog.closeDialog, toggle = app.native.chat.toggleDialog;
  const pending = official.sdk.showConfirm({ content: '打开原生设置后仍可继续确认' });
  app.native.chat.toggleDialog({ name: 'blockSetting', contentComponentName: 'BlockSettingDialogContent' });
  assert.equal(app.panel().host.hidden, false);
  assert.ok(official.root().querySelector('[role="dialog"]'));
  app.button().click();
  assert.equal((await pending).confirm, false);
  assert.equal(app.panel().host.hidden, true);
  assert.equal(app.native.dialog.$el.style.opacity, '');
  assert.equal(app.native.dialog.closeDialog, close);
  assert.equal(app.native.chat.toggleDialog, toggle);
  assert.equal(app.native.dialog.currentContent.name, 'blockSetting');
});

test('leaving the room removes the entry and restores a static composer', async t => {
  const app = setup(t, { native: true });
  await flush(); app.menu();
  const composer = app.root().host.parentElement;
  assert.equal(composer.style.position, 'relative');
  app.navigate('/');
  assert.equal(composer.style.position, '');
  assert.equal(app.root(), undefined);
  assert.equal(app.native.listeners.size, 0);
  assert.equal(app.native.dialog.$options.components.BiliProphecyPanelContent, undefined);
  assert.equal(app.native.dialog.$el.style.opacity, '');
  assert.equal(app.panel(), undefined);
});

test('different Document wrappers do not reinitialize the same iframe or cancel its confirmation', async t => {
  const app = setup(t);
  await flush(); app.menu();
  const official = attachOfficial(t, app), frame = app.frame();
  const pending = official.sdk.showConfirm({content:'同一 iframe 的跨环境包装'});
  official.adapter.document = { wrapper: official.page.document };
  app.tick(); app.tick();
  assert.ok(official.root().querySelector('[role="dialog"]'));
  assert.equal(app.frame(), frame);
  official.root().querySelector('[data-desktop-action="cancel"]').click();
  assert.equal((await pending).cancel,true);
});
