const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const project=process.env.OSU_CLOCK_REVIEW_ROOT||path.resolve(__dirname,'..');
const {ClockSync}=require(path.join(project,'src/clock-sync.cjs'));
const {normalizeTosu,advancePosition}=require(path.join(project,'src/osu.cjs'));
const {fileId}=require(path.join(project,'src/lyrics-service.cjs'));
const source=fs.readFileSync(path.join(project,'src/main.cjs'),'utf8');
const poll=source.slice(source.indexOf('async function pollTosu() {'),source.indexOf('\nfunction createWindow()',source.indexOf('async function pollTosu() {')));
assert.ok(poll.startsWith('async function pollTosu() {')&&!poll.includes('BrowserWindow'));
const data=(pos,{record='a.mp3',rate=1,paused=false,state='play'}={})=>({state:{name:state},game:{paused},folders:{beatmap:'same-set'},files:{audio:record},beatmap:{id:1,set:2,checksum:'same-checksum',title:'Same Song',artist:'Same Artist',version:'Hard',time:{live:pos,mp3Length:120000}},play:{mods:{rate}}});
function harness(){
 const clock={now:0},samples=[],timers=[],queue=[];
 const sandbox={Date:{now:()=>clock.now},AbortSignal:{timeout:()=>({})},TOSU_ENDPOINT:'FAKE-NO-NETWORK',normalizeTosu,fileId,clockSync:new ClockSync(),current:{connected:false,playing:false},tosuStatus:'connected',startedAt:0,launchAttempted:true,stopping:false,pollTimer:null,send:(type,state)=>{if(type==='state')samples.push(structuredClone(state));},lyrics:{setSong:async()=>{}},setTimeout:(_cb,delay)=>{timers.push(delay);return 1},findTosu:()=>null,tosuFolder:()=>'',startTosu:()=>{throw Error('No real process permitted')},fetch:async()=>{const x=queue.shift();clock.now=x.at;if(x.reject)throw Error('synthetic transport error');return{ok:!x.status,status:x.status||200,json:async()=>{if(x.deferredJson)await x.deferredJson;clock.now+=x.decode||0;return structuredClone(x.data)}}}};
 vm.createContext(sandbox);vm.runInContext(poll+';globalThis.run=pollTosu',sandbox);
 return {clock,samples,timers,sandbox,step:async x=>{queue.push(x);await sandbox.run();return structuredClone(sandbox.current)}};
}
test('actual poll resets clock when recording changes despite same title and checksum',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,data:data(10040)});
 const next=await h.step({at:1200,data:data(10150,{record:'b.mp3'})});
 assert.equal(next.positionMs,10150);assert.notEqual(h.samples[0].song.recordingKey,next.song.recordingKey);
});
test('actual poll holds pause and resets resume, large seeks, retry and rate',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,data:data(10040)});
 let n=await h.step({at:1200,data:data(10040,{paused:true})});assert.equal(n.positionMs,10040);assert.equal(advancePosition(n,1600),10040);
 n=await h.step({at:1800,data:data(10100)});assert.equal(n.positionMs,10100);
 n=await h.step({at:1900,data:data(30000)});assert.equal(n.positionMs,30000);
 n=await h.step({at:2000,data:data(5000)});assert.equal(n.positionMs,5000);
 n=await h.step({at:2100,data:data(0)});assert.equal(n.positionMs,0);
 n=await h.step({at:2200,data:data(200,{rate:1.5})});assert.equal(n.positionMs,200);assert.equal(advancePosition(n,2300),350);
});
test('bounded variable latency never introduces multi-second or accumulating error',async()=>{
 for(const rate of [1,1.5,2]){
  const h=harness();for(let i=0;i<80;i++){
   const at=1000+i*100,lag=[0,120,40,150,60,80][i%6],truth=10000+rate*(at-1000);
   const n=await h.step({at,data:data(truth-rate*lag,{rate})});
   assert.ok(n.positionMs<=truth+1e-8);assert.ok(truth-n.positionMs<=rate*150+1e-8);
  }
 }
});
test('HTTP JSON delay is counted once; renderer extrapolation remains capped',async()=>{
 const h=harness();let n=await h.step({at:1000,decode:80,data:data(10000)});
 assert.equal(n.sampledAt,1000);assert.equal(n.positionMs,10000);assert.equal(advancePosition(n,h.clock.now),10080);
 n=await h.step({at:1180,decode:600,data:data(10180)});assert.equal(advancePosition(n,h.clock.now),10360);
 assert.deepEqual(h.timers,[100,100]);
});
test('missing state or live field does not create NaN or a persistent large clock error',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});
 let partial=data(10100);delete partial.state;let n=await h.step({at:1100,data:partial});assert.equal(n.playing,false);assert.equal(n.positionMs,10100);
 partial=data(10200);delete partial.beatmap.time.live;n=await h.step({at:1200,data:partial});assert.equal(n.positionMs,0);
 n=await h.step({at:1300,data:data(10300)});assert.equal(n.positionMs,10300);assert.ok(Number.isFinite(n.positionMs));
});
test('missing recording path restores actual identity without carrying a previous envelope',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,data:data(10040)});
 const partial=data(10150);delete partial.files;const gap=await h.step({at:1200,data:partial});assert.equal(gap.positionMs,10150);
 const n=await h.step({at:1300,data:data(10200)});assert.equal(n.positionMs,10200);assert.notEqual(gap.song.recordingKey,n.song.recordingKey);
});
for(const failure of ['HTTP500','transport'])test('known '+failure+' disconnect discards pre-disconnect envelope before same-key reconnect',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,data:data(10040)});
 const off=await h.step({at:1200,status:failure==='HTTP500'?500:undefined,reject:failure==='transport'});assert.equal(off.connected,false);assert.equal(off.playing,false);
 // While disconnected, actual audio paused for 150 ms and resumed. Same file/state/rate.
 const n=await h.step({at:1800,data:data(10650)});assert.equal(n.positionMs,10650,'stale pre-disconnect envelope must not override fresh 10650 after unknown continuity');
});
test('repeated disconnects followed by paused/rate-changed recovery do not resurrect stale time',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,data:data(10040)});
 await h.step({at:1200,status:500});await h.step({at:1300,status:500});await h.step({at:1400,reject:true});
 let n=await h.step({at:1800,data:data(10650,{paused:true})});assert.equal(n.positionMs,10650);assert.equal(advancePosition(n,2300),10650);
 n=await h.step({at:2400,data:data(10700,{rate:1.5})});assert.equal(n.positionMs,10700);assert.equal(advancePosition(n,2500),10850);
 n=await h.step({at:2600,data:data(50000,{rate:1.5})});assert.equal(n.positionMs,50000);
});
test('failure before first connection recovers without a false starting envelope',async()=>{
 const h=harness();await h.step({at:1000,reject:true});await h.step({at:1100,status:500});
 const n=await h.step({at:1200,data:data(500)});assert.equal(n.connected,true);assert.equal(n.positionMs,500);
});
test('normal poll scheduling waits for JSON completion and cannot overlap responses',async()=>{
 const h=harness();let resolve;const deferredJson=new Promise(r=>resolve=r);
 const pending=h.step({at:1000,data:data(10000),deferredJson});await new Promise(r=>setImmediate(r));
 assert.equal(h.timers.length,0);assert.equal(h.samples.length,0);resolve();await pending;
 assert.deepEqual(h.timers,[100]);assert.equal(h.samples.length,1);
});
test('modestly stale server contents after recovery stay bounded rather than accumulating drift',async()=>{
 const h=harness();await h.step({at:1000,data:data(10000)});await h.step({at:1100,status:500});
 const n=await h.step({at:1800,data:data(10650)});assert.equal(n.positionMs,10650);
 const stale=await h.step({at:1900,data:data(10500)});assert.equal(stale.positionMs,10750);
 const next=await h.step({at:2000,data:data(10850)});assert.equal(next.positionMs,10850);
});
