const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-live-prophecy.user.js'), 'utf8');

function setup(t, { late = false, composition = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"><div class="user-detail-content"><div class="content-prohets-box"><div class="pk"><div class="content-pkline"></div></div></div></div></div></body></html>', {
    url: 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html?anchorId=353609978#/',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', event => errors.push(event.message));
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); assert.deepEqual(errors, []); });
  const header = { tag: 'header' }, spacer = { tag: 'spacer' }, footer = { tag: 'footer' };
  const ListItem = { render() {
    return { data: { attrs: { title: 'official' }, on: { click: 'official-handler' } }, children: [
      { children: [{ data: { staticClass: 'title' }, children: [{ text: this.item.prophet.question }] }, { tag: 'official-status' }] },
      { tag: 'official-options', selected: this.item.my_answer },
    ] };
  } };
  const Current = { components: { ListItem }, render() {
    return { children: [header, ...this.items.map(item => ({ key: item.prophet.prophet_id, componentOptions: { propsData: { item } } })), spacer, footer] };
  } };
  const Progress = { render() { return { data: { attrs: { title: 'official-counts' } }, children: ['official-left', 'triangle', 'official-right'] }; } };
  const sdk = { getEnvSync: () => -1, showConfirm() {}, Request() {} };
  const modules = {
    1171(m, e) { e.Ay = sdk; },
    7336(m, e) { e.default = Current; },
    319(m, e) { e.A = Progress; },
  };
  const cache = {};
  const requireModule = id => {
    if (!cache[id]) { cache[id] = {}; modules[id]({}, cache[id]); }
    return cache[id];
  };
  requireModule.m = modules;
  const queue = window.webpackChunkguessing_game = [[[596], modules]];
  queue.push = record => { Object.assign(modules, record[1]); record[2]?.(requireModule); return Array.prototype.push.call(queue, record); };
  const instances = [];
  if (late) {
    for (const [component, selector] of [[Current, '.user-detail-content'], [ListItem, '.content-prohets-box'], [Progress, '.content-pkline']]) {
      const cachedOptions = { render: component.render };
      component._Ctor = { 0: { options: cachedOptions } };
      const original = component.render;
      const instanceRender = composition && component !== Current ? function(...args) { return original.apply(this, args); } : original;
      const vm = { $options: { render: instanceRender, components: component.components }, updates: 0, $forceUpdate() { this.updates++; } };
      window.document.querySelector(selector).__vue__ = vm;
      instances.push({ vm, component, cachedOptions });
    }
    for (const id of Object.keys(modules)) requireModule(id);
  }
  window.eval(source);
  requireModule(7336);
  requireModule(319);
  return { window, Current, ListItem, Progress, header, spacer, footer, instances, sdk };
}

const item = (id, time, status = 1, answer = 0) => ({ my_answer: answer, prophet: { prophet_id: id, publish_time: time, prophet_status: status, question: `题目 ${id}` } });
const renderCards = (app, items) => app.Current.render.call({ items });
const ids = vnode => vnode.children.filter(child => child.componentOptions).map(child => child.key);

test('current cards sort by publish time descending while preserving official slots and store order', t => {
  const app = setup(t);
  const items = [item(500, 100), item(100, 300), item(400, 200)];
  const before = JSON.stringify(items), vnode = renderCards(app, items);
  assert.deepEqual(ids(vnode), [100, 400, 500]);
  assert.equal(vnode.children[0], app.header);
  assert.equal(vnode.children.at(-2), app.spacer);
  assert.equal(vnode.children.at(-1), app.footer);
  assert.equal(vnode.children[1].componentOptions.propsData.item, items[1]);
  assert.equal(JSON.stringify(items), before);
});

test('equal or missing timestamps use exact descending IDs and remain stable without IDs', t => {
  const app = setup(t);
  const items = [item('9007199254740992', 100), item('9007199254740993', 100), item(30, 0), item(40, undefined), item(null, null), item(null, null)];
  const vnode = renderCards(app, items);
  assert.deepEqual(ids(vnode), ['9007199254740993', '9007199254740992', 40, 30, null, null]);
  assert.equal(vnode.children.at(-3).componentOptions.propsData.item, items[5]);
});

test('new and updated items are sorted on each Vue render without recreating keyed cards', t => {
  const app = setup(t), items = [item(1, 100), item(2, 200)];
  assert.deepEqual(ids(renderCards(app, items)), [2, 1]);
  items.push(item(3, 150));
  items[0].prophet.publish_time = 300;
  assert.deepEqual(ids(renderCards(app, items)), [1, 2, 3]);
  assert.deepEqual(items.map(entry => entry.prophet.prophet_id), [1, 2, 3]);
});

