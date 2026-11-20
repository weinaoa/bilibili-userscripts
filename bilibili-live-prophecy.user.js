// ==UserScript==
// @name         B站直播预言
// @namespace    https://space.bilibili.com/1937432404
// @version      1.1.8
// @description  在当前直播间的可拖动悬浮面板查看官方预言与参与历史，保留手动确认和桌面交互。
// @author       素晴,weinaoa
// @homepageURL  https://github.com/yunnre060214-sudo/bilibili-userscripts
// @supportURL   https://github.com/yunnre060214-sudo/bilibili-userscripts/issues
// @updateURL    none
// @downloadURL  none
// @match        https://live.bilibili.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.1.8';

  // The official H5 can read account data on desktop, but showConfirm/showToast
  // invoke an App bridge without a WEB/PC_ROOM fallback. Adapt only the UI SDK;
  // the official account, eligibility checks, requests and participation remain.
  if (location.pathname === '/p/html/live-app-guessing-game/index.html') {
    if (!/BiliApp|biliLink|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      adaptOfficialDesktop(typeof unsafeWindow === 'undefined' ? window : unsafeWindow);
    }
    return;
  }
  if (location.pathname.startsWith('/p/')) return;
  const instance = Symbol.for('bili-prophecy-room-entry');
  if (document[instance] || document.getElementById('bili-prophecy-root')) return;
  document[instance] = true;

  const OFFICIAL = 'https://live.bilibili.com/p/html/live-app-guessing-game/index.html';
  const ROOT_ID = 'bili-prophecy-root';
  const CHAT_CONTROLS = '#chat-control-panel-vm, .chat-control-panel, #control-panel-ctnr-box';
  const POSITION_KEY = 'bili-prophecy-panel-position-v3';
  let state = null;
  let ui = null;
  let poll = null;
  let observer = null;
  let active = true;
  let themeObserver = null;
  const owners = new Map();
  let panel = null;
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;

  function positiveId(value) {
    const text = String(value ?? '');
    return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
  }

  function icon(name, size = 20) {
    const paths = {
      spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M19 2v4m-2-2h4"/>',
      history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/><path d="M12 7v5l3 2"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      room: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/>',
      dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 4v16M6 12h7m-3-3 3 3-3 3"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
      external: '<path d="M14 3h7v7m0-7L11 13"/><path d="M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
      signal: '<path d="M5 9a11 11 0 0 1 14 0M8 12a6 6 0 0 1 8 0m-5 3a2 2 0 0 1 2 0"/><circle cx="12" cy="19" r="1"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.spark}</svg>`;
  }

  function adaptOfficialDesktop(page) {
    if (/BiliApp|biliLink|Android|iPhone|iPad/i.test(page.navigator.userAgent)) return null;
    const marker = '__biliProphecyDesktopAdapter__';
    if (page[marker]?.version === VERSION) {
      page[marker].probe();
      return page[marker];
    }
    const doc = page.document;
    const key = 'webpackChunkguessing_game';
    const queue = page[key] = page[key] || [];
    const wrappedFactories = new WeakSet();
    const patchedSDKs = new WeakSet();
    const adapter = { version: VERSION, status: 'waiting', probe: probeCurrentSDK, document: doc, documentKey: `${VERSION}-${Date.now()}-${Math.random()}` };
    page[marker] = adapter;
    let shadow = null;
    let cancelPending = null;
    let toastTimer = null;
    let workspace = null;
    let desktopObserver = null;
    let observing = true;
    let eventsBound = false;
    const embedded = page !== page.top;
    let embeddedVisible = true;
    let disposed = false;
    let submitting = false;
    let releaseSubmission = null;
    let apiReady = false;
    let participation = null;
    const patchedAPIs = new WeakSet();
    const patchedRenderers = new WeakSet();
    Object.defineProperties(adapter, {
      busy: { get: () => Boolean(cancelPending) || submitting },
      processing: { get: () => submitting },
      apiReady: { get: () => apiReady },
    });
    adapter.setVisible = visible => {
      embeddedVisible = visible;
      if (!visible) cancelPending?.();
    };
    adapter.dispose = () => { disposed = true; pauseDocument(); endSubmission(); };

    function endSubmission() {
      submitting = false;
      releaseSubmission?.();
      releaseSubmission = null;
      syncWorkspace();
    }

    // Adapt VNodes so Vue retains ownership of keyed cards, live countdowns,
    // selected answers and participation handlers. Never reorder API/store data.
    function patchRenderer(component, selector, transform) {
      const options = component?.options || component;
      if (!options || typeof options.render !== 'function' || patchedRenderers.has(options) || patchedRenderers.has(options.render)) return;
      patchedRenderers.add(options);
      const original = options.render;
      const render = function(...args) {
        const vnode = original.apply(this, args);
        return transform.call(this, vnode) || vnode;
      };
      patchedRenderers.add(render);
      options.render = render;
      // Late parent injection can find both cached Vue constructors and live
      // instances. Refresh each matching renderer once, never on every poll.
      for (const ctor of Object.values(options._Ctor || {})) {
        if (ctor.options?.render === original) ctor.options.render = render;
      }
      for (const node of doc.querySelectorAll(selector)) {
        const vm = node.__vue__;
        if (vm?.$options !== options && vm?.$options?.render !== original) continue;
        vm.$options.render = render;
        vm.$forceUpdate();
      }
    }

    function patchCard(component) {
      patchRenderer(component, '.content-prohets-box', function(vnode) {
        // Vue's Composition API may wrap a patched component renderer again.
        // A live instance wrapper must not add a second lifecycle label.
        if (vnode.data?.attrs?.['data-bili-prophecy-state']) return;
        const status = Number(this.item?.prophet?.prophet_status);
        const state = status === 1 ? (this.countDown > 0 ? 'open' : 'waiting')
          : ({ 0: 'pending', 2: 'waiting', 3: 'ended', 4: 'cancelled' }[status] || 'unknown');
        const labels = { pending: '未开始', open: '进行中', waiting: '等待结算', ended: '已结束', cancelled: '已取消' };
        vnode.data = { ...vnode.data, attrs: { ...vnode.data?.attrs, 'data-bili-prophecy-state': state } };
        const title = vnode.children?.[0]?.children?.find(child => child.data?.staticClass === 'title');
        if (title && labels[state]) {
          title.children = [...(title.children || []), this.$createElement('span', {
            staticClass: 'bili-prophecy-card-status',
          }, labels[state])];
        }
      });
    }

    function patchCurrentCards(component) {
      const options = component?.options || component;
      patchCard(options?.components?.ListItem);
      patchRenderer(options, '.user-detail-content', function(vnode) {
        const prophet = child => child.componentOptions?.propsData?.item?.prophet;
        const timestamp = item => {
          const value = Number(item.publish_time);
          return Number.isFinite(value) && value > 0 ? value : 0;
        };
        const id = item => /^\d+$/.test(String(item.prophet_id)) ? String(item.prophet_id).replace(/^0+/, '') : '';
        const cards = (vnode.children || []).filter(child => prophet(child));
        // Do not push a new, undated open card behind dated closed cards.
        // Use one consistent key for the whole list when dates are incomplete.
        const completeTimes = cards.every(child => timestamp(prophet(child)) > 0);
        cards.sort((a, b) => {
          const left = prophet(a), right = prophet(b);
          const time = completeTimes ? timestamp(right) - timestamp(left) : 0;
          if (time) return time;
          const x = id(left), y = id(right);
          return y.length - x.length || (x < y ? 1 : x > y ? -1 : 0);
        });
        let index = 0;
        vnode.children = (vnode.children || []).map(child => prophet(child) ? cards[index++] : child);
      });
    }

    function patchProgress(component) {
      patchRenderer(component, '.content-pkline', function(vnode) {
        const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
        const left = count(this.data?.[0]), right = count(this.data?.[1]);
        const scale = Math.max(left, right) || 1;
        const share = left || right ? 100 * (left / scale) / (left / scale + right / scale) : 50;
        vnode.data = { ...vnode.data,
          attrs: { ...vnode.data?.attrs, 'data-bili-prophecy-progress': '' },
          style: { ...vnode.data?.style, '--bili-prophecy-left-share': `${share}%` },
        };
      });
    }

    // Guard only the official participation call, keeping its arguments,
    // transport, credentials and response unchanged. No automatic retries.
    function patchAPI(api) {
      if (!embedded || !api || typeof api.post !== 'function' || patchedAPIs.has(api)) return;
      patchedAPIs.add(api);
      const post = api.post;
      api.post = function(url, ...args) {
        if (!String(url).split('?')[0].endsWith('/xlive/app-ucenter/v1/elden/user_join')) return post.call(this, url, ...args);
        if (disposed || adapter.isCurrent?.() === false) return page.Promise.reject(new Error('预言面板已离开当前直播间'));
        if (participation) return participation;
        submitting = true;
        releaseSubmission ||= lockPage();
        syncWorkspace();
        participation = page.Promise.resolve().then(() => {
          if (disposed || adapter.isCurrent?.() === false) throw new Error('预言面板已离开当前直播间');
          return post.call(this, url, ...args);
        }).finally(() => {
          participation = null;
          endSubmission();
        });
        return participation;
      };
      apiReady = true;
    }

    function embeddedNavigation(value) {
      let url;
      try { url = new URL(value, page.location.href); } catch { return null; }
      if (url.protocol !== 'https:') return null;
      if (url.origin === page.location.origin && url.pathname === '/p/html/live-app-guessing-game/index.html') {
        if (!adapter.busy) {
          // Always retain this room's anchor, including links missing a query.
          const current = new URL(page.location.href);
          current.hash = url.hash || '/';
          page.location.href = current.href;
        }
        return null;
      }
      // Login is a necessary external flow. Other SDK links become an explicit
      // manual link; ordinary prediction/history/rules never create a tab.
      if (url.hostname === 'passport.bilibili.com') return nativeOpen.call(page, url.href, '_blank', 'noopener,noreferrer');
      showToast({ msg: '外部说明可按需在新标签页查看' });
      const link = doc.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '打开外部说明（新标签页）';
      link.style.cssText = 'color:#0084b0;white-space:nowrap';
      shadow.querySelector('.toast').append(link);
      return null;
    }
    const nativeOpen = page.open;
    if (embedded) {
      page.open = embeddedNavigation;
      doc.addEventListener('click', event => {
        const link = event.target.closest?.('a[href]');
        if (!link || event.defaultPrevented) return;
        const url = new URL(link.href, page.location.href);
        if (url.origin === page.location.origin && url.pathname === page.location.pathname) {
          event.preventDefault();
          embeddedNavigation(url.href);
        }
      }, true);
    }

    function ensureRoot() {
      if (shadow?.host.isConnected) return shadow;
      if (shadow) {
        // Clear the detached root before settling: settlement syncs the
        // workspace, which could otherwise recurse into this same rebuild.
        shadow = null;
        cancelPending?.();
        // An official cancellation callback may have opened a new dialog.
        if (shadow?.host.isConnected) return shadow;
      }
      if (!doc.documentElement) return null;
      const host = doc.createElement('div');
      host.id = 'bili-prophecy-desktop';
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; color-scheme: light; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
        * { box-sizing: border-box; }
        .backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 22px; background: #14233969; backdrop-filter: blur(6px); animation: veil-in .16s ease-out; }
        .dialog { width: min(364px, 100%); max-height: calc(100dvh - 44px); overflow: auto; background: #fff; color: #18191c; border: 1px solid #dfe3e9; border-radius: 16px; padding: 0; box-shadow: 0 18px 48px #0f172e2e; font-size: 14px; line-height: 1.65; animation: dialog-in .2s ease-out; }
        .dialog-head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px; background: linear-gradient(120deg, #fcedf2, #f2eef8 48%, #e6f7fd); border-bottom: 1px solid #e0e4ea; }
        .dialog-mark { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; margin-top: 2px; color: #0084b0; border: 1px solid #ffffffb3; border-radius: 10px; background: #ffffff80; }
        .dialog-heading { min-width: 0; }
        .dialog-eyebrow { margin-bottom: 3px; color: #637083; font-size: 11px; }
        h2 { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.55; overflow-wrap: anywhere; }
        p { margin: 18px 18px 14px; padding: 12px; color: #3f4c5d; background: #f6f7f8; border: 1px solid #e5e7eb; border-radius: 12px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; }
        .dialog-accent { height: 3px; margin: 0 18px; border-radius: 8px; background: linear-gradient(90deg, #fb7299, #ae9cdb 48%, #00aeec); }
        .buttons { display: flex; gap: 9px; padding: 16px 18px 18px; }
        button { flex: 1; min-width: 0; min-height: 36px; border: 1px solid #b9e1f2; border-radius: 10px; padding: 8px; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; background: #fff; color: #007ba5; transition: background .15s, transform .15s; }
        button:hover { background: #f0faff; }
        button:active { transform: translateY(1px); }
        button[data-desktop-action="confirm"] { border-color: #f3b8ce; background: linear-gradient(115deg, #fff0f5, #f9f2ff); color: #b33568; font-weight: 700; }
        button[data-desktop-action="confirm"]:hover { background: linear-gradient(115deg, #ffe4ed, #f3e9fc); }
        button:focus-visible { outline: 2px solid #aa9ad9; outline-offset: 2px; }
        .toast { position: fixed; display: flex; align-items: center; gap: 9px; left: 50%; bottom: 24px; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 32px); background: linear-gradient(115deg, #fff7fa, #f8f5fc 45%, #eefaff); color: #3f4c5d; border: 1px solid #dce4ef; border-radius: 12px; padding: 11px 14px; font-size: 13px; line-height: 1.6; text-align: left; box-shadow: 0 8px 28px #1423391a; }
        .toast svg { color: #0084b0; flex-shrink: 0; }
        @keyframes veil-in { from { opacity: 0; } }
        @keyframes dialog-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
        @media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
        [hidden] { display: none !important; }
      </style><div class="toast" role="status" aria-live="polite" aria-atomic="true" hidden>${icon('signal', 18)}<span></span></div>`;
      installOfficialTheme();
      (doc.body || doc.documentElement).append(host);
      if (!eventsBound) {
      eventsBound = true;
      doc.addEventListener('keydown', event => {
        if (event.key === 'Tab' && cancelPending) {
          const buttons = [...shadow.querySelectorAll('.dialog button')];
          const first = buttons[0], last = buttons[buttons.length - 1];
          const active = shadow.activeElement;
          if (buttons.length && ((!event.shiftKey && active === last) || (event.shiftKey && active === first) || !buttons.includes(active))) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
        if (event.key === 'Escape' && cancelPending) {
          event.preventDefault();
          cancelPending();
        }
      });
      page.addEventListener('hashchange', () => { cancelPending?.(); syncWorkspace(); });
      page.addEventListener('pagehide', pauseDocument);
      page.addEventListener('pageshow', observeDocument);
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) pauseDocument(); else observeDocument(); });
      }
      return shadow;
    }

    function syncWorkspace() {
      if (!observing) return;
      // Components may already be cached when adapting a page on the history
      // route. Cover their later mount without evaluating an unloaded chunk.
      const current = doc.querySelector('.user-detail-content')?.__vue__;
      if (current) patchCurrentCards(current.$options);
      for (const node of doc.querySelectorAll('.content-prohets-box')) {
        if (node.__vue__) patchCard(node.__vue__.$options);
      }
      for (const node of doc.querySelectorAll('.content-pkline')) {
        if (node.__vue__) patchProgress(node.__vue__.$options);
      }
      if (shadow && !shadow.host.isConnected) { cancelPending?.(); ensureRoot(); }
      const route = page.location.hash.slice(1) || '/';
      const supported = route === '/' || route === '/history';
      const content = doc.querySelector('.user-detail-content, .content[data-v-00192e7f]');
      if (!doc.body || !supported || !content) {
        if (workspace) workspace.host.hidden = true;
        doc.documentElement?.removeAttribute('data-bili-prophecy-workspace');
        return;
      }
      if (!workspace?.host.isConnected) {
        const host = doc.createElement('div');
        host.id = 'bili-prophecy-workspace';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
          :host { all: initial; display: block; position: sticky; top: 0; z-index: 50; color-scheme: light; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
          :host([hidden]) { display: none; }
          * { box-sizing: border-box; }
          .surface { position: relative; background: #fffffff2; border-bottom: 1px solid #e6e8ee; backdrop-filter: blur(16px); }
          .surface::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: linear-gradient(90deg, #fb7299, #ae9cdb 48%, #00aeec); opacity: .7; }
          .bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; max-width: 960px; min-height: 68px; margin: 0 auto; padding: 14px 20px; }
          .brand { display: flex; align-items: center; gap: 10px; color: #273449; font-size: 16px; font-weight: 700; white-space: nowrap; }
          .mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: #0084b0; background: linear-gradient(125deg, #fcedf2, #f2eef8 48%, #e6f7fd); }
          nav { display: flex; align-items: center; gap: 6px; }
          a, button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 7px 12px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #637083; font: inherit; font-size: 12px; line-height: 18px; text-decoration: none; cursor: pointer; transition: background .15s, color .15s; }
          a:hover, button:hover:not(:disabled) { background: #f4f6f9; color: #3f4c5d; }
          a[aria-current="page"] { border-color: #e2dcef; background: linear-gradient(115deg, #fff5f9, #f7f4fd 48%, #effaff); color: #485677; font-weight: 650; }
          a[aria-disabled="true"], button:disabled { opacity: .45; cursor: default; }
          button { width: 34px; padding: 7px; flex-shrink: 0; }
          svg { flex-shrink: 0; }
          a:focus-visible, button:focus-visible { outline: 2px solid #aa9ad9; outline-offset: 2px; }
          @media (max-width: 540px) { .bar { gap: 10px; min-height: 60px; padding: 12px 16px; } .brand { font-size: 14px; gap: 7px; } .mark { width: 26px; height: 26px; } nav { gap: 2px; } a { padding: 6px 8px; font-size: 11px; gap: 4px; } }
          @media (max-width: 380px) { .brand > span:last-child { display: none; } .bar { gap: 6px; } }
          @media (prefers-reduced-motion: reduce) { a, button { transition: none; } }
        </style><div class="surface"><header class="bar"><div class="brand"><span class="mark">${icon('spark', 19)}</span><span>直播预言</span></div><nav aria-label="预言页面"><a data-view="current">${icon('spark', 14)}当前预言</a><a data-view="history">${icon('history', 14)}参与记录</a></nav><button type="button" data-workspace-action="refresh" aria-label="刷新当前页面" title="刷新当前页面">${icon('refresh', 16)}</button></header></div>`;
        workspace = { host, root, current: root.querySelector('[data-view="current"]'), history: root.querySelector('[data-view="history"]'), refresh: root.querySelector('button') };
        root.addEventListener('click', event => {
          const link = event.target.closest?.('a[data-view]');
          if (link && (adapter.busy || link.getAttribute('aria-disabled') === 'true')) event.preventDefault();
          if (event.target.closest?.('[data-workspace-action="refresh"]') && !adapter.busy) page.location.reload();
        });
        doc.body.prepend(host);
      }
      workspace.host.hidden = false;
      doc.documentElement.dataset.biliProphecyWorkspace = '';
      const hasOwner = Boolean(positiveId(new URL(page.location.href).searchParams.get('anchorId')));
      for (const [view, link] of [['current', workspace.current], ['history', workspace.history]]) {
        const url = new URL(page.location.href);
        url.hash = view === 'history' ? '/history' : '/';
        const disabled = adapter.busy || (view === 'current' && !hasOwner);
        if (view === 'current' && !hasOwner) link.removeAttribute('href');
        else link.href = url.href;
        link.setAttribute('aria-disabled', String(disabled));
        if (route === (view === 'history' ? '/history' : '/')) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      workspace.refresh.disabled = adapter.busy;
    }

    function setDialogBusy() {
      syncWorkspace();
    }

    function lockPage() {
      const body = doc.body;
      const overflow = body?.style.getPropertyValue('overflow') || '';
      const priority = body?.style.getPropertyPriority('overflow') || '';
      const targets = [doc.getElementById('app'), workspace?.host].filter(Boolean).map(node => ({ node, inert: Boolean(node.inert) }));
      body?.style.setProperty('overflow', 'hidden');
      for (const { node } of targets) node.inert = true;
      return () => {
        if (body) { if (overflow) body.style.setProperty('overflow', overflow, priority); else body.style.removeProperty('overflow'); }
        for (const { node, inert } of targets) node.inert = inert;
      };
    }

    function observeDocument() {
      observing = true;
      if (!desktopObserver) {
        desktopObserver = new page.MutationObserver(syncWorkspace);
        desktopObserver.observe(doc, { childList: true, subtree: true });
      }
      syncWorkspace();
    }

    function pauseDocument() {
      cancelPending?.();
      observing = false;
      desktopObserver?.disconnect();
      desktopObserver = null;
      page.clearTimeout(toastTimer);
      const toast = shadow?.querySelector('.toast');
      if (toast) toast.hidden = true;
    }

    function installOfficialTheme() {
      if (doc.getElementById('bili-prophecy-theme')) return;
      doc.documentElement.dataset.biliProphecyDesktop = '';
      const style = doc.createElement('style');
      style.id = 'bili-prophecy-theme';
      // Scope to the official desktop document and its existing component
      // classes. Vue owns the cards, selected state and all event handlers.
      style.textContent = `
        html[data-bili-prophecy-desktop] { font-size: 40px !important; color-scheme: light; background: #f7f9fc; }
        html[data-bili-prophecy-desktop] body { margin: 0; background: #f7f9fc !important; opacity: 1 !important; font: 14px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
        html[data-bili-prophecy-desktop] body::-webkit-scrollbar { width: 5px; }
        html[data-bili-prophecy-desktop] body::-webkit-scrollbar-thumb { background: #ccd6e2; border-radius: 8px; }
        html[data-bili-prophecy-desktop] .user-detail-content,
        html[data-bili-prophecy-desktop] .content[data-v-00192e7f] { width: 100%; padding: 16px 16px 12px; box-sizing: border-box; }
        html[data-bili-prophecy-desktop] .content[data-v-7569cb0e] { padding: 0 4px 2px; align-items: flex-start; }
        html[data-bili-prophecy-desktop] .content[data-v-7569cb0e] > .title { font-size: 13px; color: #526378; font-weight: 600; }
        html[data-bili-prophecy-desktop] .sub-title { color: #63758b; font-size: 12px; margin-top: 7px; margin-left: 0; }
        html[data-bili-prophecy-desktop] .tip { opacity: .5; right: 4px; filter: grayscale(1) brightness(.6); }
        html[data-bili-prophecy-desktop] .mb20 { margin-bottom: 16px; }
        html[data-bili-prophecy-desktop] .content-prohets-box,
        html[data-bili-prophecy-desktop] .item-content { height: auto; min-height: 0; border: 1px solid #e5e8ef; background: #fff; padding: 20px; margin-bottom: 16px; border-radius: 14px; box-shadow: 0 3px 12px #2a496506; }
        html[data-bili-prophecy-desktop] .content-prohets-box .title,
        html[data-bili-prophecy-desktop] .item-content .title { color: #273449; flex: 1; min-width: 0; font-size: 16px; line-height: 1.6; font-weight: 650; overflow-wrap: anywhere; }
        html[data-bili-prophecy-desktop] .text-line { min-height: 0; height: auto; padding: 0 0 14px; gap: 12px; align-items: flex-start; }
        html[data-bili-prophecy-desktop] .text-line > .line,
        html[data-bili-prophecy-desktop] .tick-block { flex-shrink: 0; margin-top: 3px; }
        html[data-bili-prophecy-desktop] .tickey,
        html[data-bili-prophecy-desktop] .sub-info,
        html[data-bili-prophecy-desktop] .count { color: #63758b; font-size: 12px; }
        html[data-bili-prophecy-desktop] .text-line .count-time { color: #008dbe; font-size: 12px; font-variant-numeric: tabular-nums; }
        /* The official card centers this row without a width. Flex children
           then shrink to their text, leaving two narrow vertical buttons. */
        html[data-bili-prophecy-desktop] .content-prohets-box > .line.mt8 { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr); align-items: stretch; gap: 10px; width: 100%; margin-top: 0; }
        html[data-bili-prophecy-desktop] .bigbox { flex: 1; width: auto; min-width: 0; height: auto; }
        html[data-bili-prophecy-desktop] .box { box-sizing: border-box; width: 100%; height: 100%; min-height: 76px; border-radius: 10px; opacity: 1; border: 1px solid #cce8f5; background: linear-gradient(120deg, #edfaff, #f3f5ff) !important; transition: box-shadow .15s, transform .15s; }
        html[data-bili-prophecy-desktop] .bigbox:last-child .box { border-color: #f1d4e0; background: linear-gradient(120deg, #fff1f6, #f9f3ff) !important; }
        html[data-bili-prophecy-desktop] .box .count-time { position: relative; max-width: 100%; color: #08769d; font-size: 16px; font-weight: 650; line-height: 1.45; text-align: center; overflow-wrap: anywhere; }
        html[data-bili-prophecy-desktop] .bigbox:last-child .box .count-time { color: #b63f70; }
        html[data-bili-prophecy-desktop] .box .sub-score { color: #5e7085; font-size: 10px; line-height: 1.5; transform: none; margin-top: 5px; white-space: nowrap; }
        html[data-bili-prophecy-desktop] .box.selected { border: 2px solid #40b4da; box-shadow: 0 2px 8px #00aeec0c; }
        html[data-bili-prophecy-desktop] .bigbox:last-child .box.selected { border-color: #ee85aa; box-shadow: 0 2px 8px #ff66990c; }
        html[data-bili-prophecy-desktop] .box.unselected { opacity: 1; }
        html[data-bili-prophecy-desktop] .content-prohets-box > .line:has(.box.selected) .box.unselected { opacity: .72; }
        html[data-bili-prophecy-desktop] .block { min-height: 66px; padding: 8px; cursor: default; box-sizing: border-box; }
        html[data-bili-prophecy-desktop] .box .block { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 0; }
        html[data-bili-prophecy-desktop] .content-prohets-box:has(.tick-block .count-time):not(:has(.box.selected)) .block { cursor: pointer; }
        html[data-bili-prophecy-desktop] .content-prohets-box:has(.tick-block .count-time):not(:has(.box.selected)) .box:hover { box-shadow: 0 4px 12px #1d8db317; transform: translateY(-1px); }
        html[data-bili-prophecy-desktop] .box .icon { height: 22px; left: 7px; top: 7px; opacity: .7; }
        html[data-bili-prophecy-desktop] .vs { width: 22px; margin: 0; align-self: center; opacity: .65; filter: grayscale(1) brightness(.6); }
        html[data-bili-prophecy-desktop] .pk { width: 100%; height: 14px; margin-top: 14px; }
        html[data-bili-prophecy-desktop] .content-pkline { font-variant-numeric: tabular-nums; }
        html[data-bili-prophecy-desktop] .pk .left,
        html[data-bili-prophecy-desktop] .pk .right { font: 10px/14px system-ui, sans-serif; }
        html[data-bili-prophecy-desktop] .pk .left { color: #033a4f; font-weight: 600; }
        html[data-bili-prophecy-desktop] .pk .right { color: #571930; font-weight: 600; }
        html[data-bili-prophecy-desktop] .pk .trangle { width: 10px; }
        html[data-bili-prophecy-desktop] .pk .trangle .blue { border-bottom-width: 14px; border-right-width: 10px; }
        html[data-bili-prophecy-desktop] .pk .trangle .pink { border-top-width: 14px; border-left-width: 10px; }
        /* Draw the ratio independently of label widths. The native flex row
           reserves a third width for triangles and expands small vote totals. */
        html[data-bili-prophecy-desktop] .pk[data-bili-prophecy-progress] { display: flex; align-items: center; overflow: hidden; border-radius: 999px; font: 10px/14px system-ui, sans-serif; background: linear-gradient(to right, #00aeec 0%, #00aeec var(--bili-prophecy-left-share), #ff6699 var(--bili-prophecy-left-share), #ff6699 100%); }
        html[data-bili-prophecy-desktop] .pk[data-bili-prophecy-progress] > .left,
        html[data-bili-prophecy-desktop] .pk[data-bili-prophecy-progress] > .right { flex: 0 0 auto; width: auto !important; min-width: 0; max-width: 50%; box-sizing: border-box; padding: 0 7px; border-radius: 0; background: #ffffff80; line-height: inherit; white-space: nowrap; transition: none; }
        html[data-bili-prophecy-desktop] .pk[data-bili-prophecy-progress] > .trangle { display: none; }
        html[data-bili-prophecy-desktop] .bili-prophecy-card-status { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 4px; background: #e5f6fc; color: #007ba5; font-size: 10px; font-weight: 500; line-height: 1.5; vertical-align: middle; white-space: nowrap; }
        html[data-bili-prophecy-desktop] .content-prohets-box:is([data-bili-prophecy-state="pending"], [data-bili-prophecy-state="waiting"], [data-bili-prophecy-state="ended"], [data-bili-prophecy-state="cancelled"]) { background: #f1f2f4; border-color: #dfe2e7; filter: grayscale(1); }
        html[data-bili-prophecy-desktop] .content-prohets-box:not([data-bili-prophecy-state="open"]) .bili-prophecy-card-status { color: #616975; background: #e2e5ea; }
        html[data-bili-prophecy-desktop] .content-prohets-box:not([data-bili-prophecy-state="open"]) .box:hover { transform: none; box-shadow: none; }
        html[data-bili-prophecy-desktop] .user-game-footer { display: flex; align-items: center; height: 58px; background: #fffffff5; border-top: 1px solid #e5ebf3; padding: 12px 16px; backdrop-filter: blur(10px); box-shadow: 0 -4px 14px #2a496503; }
        html[data-bili-prophecy-desktop] .user-game-footer > .line { width: 100%; gap: 8px; }
        html[data-bili-prophecy-desktop] .user-game-footer .left { color: #273449; }
        html[data-bili-prophecy-desktop] .user-game-footer .right,
        html[data-bili-prophecy-desktop] .get-heart { color: #65758b; font-size: 11px; }
        html[data-bili-prophecy-desktop] .user-game-footer .heart { width: 18px; opacity: .75; }
        html[data-bili-prophecy-desktop] .heart-num { color: #008dbe; font-size: 18px; line-height: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
        html[data-bili-prophecy-desktop] .h80 { height: 64px; flex-shrink: 0; }
        html[data-bili-prophecy-desktop] .item-content .title-line { align-items: flex-start; gap: 10px; }
        html[data-bili-prophecy-desktop] .item-content .sub,
        html[data-bili-prophecy-desktop] .item-content .gary { color: #63758b; }
        html[data-bili-prophecy-desktop] .item-content .text-content,
        html[data-bili-prophecy-desktop] .item-content .white { color: #516075; }
        html[data-bili-prophecy-desktop] .header[data-v-00192e7f] .title { color: #526378; font-size: 13px; font-weight: 600; }
        html[data-bili-prophecy-desktop] .empty { margin-top: 54px; }
        html[data-bili-prophecy-desktop] .empty-content .sub { color: #8593a5; max-width: 270px; line-height: 1.8; }
        html[data-bili-prophecy-desktop] .loading p { color: #526378; }
        @media (min-width: 560px) { html[data-bili-prophecy-desktop] .user-detail-content, html[data-bili-prophecy-desktop] .content[data-v-00192e7f] { max-width: 960px; margin: 0 auto; padding-top: 20px; } html[data-bili-prophecy-desktop] .user-game-footer { max-width: 960px; left: 50%; transform: translateX(-50%); border-radius: 16px 16px 0 0; } }
        @media (min-width: 1000px) {
          html[data-bili-prophecy-desktop] .user-detail-content,
          html[data-bili-prophecy-desktop] .content[data-v-00192e7f] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
          html[data-bili-prophecy-desktop] .user-detail-content > :not(.content-prohets-box),
          html[data-bili-prophecy-desktop] .content[data-v-00192e7f] > :not(.item-content) { grid-column: 1 / -1; }
          html[data-bili-prophecy-desktop] .content-prohets-box,
          html[data-bili-prophecy-desktop] .item-content { margin-bottom: 0; }
        }
        @media (max-width: 340px) { html[data-bili-prophecy-desktop] .content-prohets-box, html[data-bili-prophecy-desktop] .item-content { padding: 12px; } html[data-bili-prophecy-desktop] .text-line { gap: 8px; } html[data-bili-prophecy-desktop] .box .sub-score { font-size: 9px; } }
        @media (prefers-reduced-motion: reduce) { html[data-bili-prophecy-desktop] .box { transition: none; } }
      `.replaceAll('html[data-bili-prophecy-desktop]', 'html[data-bili-prophecy-desktop]:has(.user-detail-content, .content[data-v-00192e7f])');
      if (embedded) {
        doc.documentElement.dataset.biliProphecyEmbedded = '';
        const compact = 'html:root[data-bili-prophecy-desktop][data-bili-prophecy-embedded]';
        // Only the embedded viewport is compact. Vue still owns every card,
        // selection and rule link; standalone desktop pages retain their layout.
        style.textContent += `
          ${compact} .user-detail-content, ${compact} .content[data-v-00192e7f] { padding: 10px; }
          ${compact} .user-detail-content > .content[data-v-7569cb0e] { position: relative; box-sizing: border-box; display: block; width: 100%; height: auto; padding: 0 24px 0 0; margin-bottom: 10px; }
          ${compact} .user-detail-content > .content[data-v-7569cb0e] > .title { display: none; }
          ${compact} .sub-title { display: block; max-width: 100%; font-size: 11px; line-height: 1.5; margin: 0; white-space: normal; overflow-wrap: anywhere; }
          ${compact} .tip { position: absolute; width: 20px; height: 20px; left: auto; right: 0; top: 0; bottom: auto; margin: 0; transform: none; opacity: .7; }
          ${compact} .content-prohets-box, ${compact} .item-content { padding: 12px; margin-bottom: 10px; border-radius: 10px; box-shadow: none; }
          ${compact} .content-prohets-box .title, ${compact} .item-content .title { font-size: 15px; line-height: 1.45; }
          ${compact} .text-line { padding-bottom: 8px; gap: 8px; }
          ${compact} .content-prohets-box > .line.mt8 { grid-template-columns: minmax(0,1fr) 16px minmax(0,1fr); gap: 8px; }
          ${compact} .box { min-height: 60px; border-radius: 8px; }
          ${compact} .box .block { padding: 6px; }
          ${compact} .box .count-time { font-size: 15px; line-height: 1.4; }
          ${compact} .box .sub-score { margin-top: 3px; }
          ${compact} .box .icon { height: 16px; left: 5px; top: 5px; }
          ${compact} .vs { width: 16px; }
          ${compact} .pk { height: 14px; margin-top: 10px; }
          ${compact} .pk .left, ${compact} .pk .right { font-size: 10px; line-height: 12px; }
          ${compact} .pk .trangle .blue { border-bottom-width: 12px; }
          ${compact} .pk .trangle .pink { border-top-width: 12px; }
          ${compact} .user-game-footer { box-sizing: border-box; height: 40px; padding: 6px 10px; }
          ${compact} .user-game-footer .heart { width: 16px; }
          ${compact} .heart-num { font-size: 16px; line-height: 20px; }
          ${compact} .h80 { height: 46px; }
        `;
      }
      (doc.head || doc.documentElement).append(style);
    }

    function showModal(options = {}) {
      if (disposed || adapter.isCurrent?.() === false || (embedded && !embeddedVisible)) return page.Promise.resolve({ confirm: false, cancel: true, noRemind: false });
      cancelPending?.();
      endSubmission();
      const root = ensureRoot();
      const backdrop = doc.createElement('div');
      backdrop.className = 'backdrop';
      const dialog = doc.createElement('section');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'desktop-modal-title');
      dialog.setAttribute('aria-describedby', 'desktop-modal-content');
      const mark = doc.createElement('div');
      mark.className = 'dialog-mark';
      mark.innerHTML = icon('spark', 18);
      const eyebrow = doc.createElement('div');
      eyebrow.className = 'dialog-eyebrow';
      eyebrow.textContent = '直播预言 · 请确认';
      const title = doc.createElement('h2');
      title.id = 'desktop-modal-title';
      title.textContent = options.title || '直播预言';
      const heading = doc.createElement('div');
      heading.className = 'dialog-heading';
      heading.append(eyebrow, title);
      const head = doc.createElement('div');
      head.className = 'dialog-head';
      head.append(mark, heading);
      const content = doc.createElement('p');
      content.id = 'desktop-modal-content';
      content.textContent = options.content || '';
      const accent = doc.createElement('div');
      accent.className = 'dialog-accent';
      accent.setAttribute('aria-hidden', 'true');
      const buttons = doc.createElement('div');
      buttons.className = 'buttons';
      const previousFocus = doc.activeElement?.shadowRoot?.activeElement || doc.activeElement;
      const releasePage = lockPage();
      return new page.Promise(resolve => {
        let settled = false;
        const settle = confirm => {
          if (settled) return;
          settled = true;
          cancelPending = null;
          backdrop.remove();
          releasePage();
          if (confirm && embedded) {
            submitting = true;
            releaseSubmission = lockPage();
          }
          setDialogBusy();
          if (previousFocus?.isConnected) previousFocus.focus?.();
          else workspace?.current.focus();
          const result = { confirm, cancel: !confirm, noRemind: false };
          try {
            if (typeof options.callback === 'function') options.callback(result);
            if (typeof options.success === 'function') options.success(result);
          } finally { resolve(result); }
        };
        cancelPending = () => settle(false);
        setDialogBusy();
        for (const action of options.showCancel === false ? ['confirm'] : ['cancel', 'confirm']) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.dataset.desktopAction = action;
          button.textContent = action === 'confirm' ? options.confirmText || '确认' : options.cancelText || '取消';
          button.addEventListener('click', () => settle(action === 'confirm'), { once: true });
          buttons.append(button);
        }
        dialog.append(head, content, accent, buttons);
        backdrop.append(dialog);
        root.append(backdrop);
        // Default focus goes to cancellation when available; never auto-confirm.
        buttons.querySelector('button').focus();
      });
    }

    function showToast(options = {}) {
      endSubmission();
      const toast = ensureRoot().querySelector('.toast');
      toast.querySelectorAll('a').forEach(link => link.remove());
      const message = String(options.msg || options.title || '');
      toast.querySelector('span').textContent = message;
      toast.hidden = false;
      page.clearTimeout(toastTimer);
      toastTimer = page.setTimeout(() => { toast.hidden = true; }, Math.min(8000, Math.max(3200, message.length * 60)));
      return page.Promise.resolve({});
    }

    function patchSDK(sdk) {
      if (!sdk || typeof sdk.showConfirm !== 'function' || typeof sdk.Request !== 'function' || patchedSDKs.has(sdk)) return;
      if ([1, 2, 3].includes(sdk.getEnvSync?.())) return;
      patchedSDKs.add(sdk);
      sdk.showModal = showModal;
      sdk.showConfirm = options => showModal({ ...options, showCancel: true });
      sdk.showAlert = options => showModal({ ...options, showCancel: false });
      sdk.showToast = showToast;
      if (embedded) sdk.openView = options => {
        endSubmission();
        embeddedNavigation(options?.url);
        return page.Promise.resolve(true);
      };
      adapter.status = 'ready';
      ensureRoot();
    }

    function patchChunk(record) {
      const modules = record?.[1];
      for (const [id, patch] of [[1171, exports => patchSDK(exports.Ay)], [6151, exports => patchAPI(exports.E)],
        [7336, exports => patchCurrentCards(exports.default)], [319, exports => patchProgress(exports.A)]]) {
        const factory = modules?.[id];
        if (typeof factory !== 'function' || wrappedFactories.has(factory)) continue;
        const wrapped = function(module, exports, require) {
          const value = factory.call(this, module, exports, require);
          patch(exports);
          return value;
        };
        wrappedFactories.add(wrapped);
        modules[id] = wrapped;
      }
    }

    for (const record of queue) patchChunk(record);
    const wrapPush = implementation => function(...records) {
      for (const record of records) patchChunk(record);
      return implementation.apply(this, records);
    };
    let push = wrapPush(queue.push);
    // Webpack's bootstrap replaces push; keep adapting before it registers modules.
    Object.defineProperty(queue, 'push', {
      configurable: true,
      get: () => push,
      set: implementation => { push = wrapPush(implementation); },
    });

    function probeCurrentSDK() {
      // A userscript can run after Webpack has cached the SDK. Merely wrapping
      // its factory then has no effect. A local runtime chunk exposes the same
      // require function so we can adapt the existing export without a reload.
      queue.push([[
        `bili-prophecy-desktop-${VERSION}-${Date.now()}-${Math.random()}`,
      ], {}, require => {
        if (typeof require?.m?.[1171] === 'function') patchSDK(require(1171).Ay);
        if (typeof require?.m?.[6151] === 'function') patchAPI(require(6151).E);
        if (doc.querySelector('.user-detail-content')?.__vue__ && typeof require?.m?.[7336] === 'function') patchCurrentCards(require(7336).default);
        if (doc.querySelector('.content-pkline')?.__vue__ && typeof require?.m?.[319] === 'function') patchProgress(require(319).A);
      }]);
    }

    ensureRoot();
    if (!shadow) doc.addEventListener('DOMContentLoaded', ensureRoot, { once: true });
    probeCurrentSDK();
    observeDocument();
    return adapter;
  }

  function roomId() {
    const match = location.pathname.match(/^\/(?:blanc\/)?([1-9]\d*)\/?$/);
    return match ? positiveId(match[1]) : null;
  }

  function officialUrl(view = 'current') {
    const url = new URL(OFFICIAL);
    if (state?.anchorId) url.searchParams.set('anchorId', state.anchorId);
    url.hash = view === 'history' ? '/history' : view === 'rules' ? '/doc' : '/';
    return url.href;
  }

  function cachedOwner(id) {
    const item = owners.get(id);
    if (!item) return null;
    if (Date.now() - item.savedAt >= 300000) { owners.delete(id); return null; }
    owners.delete(id);
    owners.set(id, item);
    return item.uid;
  }

  function rememberOwner(id, uid) {
    owners.delete(id);
    owners.set(id, { uid, savedAt: Date.now() });
    if (owners.size > 32) owners.delete(owners.keys().next().value);
  }

  function syncEntryTheme() {
    if (!ui?.host.isConnected) return;
    let node = ui.themeInput || ui.composer;
    let dark = false;
    while (node) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (rgba?.length >= 3 && (rgba.length === 3 || rgba[3] >= .5)) {
        dark = rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 140;
        break;
      }
      node = node.parentElement;
    }
    const theme = dark ? 'dark' : 'light';
    if (ui.host.dataset.theme !== theme) ui.host.dataset.theme = theme;
    positionPanel();
  }

  function watchEntryTheme() {
    if (!ui?.host.isConnected || document.hidden) return;
    const input = ui.composer.querySelector('.chat-input-ctnr');
    if (themeObserver && ui.themeInput === input) return;
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(syncEntryTheme);
    ui.themeInput = input;
    const nodes = new Set([document.documentElement, document.body, ui.composer, input]);
    for (let node = ui.mountPoint; node; node = node.parentElement) nodes.add(node);
    for (const node of nodes) if (node) themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    syncEntryTheme();
  }

  function placeRoot() {
    if (panel && !panel.host.isConnected) { destroyPanel(); renderEntry(); }
    if (!active || document.hidden || !ui || !state) return;
    const composer = ui.composer?.isConnected ? ui.composer : document.querySelector(CHAT_CONTROLS);
    // The history wrapper sits above the composer in the sidebar's stacking
    // order. Mount outside its scrolling list so messages scroll past the entry.
    const history = composer?.parentElement?.querySelector(':scope > .chat-history-panel');
    const mountPoint = history || composer;
    if (ui.composer !== composer || ui.mountPoint !== mountPoint) {
      themeObserver?.disconnect();
      themeObserver = null;
      ui.composer = composer;
      ui.restoreMount?.();
      ui.restoreMount = null;
      ui.mountPoint = mountPoint;
      if (mountPoint) {
        const position = getComputedStyle(mountPoint).position;
        if (!position || position === 'static') {
          const previous = mountPoint.style.position;
          mountPoint.style.position = 'relative';
          ui.restoreMount = () => {
            if (mountPoint.style.position === 'relative') mountPoint.style.position = previous;
          };
        }
        ui.host.dataset.placement = history ? 'history' : 'composer';
      }
    }
    if (!mountPoint) { ui.host.remove(); positionPanel(); return; }
    if (ui.host.parentNode !== mountPoint) mountPoint.append(ui.host);
    watchEntryTheme();
  }

  function createUI() {
    const host = document.createElement('div');
    host.id = ROOT_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host { all: initial; position: absolute; inset-inline-end: 10px; inset-block-end: calc(100% + 10px); z-index: 10; display: block; width: 32px; height: 32px; color-scheme: light dark; --entry-ink: #343a44; --entry-bg: #fff; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
      :host([data-placement="history"]) { inset-block-end: 10px; }
      :host([data-theme="dark"]) { --entry-ink: #eff2f6; --entry-bg: #252830; }
      * { box-sizing: border-box; }
      button { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 8px; color: var(--entry-ink); background: var(--entry-bg); box-shadow: 0 0 0 1px #64748b33, 0 2px 6px #0002; opacity: .55; transition: opacity .15s, transform .15s; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      svg { display: block; flex-shrink: 0; }
      button:not(:disabled):is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
      button:active:not(:disabled) { transform: scale(.94); }
      button:focus-visible { outline: 2px solid #aa9ad9; outline-offset: 2px; }
      button:disabled { cursor: wait; }
      button[data-state="error"] { color: #bf7857; }
      :host([data-theme="dark"]) button[data-state="error"] { color: #e6af91; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    </style><button type="button" data-action="open" aria-label="打开直播预言面板" aria-expanded="false" aria-controls="bili-prophecy-panel">${icon('spark', 22)}</button>`;
    const button = shadow.querySelector('button');
    ui = { host, button, composer: null, mountPoint: null, restoreMount: null, themeInput: null };
    button.addEventListener('pointerenter', syncEntryTheme);
    button.addEventListener('focus', syncEntryTheme);
    button.addEventListener('click', event => {
      event.stopPropagation();
      openPrediction(event.shiftKey ? 'history' : 'current', !event.shiftKey);
    });
    renderEntry();
    placeRoot();
  }

  function renderEntry() {
    if (!ui || !state) return;
    updatePanelControls();
    const loading = state.status === 'loading';
    ui.button.disabled = loading;
    ui.button.dataset.state = state.status;
    ui.button.setAttribute('aria-busy', String(loading));
    const expanded = Boolean(panel?.visible);
    ui.button.setAttribute('aria-label', expanded ? '关闭直播预言面板'
      : state.status === 'error' ? '主播识别失败，点击重试' : '打开直播预言面板');
    ui.button.setAttribute('aria-expanded', String(expanded));
    ui.button.title = loading ? '正在识别当前主播…'
      : state.status === 'error' ? `${state.error} 点击重试；参与记录可从油猴菜单打开。`
      : `直播预言 · 点击${expanded ? '关闭' : '打开'}面板；Shift+点击查看参与记录 · v${VERSION}`;
  }

  function openPrediction(view = 'current', toggle = false) {
    syncRoute();
    if (!state) return;
    if (toggle && panel?.visible) { hidePanel(); return; }
    if (view !== 'history') {
      if (!state || state.status === 'loading') return;
      if (state.status === 'error') { lookup(state); return; }
      if (!positiveId(state.anchorId)) return;
    }
    if (!panel) createPanel(view);
    const p = panel;
    p.visible = true;
    p.host.hidden = false;
    positionPanel();
    if (p.view !== view && !p.adapter?.busy) navigatePanel(view);
    p.adapter?.setVisible(true);
    renderEntry();
    p.root.querySelector('[data-panel-action="close"]').focus({ preventScroll: true });
  }

  function framePage(p) {
    // Use the page window also when Tampermonkey runs in a separate world.
    return pageWindow.document.getElementById('bili-prophecy-panel')?.shadowRoot?.querySelector('iframe')?.contentWindow || p.frame?.contentWindow;
  }

  function createPanel(view) {
    const host = document.createElement('div');
    host.id = 'bili-prophecy-panel';
    host.setAttribute('popover', 'manual');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; inset: auto; margin: 0; padding: 0; border: 0; width: 420px; height: 600px; z-index: 2147483646; background: transparent; color-scheme: light; font: 14px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
      :host([hidden]) { display: none !important; }
      * { box-sizing: border-box; }
      .panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; color: #18191c; border: 1px solid #e3e5e7; border-radius: 12px; box-shadow: 0 8px 40px #0003; }
      header { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 10px; background: #fff; border-bottom: 1px solid #f1f2f3; cursor: move; touch-action: none; user-select: none; }
      header button { padding: 5px; }
      h2 { flex: 1; min-width: 0; margin: 0; font-size: 14px; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 0; border-radius: 6px; padding: 6px; color: #61666d; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
      button:hover { background: #f1f2f3; color: #00aeec; }
      button:disabled { cursor: wait; opacity: .45; }
      button:focus-visible { outline: 2px solid #00aeec; outline-offset: -2px; }
      nav { display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 3px 10px; border-bottom: 1px solid #f1f2f3; }
      nav button { padding: 4px 8px; line-height: 18px; }
      nav button[aria-current="page"] { color: #00aeec; background: #e5f6fd; }
      .body { position: relative; flex: 1; min-height: 0; overflow: hidden; overscroll-behavior: contain; }
      iframe { display: block; border: 0; width: 100%; height: 100%; background: #f7f9fc; }
      .status { position: absolute; inset: 0; overflow: auto; display: grid; align-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; background: #f7f9fc; line-height: 1.7; }
      footer { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 2px 8px; border-top: 1px solid #f1f2f3; font-size: 11px; line-height: 16px; color: #9499a0; }
      footer button { padding: 2px 6px; font-size: 11px; line-height: 16px; }
      [hidden] { display: none !important; }
    </style><section class="panel" role="dialog" aria-label="直播预言">
      <header>
        <h2>直播预言</h2>
        <button type="button" data-panel-action="reset-position" title="重置位置" aria-label="重置位置">${icon('dock', 17)}</button>
        <button type="button" data-panel-action="refresh" title="刷新预言" aria-label="刷新预言">${icon('refresh', 17)}</button>
        <button type="button" data-panel-action="close" title="关闭面板" aria-label="关闭面板">${icon('close', 18)}</button>
      </header>
      <nav aria-label="预言页面"><button type="button" data-view="current">当前预言</button><button type="button" data-view="history">参与历史</button></nav>
      <div class="body"><div class="status" role="status"><span>正在加载官方预言…</span><button type="button" data-panel-action="refresh" hidden>重试加载</button></div></div>
      <footer><span class="hint">官方预言 · 手动确认参与</span><button type="button" data-panel-action="external" title="手动在新标签页打开官方预言">${icon('external', 13)}备用入口</button></footer>
    </section>`;
    const p = panel = { host, root, view, visible: true, frame: null, adapter: null, check: null, timeout: null, cleanup: null, position: null };
    try {
      const saved = JSON.parse(sessionStorage.getItem(POSITION_KEY));
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) p.position = saved;
    } catch { /* session storage may be unavailable */ }
    // The sidebar can clip overflowing descendants even when their rectangles
    // are correct. Keep the persistent frame outside that subtree and promote
    // its host to the browser top layer and keep the iframe across reopenings.
    (document.body || document.documentElement).append(host);
    let drag = null;
    const header = root.querySelector('header');
    root.addEventListener('click', event => {
      event.stopPropagation();
      const action = event.target.closest?.('[data-panel-action]')?.dataset.panelAction;
      const view = event.target.closest?.('[data-view]')?.dataset.view;
      if (action === 'close') { hidePanel(); return; }
      if (action === 'reset-position') {
        drag = null;
        p.position = null;
        p.floatingSize = null;
        try { sessionStorage.removeItem(POSITION_KEY); } catch { /* optional */ }
        positionPanel();
        return;
      }
      if (action === 'refresh' && !p.adapter?.busy) loadPanel(currentPanelView(p));
      if (view && !p.adapter?.busy) navigatePanel(view);
      if (action === 'external' && !p.adapter?.busy) window.open(officialUrl(currentPanelView(p)), '_blank', 'noopener,noreferrer');
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hidePanel(); }
    });
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = host.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      p.floatingSize = { width: rect.width, height: rect.height };
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      p.position = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
      positionPanel();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      try { sessionStorage.setItem(POSITION_KEY, JSON.stringify(p.position)); } catch { /* optional */ }
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('lostpointercapture', endDrag);
    loadPanel(view);
  }

  function positionPanel() {
    const p = panel;
    if (!p?.visible) return;
    const viewport = window.visualViewport;
    const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const container = ui?.host.isConnected ? ui.mountPoint : null;
    const fullscreen = document.fullscreenElement;
    const anchor = !p.position && container && (!fullscreen || fullscreen.contains(container)) ? container.getBoundingClientRect() : null;
    const entry = anchor && ui.host.getBoundingClientRect();
    const anchored = entry?.width > 0 && entry.right > x && entry.left < x + width
      && entry.top > y + 16 && entry.top <= y + height;
    const apply = styles => {
      // Reassigning identical style values still generates mutation records.
      // Keep idle polling from retriggering host/extension layout observers.
      for (const [key, value] of Object.entries(styles)) if (p.host.style[key] !== value) p.host.style[key] = value;
    };
    if (p.host.showPopover && !p.host.matches(':popover-open')) p.host.showPopover();
    // offsetWidth/offsetHeight round to integers. Dividing the rendered panel
    // by those values feeds rounding back into its next size every 250ms.
    // Top-layer hosts escape ancestor transforms, but still inherit CSS zoom.
    let hostScale = 1;
    for (let node = p.host; node; node = node.parentElement) {
      const zoom = parseFloat(getComputedStyle(node).zoom);
      if (zoom > 0) hostScale *= zoom;
    }
    let w, h, left, top;
    if (anchored) {
      const style = getComputedStyle(container);
      const borderBox = axis => {
        const size = parseFloat(style[axis]);
        if (!(size > 0)) return 0;
        const edges = axis === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
        return size + (style.boxSizing === 'border-box' ? 0 : edges.reduce((sum, edge) =>
          sum + (parseFloat(style[`padding${edge}`]) || 0) + (parseFloat(style[`border${edge}Width`]) || 0), 0));
      };
      const cssWidth = borderBox('width'), cssHeight = borderBox('height');
      const anchorScaleX = cssWidth ? anchor.width / cssWidth : hostScale;
      const anchorScaleY = cssHeight ? anchor.height / cssHeight : anchorScaleX;
      w = Math.min(420 * anchorScaleX, Math.max(1, width - 16));
      const bottom = entry.top - 8 * anchorScaleY;
      h = Math.min(600 * anchorScaleY, Math.max(1, bottom - y - 8));
      const right = Math.max(x + 8 + w, Math.min(anchor.right, x + width - 8));
      left = right - w;
      top = Math.max(y + 8, bottom - h);
    } else {
      w = Math.min(p.floatingSize?.width || 420 * hostScale, Math.max(1, width - 16));
      h = Math.min(p.floatingSize?.height || 600 * hostScale, Math.max(1, height - 16));
      left = Math.min(x + width - w - 8, Math.max(x + 8, p.position?.x ?? x + width - w - 16));
      top = Math.min(y + height - h - 8, Math.max(y + 8, p.position?.y ?? y + 8));
      if (p.position) p.position = { x: left, y: top };
    }
    // Anchor rectangles are viewport coordinates. Convert once to this top-
    // layer host's CSS units, independently of clipped/transformed ancestors.
    apply({ position: 'fixed', left: `${left / hostScale}px`, top: `${top / hostScale}px`, right: 'auto', bottom: 'auto', width: `${w / hostScale}px`, height: `${h / hostScale}px` });
  }

  function currentPanelView(p) {
    try {
      const page = framePage(p);
      if (page?.location.pathname === new URL(OFFICIAL).pathname) return page.location.hash === '#/history' ? 'history' : page.location.hash === '#/' || !page.location.hash ? 'current' : 'rules';
    } catch { /* loading or blocked frame */ }
    return p.view;
  }

  function updatePanelControls() {
    if (!panel) return;
    const { root, adapter, view } = panel;
    for (const button of root.querySelectorAll('[data-view], [data-panel-action="refresh"], [data-panel-action="external"]')) {
      const disabled = Boolean(adapter?.busy) || (button.dataset.view === 'current' && !state?.anchorId);
      if (button.disabled !== disabled) button.disabled = disabled;
      if (button.dataset.view) {
        if (button.dataset.view === view) { if (button.getAttribute('aria-current') !== 'page') button.setAttribute('aria-current', 'page'); }
        else if (button.hasAttribute('aria-current')) button.removeAttribute('aria-current');
      }
    }
    const hint = root.querySelector('.hint');
    const message = adapter?.processing ? '官方请求处理中，请勿重复参与' : '官方预言 · 手动确认参与';
    if (hint.textContent !== message) hint.textContent = message;
  }

  function navigatePanel(view) {
    const p = panel;
    if (!p || p.adapter?.busy || (view === 'current' && !state?.anchorId)) return;
    p.view = view;
    try {
      const page = framePage(p);
      if (page.location.pathname === new URL(OFFICIAL).pathname && (view !== 'current' || new URL(page.location.href).searchParams.get('anchorId') === state.anchorId)) page.location.hash = view === 'history' ? '/history' : '/';
      else loadPanel(view);
    } catch { loadPanel(view); }
    updatePanelControls();
  }

  function loadPanel(view) {
    const p = panel;
    if (!p || p.adapter?.busy) return;
    p.cleanup?.();
    p.adapter?.dispose();
    p.frame?.remove();
    p.adapter = null;
    const frame = p.frame = document.createElement('iframe');
    frame.title = '官方直播预言';
    // No top navigation permission: ordinary routes stay inside this frame.
    // Popups remain available for official login and explicitly chosen links.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const status = p.root.querySelector('.status');
    const retry = status.querySelector('button');
    status.hidden = false;
    retry.hidden = true;
    status.querySelector('span').textContent = '正在加载官方预言…';
    frame.style.visibility = 'hidden';
    p.view = view;
    let failed = false, ready = false;
    const stopLoading = () => { clearTimeout(p.timeout); p.timeout = null; };
    const fail = message => {
      if (panel !== p || p.frame !== frame || failed) return;
      failed = true;
      stopLoading();
      clearInterval(p.check);
      p.check = null;
      p.adapter?.dispose();
      p.adapter = null;
      frame.style.visibility = 'hidden';
      status.hidden = false;
      status.querySelector('span').textContent = message;
      retry.hidden = false;
      updatePanelControls();
    };
    const inspect = () => {
      if (panel !== p || p.frame !== frame || failed) return;
      if (roomId() !== state?.roomId) { syncRoute(); return; }
      try {
        const page = framePage(p);
        if (!page) return;
        if (page.location.href === 'about:blank') {
          if (ready) fail('官方预言页面已失效，请重试。');
          return;
        }
        if (page.location.origin !== new URL(OFFICIAL).origin || page.location.pathname !== new URL(OFFICIAL).pathname) {
          fail('官方页面离开了预言地址，请重试；登录验证可使用备用入口。'); return;
        }
        // A userscript membrane can expose different Document wrappers for the
        // same iframe. Compare primitive tokens across script worlds instead.
        if (!p.adapter || p.adapter.documentKey !== page.__biliProphecyDesktopAdapter__?.documentKey) {
          p.adapter?.dispose();
          ready = false;
          status.hidden = false;
          frame.style.visibility = 'hidden';
          stopLoading();
          p.timeout = setTimeout(() => fail('官方组件或桌面确认适配在 20 秒内未就绪，请重试。'), 20000);
          p.adapter = adaptOfficialDesktop(page);
          p.adapter.isCurrent = () => panel === p && roomId() === state?.roomId;
        }
        p.adapter?.setVisible(p.visible && !document.hidden);
        const content = page.document.querySelector('#main > *, .user-detail-content, .content[data-v-00192e7f]');
        if (p.adapter?.status === 'ready' && p.adapter.apiReady && content) {
          if (!ready) {
            ready = true;
            stopLoading();
            status.hidden = true;
            frame.style.visibility = '';
            // Frame-local Escape cancels a dialog first; otherwise closes only
            // the panel. The live room's player shortcuts are not intercepted.
            page.document.addEventListener('keydown', event => {
              if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); hidePanel(); }
            });
            // Prevent scroll chaining at the frame's document boundaries.
            const style = page.document.createElement('style');
            style.textContent = 'html,body{overscroll-behavior:contain} #bili-prophecy-workspace{display:none!important}';
            page.document.head.append(style);
          }
          p.view = page.location.hash === '#/history' ? 'history' : page.location.hash === '#/' || !page.location.hash ? 'current' : 'rules';
        }
        updatePanelControls();
        positionPanel();
      } catch { fail('无法访问官方组件，可能被浏览器、网络或嵌入策略阻止。请重试或手动使用备用入口。'); }
    };
    frame.addEventListener('load', inspect);
    frame.addEventListener('error', () => fail('官方预言加载失败，请检查网络后重试。'));
    p.cleanup = () => { stopLoading(); clearInterval(p.check); p.check = null; };
    p.timeout = setTimeout(() => fail('官方组件或桌面确认适配在 20 秒内未就绪，请重试。'), 20000);
    p.check = setInterval(inspect, 250);
    frame.src = officialUrl(view);
    p.root.querySelector('.body').prepend(frame);
    updatePanelControls();
  }

  function hidePanel({ focus = true } = {}) {
    if (!panel) return;
    panel.adapter?.setVisible(false); // Settles an unconfirmed dialog as cancel.
    panel.visible = false;
    if (panel.host.hasAttribute('popover')) panel.host.hidePopover?.();
    panel.host.hidden = true;
    renderEntry();
    if (focus) ui?.button.focus({ preventScroll: true });
  }

  function destroyPanel() {
    if (!panel) return;
    panel.cleanup?.();
    hidePanel({ focus: false });
    panel.adapter?.dispose();
    panel.host.remove();
    panel = null;
  }

  function stopRetry(target) {
    clearTimeout(target?.retryTimer);
    if (target) target.retryTimer = null;
  }

  async function lookup(target, automatic = false) {
    if (!target || target !== state || !active) return;
    stopRetry(target);
    target.controller?.abort();
    if (!automatic) target.autoRetries = 0;
    if (navigator.onLine === false) {
      target.status = 'error';
      target.error = '网络已断开，联网后将重新识别主播。';
      renderEntry();
      return;
    }
    const controller = new AbortController();
    target.controller = controller;
    target.status = 'loading';
    target.error = '';
    renderEntry();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let transient = false;
    try {
      const url = new URL('https://api.live.bilibili.com/room/v1/Room/room_init');
      url.searchParams.set('id', target.roomId);
      const response = await fetch(url.href, { method: 'GET', credentials: 'omit', signal: controller.signal });
      if (!response.ok) { transient = response.status >= 500 || response.status === 429; throw new Error('room lookup HTTP failure'); }
      const payload = await response.json();
      const uid = positiveId(payload?.data?.uid);
      if (payload?.code !== 0 || !uid) throw new Error('room lookup invalid response');
      if (!active || controller.signal.aborted || state !== target || target.controller !== controller || roomId() !== target.roomId) return;
      target.anchorId = uid;
      target.status = 'ready';
      rememberOwner(target.roomId, uid);
      renderEntry();
    } catch (error) {
      if (!active || state !== target || target.controller !== controller || roomId() !== target.roomId) return;
      target.status = 'error';
      target.error = navigator.onLine === false ? '网络已断开，联网后将重新识别主播。'
        : controller.signal.aborted ? '主播识别超时。' : '暂时无法识别主播。';
      renderEntry();
      if ((transient || error?.name === 'TypeError' || controller.signal.aborted) && target.autoRetries < 1 && navigator.onLine !== false && !document.hidden) {
        target.autoRetries++;
        target.retryTimer = setTimeout(() => {
          target.retryTimer = null;
          if (active && state === target && roomId() === target.roomId && !document.hidden) lookup(target, true);
        }, 1200);
      }
    } finally {
      clearTimeout(timeout);
      if (target.controller === controller) target.controller = null;
    }
  }

  function syncRoute() {
    const id = roomId();
    if (id === state?.roomId) { placeRoot(); return; }
    destroyPanel();
    stopRetry(state);
    state?.controller?.abort();
    themeObserver?.disconnect();
    themeObserver = null;
    state = id ? { roomId: id, anchorId: null, status: 'loading', error: '', controller: null, retryTimer: null, autoRetries: 0 } : null;
    if (!state) { ui?.restoreMount?.(); ui?.host.remove(); ui = null; return; }
    if (!ui) createUI();
    const uid = cachedOwner(id);
    if (uid) { state.anchorId = uid; state.status = 'ready'; renderEntry(); placeRoot(); }
    else lookup(state);
  }

  function suspend() {
    observer?.disconnect();
    observer = null;
    themeObserver?.disconnect();
    themeObserver = null;
    clearInterval(poll);
    poll = null;
    stopRetry(state);
  }

  function start() {
    active = true;
    if (!document.hidden && !observer) {
      observer = new MutationObserver(placeRoot);
      observer.observe(document, { childList: true, subtree: true });
    }
    syncRoute();
    if (state && state.status !== 'ready' && (!state.controller || state.controller.signal.aborted)) lookup(state);
    if (!document.hidden && poll === null) poll = setInterval(syncRoute, 1000);
  }

  window.addEventListener('popstate', syncRoute);
  window.navigation?.addEventListener('navigatesuccess', syncRoute);
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, true);
  window.visualViewport?.addEventListener('resize', positionPanel);
  window.visualViewport?.addEventListener('scroll', positionPanel);
  document.addEventListener('fullscreenchange', positionPanel);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && panel?.visible) hidePanel({ focus: false });
  });
  window.addEventListener('pageshow', start);
  window.addEventListener('online', () => { if (active && state?.status !== 'ready') lookup(state); });
  window.addEventListener('offline', () => {
    stopRetry(state);
    if (state?.status === 'loading') state.controller?.abort();
  });
  document.addEventListener('visibilitychange', () => {
    panel?.adapter?.setVisible(!document.hidden && panel.visible);
    if (document.hidden) suspend(); else start();
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncEntryTheme);
  window.addEventListener('pagehide', () => { active = false; suspend(); destroyPanel(); state?.controller?.abort(); });
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开直播预言', () => openPrediction());
    GM_registerMenuCommand('查看预言参与记录', () => openPrediction('history'));
  }
  start();
})();
