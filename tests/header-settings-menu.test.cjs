const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const main = read('main.cjs');
function fixture() {
  const menus = [], handlers = {}, calls = [];
  const ctx = {
    overlayShown: true, overlayLocked: false, panelOpen: true, exitRequested: false,
    appWindow: { webContents: {}, isDestroyed: () => false, getBounds: () => ({width: 640, height: 480}) },
    tray: { setContextMenu: menu => { ctx.trayMenu = menu; } },
    Menu: { buildFromTemplate: items => {
      const menu = {items, popup: options => calls.push(options)}; menus.push(menu); return menu;
    } },
    setOverlayShown: value => { ctx.overlayShown = value; ctx.updateTrayMenu(); },
    setOverlayLock: value => { ctx.overlayLocked = value; ctx.updateTrayMenu(); },
    showControl: () => calls.push('show'), app: {quit: () => calls.push('quit')},
    ipcMain: {handle: (name, callback) => { handlers[name] = callback; }},
  };
  const start = main.indexOf('function buildSettingsMenu(');
  const end = main.indexOf('\nfunction setOverlayShown(', start);
  assert.ok(start >= 0 && end > start);
  const handler = main.match(/ipcMain\.handle\('settings-menu',[\s\S]*?\n\}\);/);
  assert.ok(handler);
  vm.createContext(ctx); vm.runInContext(main.slice(start, end) + handler[0], ctx);
  return {ctx, menus, calls, popup: position => handlers['settings-menu']({sender:ctx.appWindow.webContents}, position), handlers};
}
test('header and tray menus share current visibility, lock and existing actions', () => {
  const f = fixture(); f.ctx.updateTrayMenu(); f.popup({x:12, y:44});
  assert.deepEqual(f.menus[0].items.map(i => i.label || i.type), f.menus[1].items.map(i => i.label || i.type));
  assert.equal(f.menus[1].items[0].label, '完全隐藏 osu!lyrics');
  f.menus[1].items[0].click(); assert.equal(f.ctx.overlayShown, false);
  assert.equal(f.ctx.trayMenu.items[0].label, '显示osu!lyrics');
  f.ctx.trayMenu.items[0].click(); assert.equal(f.ctx.overlayShown, true);
  f.ctx.trayMenu.items[2].click(); assert.equal(f.ctx.overlayLocked, true);
  f.popup({x:12, y:44}); assert.equal(f.menus.at(-1).items[2].label, '解锁位置');
  f.menus.at(-1).items[1].click(); assert.equal(f.calls.at(-1), 'show');
  f.menus.at(-1).items[4].click(); assert.equal(f.ctx.exitRequested, true); assert.equal(f.calls.at(-1), 'quit');
});
test('menu opens in the sender window at the scaled button anchor and clamps edges', () => {
  const f = fixture(); assert.equal(f.popup({x:23.6, y:88.2}), true);
  assert.equal(f.calls[0].window, f.ctx.appWindow); assert.equal(f.calls[0].x, 24); assert.equal(f.calls[0].y, 88);
  f.popup({x:-200, y:900}); assert.equal(f.calls[1].x, 0); assert.equal(f.calls[1].y, 479);
});
test('foreign senders, invalid anchors and unavailable panels never open a menu', () => {
  const f = fixture(), handler = f.handlers['settings-menu'];
  assert.equal(handler({sender:{}}, {x:10,y:20}), false);
  for (const position of [null, {}, {x:NaN,y:20}, {x:10,y:Infinity}, {x:'10',y:20}]) assert.equal(f.popup(position), false);
  f.ctx.panelOpen = false; assert.equal(f.popup({x:10,y:20}), false);
  f.ctx.panelOpen = true; f.ctx.overlayShown = false; assert.equal(f.popup({x:10,y:20}), false);
  f.ctx.overlayShown = true; f.ctx.appWindow.isDestroyed = () => true; assert.equal(f.popup({x:10,y:20}), false);
  f.ctx.appWindow = null; assert.equal(handler({sender:{}}, {x:10,y:20}), false);
  assert.equal(f.calls.length, 0); assert.equal(f.menus.length, 0);
});
test('settings activation releases gestures and uses the button rect for pointer or keyboard clicks', () => {
  const renderer = read('ui/combined.js'), handlers = {}, calls = [];
  const button = {addEventListener:(name, callback)=>handlers[name]=callback, getBoundingClientRect:()=>({left:24.5,bottom:91.5})};
  const ctx = {$:id=>{assert.equal(id,'settingsButton');return button;},cancelGestures:()=>calls.push('cancel'),api:{settingsMenu:p=>calls.push({x:p.x,y:p.y})}};
  const binding = renderer.match(/\$\('settingsButton'\)\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(binding); vm.runInNewContext(binding[0], ctx); handlers.click();
  assert.deepEqual(calls, ['cancel',{x:24.5,y:91.5}]);
  assert.match(renderer, /bindIconDrag\('brandToggle', false\)/);
  assert.match(renderer, /event\.target\.closest\('button'\)/);
  assert.doesNotMatch(renderer, /visibilityButton/);
});
test('header places keyboard-accessible settings first and collapse last with no hide button', () => {
  const html = read('ui/combined.html'), header = html.match(/<header[^>]*>[\s\S]*?<\/header>/)[0];
  const buttons = [...header.matchAll(/<button[^>]*id="([^"]+)"[^>]*>/g)];
  assert.equal(buttons[0][1], 'settingsButton'); assert.equal(buttons.at(-1)[1], 'brandToggle');
  assert.match(buttons[0][0], /type="button"/); assert.match(buttons[0][0], /aria-label="设置"/); assert.match(buttons[0][0], /aria-haspopup="menu"/);
  assert.match(buttons.at(-1)[0], /aria-label="收起 osu!lyrics"/); assert.doesNotMatch(header, /visibilityButton|完全隐藏/);
});
test('preload forwards only the settings menu anchor through its dedicated IPC', async () => {
  let api; const calls = [], position = {x:20,y:80};
  vm.runInNewContext(read('preload.cjs'), {require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve(true);}}};}});
  assert.equal(await api.settingsMenu(position), true); assert.deepEqual(calls, [['settings-menu',position]]);
});
