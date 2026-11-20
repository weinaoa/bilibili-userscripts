// Sample actual layout across several 250ms readiness polls. Integer-sized
// fixtures alone miss subpixel feedback that also resizes the iframe viewport.
module.exports = async function measurePanelStability(page, duration = 1500) {
  return page.evaluate(async duration => {
    const host = document.getElementById('bili-prophecy-panel'), root = host.shadowRoot;
    const iframe = root.querySelector('iframe'), doc = iframe.contentDocument;
    const nodes = { host, iframe, footer: root.querySelector('footer'), balance: doc.querySelector('.user-game-footer') };
    const read = () => Object.fromEntries(Object.entries(nodes).filter(([, node]) => node).map(([key, node]) => {
      const r = node.getBoundingClientRect();
      return [key, [r.x, r.y, r.width, r.height]];
    }).concat([['viewport', [iframe.contentWindow.innerWidth, iframe.contentWindow.innerHeight]]]));
    const initial = read(), min = structuredClone(initial), max = structuredClone(initial);
    let mutations = 0, samples = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(host, { attributes: true });
    observer.observe(root, { attributes: true, childList: true, subtree: true });
    try {
      const until = performance.now() + duration;
      while (performance.now() < until) {
        await new Promise(requestAnimationFrame);
        const current = read();
        for (const key of Object.keys(current)) for (let i = 0; i < current[key].length; i++) {
          min[key][i] = Math.min(min[key][i], current[key][i]);
          max[key][i] = Math.max(max[key][i], current[key][i]);
        }
        samples++;
      }
      return { samples, mutations, maxDelta: Object.fromEntries(Object.keys(min).map(key => [key, Math.max(...min[key].map((value, i) => max[key][i] - value))])) };
    } finally { observer.disconnect(); }
  }, duration);
};
