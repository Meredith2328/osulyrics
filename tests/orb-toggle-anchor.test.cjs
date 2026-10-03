const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const layout = require('../src/combined-layout.cjs');
const source = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');
function fixture(lyric, area, locked = false, interactive = false) {
  let interval, now = 0;
  const ctx = {
    appWindow: {}, animationTimer: null, panelProgress: 0, panelOpen: false,
    panelSide: 'above', overlayInteractive: interactive, overlayLocked: locked,
    lyricBounds: {...lyric}, overlaySettings: {scale:83,width:700}, panelSize: {width:593,height:439},
    screen: {getDisplayMatching:()=>({workArea:area})},
    ...layout, Date:{now:()=>now},
    setInterval: fn => {interval=fn;return 1;}, clearInterval:()=>{interval=null;},
    send:()=>{},scheduleSave:()=>{},applyLayout:()=>ctx.presentLayout(),
  };
  const fn = name => {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\nfunction ',start+1);
    assert.ok(start>=0 && end>start); return source.slice(start,end);
  };
  vm.createContext(ctx);vm.runInContext(fn('presentLayout')+fn('finishAnimation')+fn('setPanelOpen'),ctx);
  return {ctx, frame(ms){now+=ms;if(interval)interval();return ctx.presentLayout();},center(){const l=ctx.presentLayout();return {x:l.window.x+l.lyric.x+34,y:l.window.y+l.lyric.y+22};}};
}
test('opening a compact orb clamped at the saved left edge keeps its visible center', () => {
  const f=fixture({x:-53,y:665,width:581,height:66},{x:0,y:0,width:1920,height:1020});
  const before=f.center();assert.deepEqual(before,{x:28,y:687});
  f.ctx.setPanelOpen(true);assert.deepEqual(f.center(),before);
  f.frame(83);assert.deepEqual(f.center(),before);f.frame(84);assert.deepEqual(f.center(),before);
  f.ctx.setPanelOpen(false);f.frame(167);assert.deepEqual(f.center(),before);
});
test('screen edges and negative monitor origins retain orb centers across 100 round trips', () => {
  for(const area of [{x:0,y:0,width:1920,height:1020},{x:-1920,y:-120,width:1920,height:1080}]) {
    for(const x of [area.x-53,area.x+120,area.x+area.width-30])for(const y of [area.y+30,area.y+665])for(const locked of [false,true]) {
      const f=fixture({x,y,width:581,height:66},area,locked),before=f.center();
      for(let i=0;i<100;i++) {
        f.ctx.setPanelOpen(true);assert.deepEqual(f.center(),before);f.frame(167);assert.deepEqual(f.center(),before);
        f.ctx.setPanelOpen(false);f.frame(83);assert.deepEqual(f.center(),before);f.frame(84);assert.deepEqual(f.center(),before);
      }
      assert.equal(f.ctx.overlayLocked,locked);
    }
  }
});
test('DIP screen anchors remain identical at common DPI scales and mid-animation reversal', () => {
  const f=fixture({x:-53,y:665,width:581,height:66},{x:0,y:0,width:1920,height:1020}),before=f.center();
  const physical = (center, scale) => ({x:Math.round(center.x*scale),y:Math.round(center.y*scale)});
  for(const scale of [1,1.25,1.5,1.75,2,2.5,3]) {
    f.ctx.setPanelOpen(true);f.frame(50);f.ctx.setPanelOpen(false);f.frame(20);f.ctx.setPanelOpen(true);f.frame(167);
    assert.deepEqual(physical(f.center(),scale),physical(before,scale));
    f.ctx.setPanelOpen(false);f.frame(167);assert.deepEqual(physical(f.center(),scale),physical(before,scale));
  }
});
test('visible lyric positions keep their existing anchor when no compact clamp is involved', () => {
  const lyric={x:120,y:665,width:581,height:66},f=fixture(lyric,{x:0,y:0,width:1920,height:1020},false,true),before=f.center();
  f.ctx.setPanelOpen(true);f.frame(167);assert.deepEqual(f.center(),before);
  f.ctx.setPanelOpen(false);f.frame(167);assert.deepEqual(f.center(),before);
  assert.deepEqual({...f.ctx.lyricBounds},lyric);
});