test('incomplete dates use a consistent ID order so a new undated card is not buried', t => {
  const app = setup(t);
  assert.deepEqual(ids(renderCards(app,[item(10,100),item(30,0),item(20,300)])),[30,20,10]);
});

test('card lifecycle labels follow official status and live countdown, retaining selections and handlers', t => {
  const app = setup(t);
  for (const [status, countDown, state, label] of [[0, 1, 'pending', '未开始'], [1, 30, 'open', '进行中'], [1, 0, 'waiting', '等待结算'], [1, -2, 'waiting', '等待结算'], [2, 1, 'waiting', '等待结算'], [3, 1, 'ended', '已结束'], [4, 1, 'cancelled', '已取消']]) {
    const entry = item(1, 100, status, 2), before = JSON.stringify(entry);
    const vm = { item: entry, countDown, $createElement: (tag, data, text) => ({ tag, data, text }) };
    const vnode = app.ListItem.render.call(vm);
    assert.equal(vnode.data.attrs['data-bili-prophecy-state'], state);
    assert.equal(vnode.children[0].children[0].children.at(-1).text, label);
    assert.equal(vnode.data.attrs.title, 'official');
    assert.equal(vnode.data.on.click, 'official-handler');
    assert.equal(vnode.children[1].selected, 2);
    assert.equal(JSON.stringify(entry), before);
  }
});

test('unknown card statuses retain the official display without assuming an end state', t => {
  const app = setup(t);
  const vnode = app.ListItem.render.call({ item: item(1, 100, 9), $createElement() { throw Error('no invented label'); } });
  assert.equal(vnode.data.attrs['data-bili-prophecy-state'], 'unknown');
  assert.equal(vnode.children[0].children[0].children.length, 1);
});

test('progress reflects actual totals including extreme ratios, empty votes and invalid values', t => {
  const app = setup(t);
  for (const [left, right, expected] of [[200, 16000, 200 / 16200 * 100], [150, 3090, 150 / 3240 * 100], [1, 99999999, .000001], [0, 0, 50], [0, 5, 0], [5, 0, 100], [-1, NaN, 50], ['3', '1', 75], [1e308, 1e308, 50]]) {
    const data = [left, right], vnode = app.Progress.render.call({ data });
    assert(Math.abs(parseFloat(vnode.data.style['--bili-prophecy-left-share']) - expected) < 1e-10);
    assert.equal(vnode.data.attrs.title, 'official-counts');
    assert.deepEqual(vnode.children, ['official-left', 'triangle', 'official-right']);
    assert.deepEqual(data, [left, right]);
  }
});

test('late injection updates live renderers and cached constructors once, including later navigation', t => {
  const app = setup(t, { late: true });
  for (const { vm, component, cachedOptions } of app.instances) {
    assert.equal(vm.updates, 1);
    assert.equal(vm.$options.render, component.render);
    assert.equal(cachedOptions.render, component.render);
  }
  const render = app.Current.render;
  app.window.eval(source);
  app.window.__biliProphecyDesktopAdapter__.probe();
  assert.equal(app.Current.render, render);
  assert(app.instances.every(({ vm }) => vm.updates === 1));
});

test('late injection adapts Composition API instance render wrappers as well as raw component options', t => {
  const app = setup(t, { late: true, composition: true });
  const vm = app.instances[1].vm;
  const context = { item: item(1, 100, 3), $createElement: (tag, data, text) => ({ tag, data, text }) };
  const vnode = vm.$options.render.call(context);
  assert.equal(vnode.data.attrs['data-bili-prophecy-state'], 'ended');
  assert.equal(vnode.children[0].children[0].children.at(-1).text, '已结束');
  assert.equal(vm.updates, 1);
});

test('composition wrappers around an already adapted renderer do not duplicate status labels', async t => {
  const app = setup(t), node = app.window.document.querySelector('.content-prohets-box');
  const adapted = app.ListItem.render;
  node.__vue__ = { $options: { render(...args) { return adapted.apply(this,args); } }, $forceUpdate() {} };
  node.append(app.window.document.createElement('div'));
  await new Promise(resolve=>setImmediate(resolve));
  const vnode = node.__vue__.$options.render.call({ item: item(1, 100, 3), $createElement: (tag, data, text) => ({ tag, data, text }) });
  assert.equal(vnode.children[0].children[0].children.filter(child=>child.data?.staticClass==='bili-prophecy-card-status').length,1);
});
