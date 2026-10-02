const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const project=process.env.OSU_CLOCK_REVIEW_ROOT||path.resolve(__dirname,'..');
const playback=require(path.join(project,'src/playback-clock.js'));
const text=fs.readFileSync(path.join(project,'src/ui/combined.js'),'utf8');
function body(name,next){const start=text.indexOf('function '+name+'('),end=text.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start);return text.slice(start,end)}
function renderer(){
 const elements=new Map(),visibilities=[],callbacks={},timerCallbacks=[];let time=1500;
 const element=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{hidden:false,style:{},textContent:'',classList:{contains:v=>classes.has(v),toggle:(v,on)=>{if(on)classes.add(v);else classes.delete(v)}}})}return elements.get(id)};
 const song={key:'same',recordingKey:'record-a',artist:'A',title:'Song',durationMs:120000};
 const s={state:{connected:true,playing:true,positionMs:1500,sampledAt:1500,state:'play',rate:1,song},lyrics:{status:'ready',lines:[{time:1,original:'A first line'},{time:2,original:'A second line'}],offsetMs:0},settings:{showTranslation:true},activeIndex:-2,activeVisible:false,currentLayout:{progress:0,lyric:{x:0,y:0}},shown:true,candidatePage:3,showCandidatesAfterSearch:false,$:element,Date:{now:()=>time},window:{osuPlaybackClock:playback},queueLyricMeasure:()=>{},renderStatus:()=>{},renderTrack:()=>{},renderCandidates:()=>{},setView:()=>{},closeSearch:()=>{},setTimeout:fn=>{timerCallbacks.push(fn)},api:{overlayVisibility:v=>visibilities.push(v),onState:fn=>callbacks.state=fn,onLyrics:fn=>callbacks.lyrics=fn}};
 vm.createContext(s);vm.runInContext(body('currentTimeMs','activeAt')+body('activeAt','renderLyrics')+body('renderLyrics','renderCollapsedToggle')+body('renderCollapsedToggle','setEditing')+text.match(/api\.onState\(next => \{[\s\S]*?\n\}\);/)[0]+text.match(/api\.onLyrics\(next => \{[\s\S]*?\n\}\);/)[0],s);
 return {s,elements,visibilities,callbacks,setTime:v=>time=v,render:()=>vm.runInContext('renderLyrics()',s)};
}
test('same-record pause/resume updates lyric visibility and collapsed-ball spacing together',()=>{
 const r=renderer();r.render();assert.equal(r.elements.get('original').textContent,'A first line');assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),true);
 r.callbacks.state({...r.s.state,playing:false});r.setTime(9000);r.render();assert.equal(r.elements.get('original').textContent,'A first line');assert.equal(r.s.activeVisible,true);
 r.callbacks.state({...r.s.state,playing:true,positionMs:2100,sampledAt:9000});assert.equal(r.elements.get('original').textContent,'A second line');assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),true);
});
test('loading empty lyrics clears lyric visibility and ball spacing on the same callback',()=>{
 const r=renderer();r.render();r.callbacks.lyrics({status:'loading',lines:[],candidates:[],offsetMs:0});assert.equal(r.elements.get('lyricBox').hidden,true);assert.equal(r.s.activeVisible,false);assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),false);assert.equal(r.elements.get('collapsedToggle').hidden,false);
 r.callbacks.lyrics({status:'ready',lines:[{time:1,original:'B line'}],candidates:[],offsetMs:0});assert.equal(r.elements.get('original').textContent,'B line');assert.equal(r.s.activeVisible,true);assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),true);
 r.callbacks.state({...r.s.state,connected:false,playing:false,song:null});assert.equal(r.elements.get('lyricBox').hidden,true);assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),false);
});
test('a recording-B state must not render recording-A text before the next loading message',()=>{
 const r=renderer();r.s.lyrics.offsetMs=300;r.render();r.callbacks.state({...r.s.state,song:{...r.s.state.song,recordingKey:'record-b'}});
 assert.equal(r.elements.get('lyricBox').hidden,true,'new recording state still exposes A text until separately queued lyrics/loading arrives');
 assert.equal(r.elements.get('lyricBox').classList.contains('with-toggle'),false);
 assert.equal(r.s.lyrics.offsetMs,300,'recording transition clears only display lines, preserving the existing offset payload');
 r.callbacks.lyrics({status:'ready',lines:[{time:1,original:'B first line'}],candidates:[],offsetMs:200});
 assert.equal(r.elements.get('original').textContent,'B first line');assert.equal(r.s.activeVisible,true);
 assert.equal(r.s.lyrics.offsetMs,200);
});
