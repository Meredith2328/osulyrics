const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');
function fixture() {
  let now = 0, interval = null;
  const frames = [], events = [];
  const ctx = { appWindow: {isDestroyed:()=>false,setIgnoreMouseEvents:v=>events.push(['ignore',v]),hide:()=>events.push(['hide'])},
    panelProgress:0,panelOpen:false,panelSide:'above',lyricBounds:{x:100,y:600,width:700,height:80},overlaySettings:{},panelSize:{},animationTimer:null,
    overlayShown:true,dragSession:{},resizeSession:{},LYRICS_HOTKEY:'test',hotkeyRegistered:true,
    screen:{getDisplayMatching:()=>({workArea:{}})},choosePanelSide:()=> 'above',fitLyricForPanel:b=>b,
    Date:{now:()=>now},setInterval:fn=>{interval=fn;return 1},clearInterval:()=>{interval=null},
    send:(...args)=>events.push(args),scheduleSave:()=>{},updateTrayMenu:()=>{},presentLayout:()=>({iconOnly:false}),applyLayout:()=>frames.push(ctx.panelProgress)};
  const fn = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ',source.indexOf(`function ${name}(`)+1));
  vm.createContext(ctx);
  vm.runInContext(fn('finishAnimation')+fn('setPanelOpen')+fn('setOverlayShown'),ctx);
  return {ctx,frames,events,at(ms){now=ms;if(interval)interval();},running:()=>!!interval};
}
test('actual main UI transition is linear at 83ms and reverses without a queue',()=>{
  const f=fixture();f.ctx.setPanelOpen(true);f.at(83);
  assert.equal(f.ctx.panelProgress,83/167);
  const opacity=f.ctx.panelProgress;f.ctx.setPanelOpen(false);
  assert.equal(f.ctx.panelProgress,opacity);
  f.at(124);assert.ok(Math.abs(f.ctx.panelProgress-42/167)<1e-12);
  f.at(167);assert.equal(f.ctx.panelProgress,0);assert.equal(f.running(),false);
});
test('repeated open-close-open uses current opacity and completes within 167ms',()=>{
  const f=fixture();f.ctx.setPanelOpen(true);f.at(40);f.ctx.setPanelOpen(false);f.at(60);
  const from=f.ctx.panelProgress;f.ctx.setPanelOpen(true);assert.equal(f.ctx.panelProgress,from);
  f.at(227);assert.equal(f.ctx.panelProgress,1);assert.equal(f.running(),false);
});
test('hiding interrupts animation and removes host hit testing before hiding',()=>{
  const f=fixture();f.ctx.setPanelOpen(true);f.at(83);f.ctx.setOverlayShown(false);
  assert.equal(f.running(),false);assert.equal(f.ctx.overlayShown,false);
  assert.deepEqual(f.events.filter(x=>['ignore','hide'].includes(x[0])),[['ignore',true],['hide']]);
  assert.equal(f.ctx.dragSession,null);assert.equal(f.ctx.resizeSession,null);
});
