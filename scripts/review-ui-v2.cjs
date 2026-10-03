// Browser-only review of production HTML/CSS/renderer with an in-memory API double.
// Never loads Electron, preload, IPC, a game, user settings, or real lyric services.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { animatedLayout } = require('../src/combined-layout.cjs');
const { DEFAULT_OVERLAY_SETTINGS } = require('../src/overlay-settings.cjs');
const http = require('node:http');
const out = path.resolve(process.argv[2] || '/workspace/ui-v2-evidence');
fs.mkdirSync(out, { recursive: true });
const checks = [];
const geometrySnapshots = [];
const record = (name, value = true) => { assert.ok(value, name); checks.push(name); };
const layout = (width=560,height=420,progress=1,side='above') => {
  const value=animatedLayout({x:32,y:470,width:700,height:100},DEFAULT_OVERLAY_SETTINGS,side,progress,null,{width,height});
  // Keep screenshots at a fixed local origin; real host coordinates are tested in Node.
  value.panel.x+=32;value.panel.y+=24;value.lyric.x+=32;value.lyric.y+=24;
  value.animation.dot={x:value.lyric.x+12,y:value.lyric.y};return value;
};
const initial={state:{connected:true,playing:false,state:'selectplay',positionMs:84000,sampledAt:Date.now(),rate:1,song:{key:'a',recordingKey:'record-a',title:'とても長い曲名 / The Night Walk Original Recording · Extended Version',artist:'架空アーティスト / Placeholder ensemble',durationMs:211000}},
  lyrics:{status:'ready',lines:[{time:0,original:'夜の向こうへ、ゆっくり歩こう。\n遠くの灯りまで、この歌を忘れずに。',translation:'越过夜色，慢慢向前走。直到远处的灯光，\n也一直记住这首歌，让未说完的话留在风里。'}],candidates:[],offsetMs:0,source:'LRCLIB',translationSource:'歌词自带'},
  tosu:{status:'connected',installed:true},overlay:{locked:false,shown:true,settings:{...DEFAULT_OVERLAY_SETTINGS,alignment:'left'}},panel:{open:true,side:'above'},layout:layout()};
