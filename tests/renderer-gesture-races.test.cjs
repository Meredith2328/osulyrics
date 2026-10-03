const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/ui/combined.js'), 'utf8');
const gatePath = path.join(__dirname, '../src/gesture-gate.js');
const kinds = [
  ['header', 'panelHeader', 'drag', null],
  ['panel edge', 'panelResizeHandles', 'resize', 'right'],
  ['lyric', 'lyricBox', 'drag', null],
  ['lyric edge', 'lyricBox', 'resize', 'right'],
  ['orb', 'collapsedToggle', 'drag', null],
];
function fixture() {
  const elements = new Map(), pending = [], calls = [], callbacks = {};
  let host = null, measures = 0;
  const element = id => {
    if (elements.has(id)) return elements.get(id);
    const handlers = {}, captures = new Set();
    const e = {id, hidden:false, style:{}, classList:{add(){},remove(){},toggle(){}},
      addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
      setPointerCapture(id) { captures.add(id); }, hasPointerCapture:id=>captures.has(id),
      releasePointerCapture(id) { captures.delete(id); },
      fire(name, event) { return Promise.all((handlers[name] || []).map(fn=>fn(event))); },
      closest(){return null;}};
    elements.set(id,e);return e;
  };
  const api = { panelToggle(){}, onOverlaySettings:fn=>callbacks.settings=fn,
    onOverlayPresence:fn=>callbacks.presence=fn,onPanelState:fn=>callbacks.panel=fn };
  for (const kind of ['drag','resize']) {
    const title=kind[0].toUpperCase()+kind.slice(1);
    api['overlay'+title+'Start']=payload=>{
      calls.push({op:'start',kind,payload});host={kind,id:calls.length};
      return new Promise((resolve,reject)=>pending.push({resolve,reject}));
    };
    api['overlay'+title+'Move']=()=>calls.push({op:'move',kind});
    api['overlay'+title+'End']=()=>{calls.push({op:'end',kind});if(host?.kind===kind)host=null;};
  }
  const sandbox={api,$:element,window:{osuGestureGate:fs.existsSync(gatePath)?require(gatePath):null,addEventListener:(name,fn)=>callbacks[name]=fn},
    document:{body:{}},locked:false,shown:true,panelOpen:true,panelSide:'above',currentLayout:null,
    suppressClick:false,lastReportedHeight:0,setTimeout:()=>1,queueLyricMeasure(){measures++;},setEditing(){},setView(){},renderControls(){},renderStyle(){},renderCollapsedToggle(){},applyLayout(){}};
  vm.createContext(sandbox);
  const gestures=source.slice((source.includes('const gestureGate =') ? source.indexOf('const gestureGate =') : source.indexOf('let pointerId = null;')),source.indexOf("$('lockButton').addEventListener"));
  const presence=source.slice(source.indexOf('function renderPresence()'),source.indexOf('\nfunction measureLyricHeight'));
  const subscriptions=['onOverlaySettings','onOverlayPresence','onPanelState'].map(name=>source.match(new RegExp(`api\\.${name}\\(next => \\{[^\\n]+`))[0]).join('\n');
  vm.runInContext(presence+gestures+subscriptions,sandbox);
  const event = (item,id=1) => {
    const [,target,,handle]=item;
    const node=handle?element(target+'Handle'):element(target);
    node.dataset={handle};node.closest=selector=>selector.includes('resize-handle')&&handle?node:null;
    return {pointerId:id,button:0,screenX:100,screenY:200,target:node,preventDefault(){}};
  };
  return {calls,pending,callbacks,host:()=>host,measures:()=>measures,
    down:(item,id=1)=>element(item[1]).fire('pointerdown',event(item,id)),
    end:(item,name='pointerup',id=1)=>element(item[1]).fire(name,event(item,id))};
}
for (const item of kinds) test(`${item[0]}: release before start confirmation closes only its accepted session`,async()=>{
  const f=fixture(),down=f.down(item);await f.end(item);
  f.pending[0].resolve(true);await down;
  assert.deepEqual(f.calls.filter(c=>c.op==='end').map(c=>c.kind),[item[2]]);
  assert.equal(f.host(),null);
});
for (const action of ['pointercancel','lostpointercapture','close','hide','lock','blur']) test(`pending gesture cancellation: ${action}`,async()=>{
  const f=fixture(),down=f.down(kinds[0]);
  if(action==='close')f.callbacks.panel({open:false,side:'above'});
  else if(action==='hide')f.callbacks.presence({shown:false});
  else if(action==='lock')f.callbacks.settings({locked:true,settings:{}});
  else if(action==='blur')f.callbacks.blur();
  else await f.end(kinds[0],action);
  f.pending[0].resolve(true);await down;
  assert.equal(f.calls.filter(c=>c.op==='end').length,1);
  assert.equal(f.host(),null);
});
for(const next of kinds) test(`pending released start excludes a newer ${next[0]} until its cleanup`,async()=>{
  const f=fixture(),old=f.down(kinds[0]);await f.end(kinds[0]);
  const blocked=f.down(next,2);await f.end(next,'pointerup',2);
  assert.equal(f.calls.filter(c=>c.op==='start').length,1,'no second host session may be created while the old acknowledgement is pending');
  f.pending[0].resolve(true);await old;await blocked;
  const active=f.down(next,3);assert.equal(f.pending.length,2);f.pending[1].resolve(true);await active;
  assert.ok(f.host(),'new session is still active after old cleanup');
  assert.equal(f.calls.filter(c=>c.op==='end').length,1,'old cleanup ended once');
  await f.end(next,'pointerup',3);assert.equal(f.host(),null);
  assert.deepEqual(f.calls.filter(c=>c.op==='end').map(c=>c.kind),['drag',next[2]]);
});
test('rejected start clears local ownership and permits the next gesture',async()=>{
  const f=fixture(),down=f.down(kinds[0]);f.pending[0].reject(new Error('fake unavailable'));await down;
  const next=f.down(kinds[1]);assert.equal(f.pending.length,2);f.pending[1].resolve(true);await next;
  await f.end(kinds[1]);assert.equal(f.host(),null);
});
test('host refusal sends no end for an unaccepted request',async()=>{
  const f=fixture(),down=f.down(kinds[3]);f.pending[0].resolve(false);await down;
  assert.deepEqual(f.calls.filter(c=>c.op==='end'),[]);
});

test('hidden pending cleanup defers measurement until the surface is shown',async()=>{
  const f=fixture(),down=f.down(kinds[1]);f.callbacks.presence({shown:false});
  f.pending[0].resolve(true);await down;
  assert.equal(f.measures(),0,'do not replace a real height with hidden DOM measurements');
  f.callbacks.presence({shown:true});assert.equal(f.measures(),1);
});
test('close and hide end an accepted gesture only once',async()=>{
  const f=fixture(),down=f.down(kinds[1]);f.pending[0].resolve(true);await down;
  f.callbacks.panel({open:false,side:'above'});f.callbacks.panel({open:false,side:'above'});f.callbacks.presence({shown:false});
  assert.equal(f.calls.filter(c=>c.op==='end').length,1);assert.equal(f.host(),null);
});