(async()=>{
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'};
 fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(body);});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:800,height:650},deviceScaleFactor:1,bypassCSP:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(initial=>{
  const callbacks={},calls=[];let currentLayout=initial.layout,settings=initial.overlay.settings;window.review={callbacks,calls,initial,getLayout:()=>structuredClone(currentLayout)};
  const api={initial:async()=>initial};
  for(const name of ['State','Lyrics','Tosu','OverlaySettings','OverlayPresence','PanelState','Layout'])api['on'+name]=cb=>callbacks[name]=value=>{if(name==='Layout')currentLayout=value;if(name==='OverlaySettings')settings=value.settings;cb(value);};
  for(const name of ['installTosu','startTosu','searchLyrics','refreshLyrics','refreshTranslation','chooseLyrics','offset','editLyrics','importLyrics','windowAction','panelToggle','overlayLock','overlayShow','updateOverlaySettings','overlayVisibility','overlayContentHeight','overlayDragStart','overlayDragMove','overlayDragEnd','overlayResizeStart','overlayResizeMove','overlayResizeEnd'])api[name]=async(...args)=>{calls.push({name,args});return true;};
  api.overlayContentHeight=async measured=>{
   calls.push({name:'overlayContentHeight',args:[measured]});
   const height=Math.max(Math.round((settings.showTranslation?80:48)*settings.scale/100),Math.min(240,Math.ceil(measured)));
   if(height!==currentLayout.lyric.height){currentLayout={...currentLayout,lyric:{...currentLayout.lyric,height}};callbacks.Layout(currentLayout);}
  };
  window.osuLyrics=api;
 },initial);
 await page.goto(`http://127.0.0.1:${server.address().port}/src/ui/combined.html`);
 await page.waitForFunction(()=>document.querySelector('#sourceLabel').textContent==='歌词已就绪');
 await page.evaluate(()=>document.fonts.ready);
 await page.addStyleTag({content:'body { background: #17151f; }'});
 const emit=async(name,value)=>{
  if(name==='Layout') {
   // Like the real host's lyricBounds, retain renderer height feedback across
   // panel size/opacity changes. A fresh fixture must not reset it to 100px.
   const current=await page.evaluate(()=>review.getLayout());
   value={...value,lyric:{...value.lyric,height:current.lyric.height}};
  }
  return page.evaluate(({name,value})=>window.review.callbacks[name](value),{name,value});
 };
 const snap=async name=>{
  await page.mouse.move(790,640);await page.waitForTimeout(100);
  const geometry=await page.evaluate(()=>{
   const box=document.querySelector('#lyricBox');
   if(box.hidden)return {visible:false,contained:true};
   const bounds=box.getBoundingClientRect();
   const lines=['original','translation'].map(id=>document.getElementById(id)).filter(e=>!e.hidden).map(e=>({id:e.id,...e.getBoundingClientRect().toJSON()}));
   return {visible:true,box:bounds.toJSON(),lines,contained:lines.every(r=>r.left>=bounds.left&&r.right<=bounds.right+1&&r.top>=bounds.top&&r.bottom<=bounds.bottom+1)};
  });
  record(`snapshot ${name}: lyric content fits its surface`,geometry.contained);
  geometrySnapshots.push({name,...geometry});
  await page.screenshot({path:path.join(out,name+'.png')});
 };
 const box=async id=>page.locator('#'+id).boundingBox();
 const fit=async name=>{
  const issues=await page.evaluate(()=>{
   const panel=document.querySelector('#panelSurface').getBoundingClientRect();
   return [...document.querySelectorAll('#panelSurface button,#panelSurface input,#panelSurface select,#panelSurface h1,.setting-row')].filter(e=>e.getClientRects().length).flatMap(e=>{const r=e.getBoundingClientRect();return r.left<panel.left-1||r.right>panel.right+1||r.top<panel.top-1||r.bottom>panel.bottom+1?[e.id||e.className]:[];});
  });record(name+' controls fit panel',issues.length===0);
 };
 await snap('01-main-560');await fit('560 main');
 record('wrapped lyric measurement requests enough room',await page.evaluate(()=>review.calls.some(x=>x.name==='overlayContentHeight'&&x.args[0]>100)));
 record('complete translation disables refresh',await page.locator('#refreshTranslationButton').isDisabled());
 record('orb visual32 target44',await page.evaluate(()=>document.querySelector('#collapsedToggle').offsetWidth===44&&document.querySelector('#collapsedToggle span').offsetWidth===32));
 record('lyric text usable width620',await page.evaluate(()=>{const e=document.querySelector('#lyricBox'),s=getComputedStyle(e);return e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)===620;}));
 const lyricRect=await box('lyricBox'),originalRect=await box('original'),orbRect=await box('collapsedToggle'),panelRect=await box('panelClip');
 await emit('PanelState',{open:false,side:'above'});
 for(const [name,progress] of [['02-motion-83ms',83/167],['03-collapsed',0]]) {
  await emit('Layout',layout(560,420,progress));await snap(name);
  assert.deepEqual(await box('lyricBox'),lyricRect);
  assert.deepEqual(await box('original'),originalRect);assert.deepEqual(await box('collapsedToggle'),orbRect);
  if(progress>0)assert.deepEqual(await box('panelClip'),panelRect);
 }
 record('collapse and midfade preserve complete lyric surface and orb bounds');
 record('collapsed panel absent from focus/hit tree',await page.locator('#panelClip').evaluate(e=>e.hidden&&e.inert));
 await page.locator('#collapsedToggle').click();
 record('orb opens current closed intent',await page.evaluate(()=>review.calls.filter(x=>x.name==='panelToggle').at(-1).args[0]===true));
 await emit('Lyrics',{...initial.lyrics,status:'loading',lines:[]});await snap('04-orb-only');
 assert.deepEqual(await box('collapsedToggle'),orbRect);record('empty lyric leaves orb anchored');
 await emit('Lyrics',initial.lyrics);await emit('PanelState',{open:true,side:'above'});await emit('Layout',layout());
 await page.locator('#collapsedToggle').click();record('orb closes current open intent',await page.evaluate(()=>review.calls.filter(x=>x.name==='panelToggle').at(-1).args[0]===false));
 await page.locator('#styleButton').click();record('single header navigation slot',await page.locator('#styleButton').isHidden()&&await page.locator('#backButton').isVisible());
 await snap('05-settings-basic');await fit('560 basic');
 for(const tab of ['colors','typography']){await page.locator('#'+tab+'Tab').click();await snap('06-settings-'+tab);await fit('560 '+tab);}
 for(const [width,height] of [[500,370],[720,420],[1200,600]]){
  await page.setViewportSize({width:Math.max(800,width+64),height:height+220});await emit('Layout',layout(width,height));
  for(const tab of ['basic','colors','typography']){await page.locator('#'+tab+'Tab').click();await fit(width+' '+tab);if(width===500)await snap('07-compact-'+tab);}
 }
 await page.setViewportSize({width:800,height:650});await emit('Layout',layout(500,370));
 await emit('OverlaySettings',{locked:false,settings:{...initial.overlay.settings,...require('../src/appearance-presets.js').presetPatch('clear')}});
 await page.locator('#basicTab').click();await snap('08-compact-clear');
 record('plain background controls explained/disabled',await page.locator('#opacityRange').isDisabled()&&await page.locator('#opacityHint').isVisible());
 await page.locator('[data-preset="focus"]').click();
 record('preset patch excludes scale width and translation',await page.evaluate(()=>{const p=review.calls.filter(x=>x.name==='updateOverlaySettings').at(-1).args[0];return !('scale'in p)&&!('width'in p)&&!('showTranslation'in p);}));
 await emit('OverlaySettings',{locked:false,settings:initial.overlay.settings});
 await page.locator('#backButton').click();
 await page.locator('#searchButton').click();await snap('09-search');
 await page.locator('#searchInput').fill('YOASOBI アイドル & live');await page.locator('#searchInput').press('Enter');
 record('Unicode search forwards unchanged text',await page.evaluate(()=>review.calls.filter(x=>x.name==='searchLyrics').at(-1).args[0]==='YOASOBI アイドル & live'));
 const candidates=Array.from({length:9},(_,i)=>({id:i+1,title:'Night Walk '+(i+1),artist:'Placeholder ensemble',language:i%2?'en':'ja',duration:211+i}));
 await emit('Lyrics',{...initial.lyrics,candidates,status:'choose'});await snap('10-candidates');await fit('500 candidates');
 record('four candidates first page',await page.locator('.candidate').count()===4&&await page.locator('#previousPage').isDisabled());
 await page.locator('#nextPage').click();record('four candidates second page',await page.locator('.candidate').count()===4);
 await page.locator('#nextPage').click();record('last page boundary',await page.locator('.candidate').count()===1&&await page.locator('#nextPage').isDisabled());
 await page.locator('.candidate').click();record('candidate id forwarded',await page.evaluate(()=>review.calls.filter(x=>x.name==='chooseLyrics').at(-1).args[0]===9));
 await page.locator('#importButton').click();await page.locator('#editButton').click();await page.locator('#offsetBack').click();await page.locator('#offsetForward').click();
 record('import edit and ±500 retained',await page.evaluate(()=>review.calls.some(x=>x.name==='importLyrics')&&review.calls.some(x=>x.name==='editLyrics')&&JSON.stringify(review.calls.filter(x=>x.name==='offset').map(x=>x.args[0]))==='[-500,500]'));
 const drag=async(selector,dx,dy)=>{const r=await page.locator(selector).boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(20);await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy);await page.mouse.up();};
 const togglesBefore=await page.evaluate(()=>review.calls.filter(x=>x.name==='panelToggle').length);
 await drag('#collapsedToggle',20,12);
 record('orb drag forwards movement without toggling',await page.evaluate(before=>review.calls.some(x=>x.name==='overlayDragMove')&&review.calls.filter(x=>x.name==='panelToggle').length===before,togglesBefore));
 await drag('#panelResizeHandles .right',20,0);
 record('panel resize retains handle and release',await page.evaluate(()=>review.calls.some(x=>x.name==='overlayResizeStart'&&x.args[0].handle==='right')&&review.calls.some(x=>x.name==='overlayResizeEnd')));
 await emit('Lyrics',{...initial.lyrics,status:'error',lines:[],candidates:[],message:'歌词搜索失败：服务返回错误'});await snap('11-recovery');
 record('generic failure prioritizes existing refresh',await page.locator('#normalView').getAttribute('data-recovery')==='retry');
 await emit('Lyrics',{...initial.lyrics,status:'choose',lines:[],candidates:[]});record('no match prioritizes search',await page.locator('#normalView').getAttribute('data-recovery')==='search');
 await emit('Lyrics',{...initial.lyrics,status:'searching'});record('research preserves current valid lyric',await page.locator('#original').textContent()===initial.lyrics.lines[0].original&&await page.locator('#refreshLyricsButton').isDisabled());
 await emit('OverlaySettings',{locked:true,settings:initial.overlay.settings});record('locked style unavailable but orb reachable',await page.locator('#styleButton').isDisabled()&&await page.locator('#collapsedToggle').isEnabled());
 const dragStarts=await page.evaluate(()=>review.calls.filter(x=>x.name==='overlayDragStart').length);
 await drag('#collapsedToggle',20,12);
 record('locked orb cannot start dragging',await page.evaluate(before=>review.calls.filter(x=>x.name==='overlayDragStart').length===before,dragStarts));
 await emit('State',{...initial.state,song:{...initial.state.song,recordingKey:'record-b'}});record('record change clears old lyric before lyric callback',await page.locator('#lyricBox').isHidden());
 await emit('State',{...initial.state,connected:false,song:null,playing:false});await emit('Tosu',{status:'disconnected',installed:false});await snap('12-tosu');
 record('tosu install preserved and song actions disabled',await page.locator('#setupButton').isEnabled()&&await page.locator('#offsetBack').isDisabled());
 await emit('State',initial.state);await emit('Tosu',initial.tosu);await emit('Lyrics',initial.lyrics);await emit('OverlaySettings',{locked:false,settings:initial.overlay.settings});
 await page.emulateMedia({reducedMotion:'reduce'});await emit('Layout',layout(500,370,.1));
 record('reduced motion opens directly at full opacity',await page.locator('#panelClip').evaluate(e=>getComputedStyle(e).opacity==='1'));
 await emit('PanelState',{open:false,side:'above'});record('reduced motion closes immediately',await page.locator('#panelClip').isHidden());
 await emit('PanelState',{open:true,side:'above'});await page.emulateMedia({reducedMotion:'no-preference'});await emit('Layout',layout(500,370,1));
 await page.locator('#visibilityButton').click();record('hide removes all renderer hits immediately',await page.evaluate(()=>document.body.hidden&&document.body.inert));
 await emit('OverlayPresence',{shown:true});record('show restores renderer',await page.locator('#collapsedToggle').isVisible());
 // Material stress evidence intentionally retains low-contrast settings, with no automatic theme mutation.
 for(const [name,bg] of [['dark','#17151f'],['light','#f4f0e7'],['busy','repeating-conic-gradient(#29324d 0 25%,#f4f0e7 0 50%) 0 / 24px 24px']]) {
  await page.addStyleTag({content:`body { background: ${bg}; }`});await emit('PanelState',{open:false,side:'above'});await emit('Layout',layout(500,370,0));
  for(const preset of ['clear','sakura','focus']){await emit('OverlaySettings',{locked:false,settings:{...initial.overlay.settings,...require('../src/appearance-presets.js').presetPatch(preset)}});await snap(`13-material-${name}-${preset}`);}
 }
 record('no renderer exceptions',errors.length===0);
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({scope:'Headless Chromium production renderer with API double; no Electron/IPC/Windows execution',checks,errors,geometrySnapshots},null,2));
 console.log(JSON.stringify({passed:checks.length,errors,out},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
