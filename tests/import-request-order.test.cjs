const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const project=process.env.OSU_IMPORT_REVIEW_ROOT||path.resolve(__dirname,'..');
const mainFile=path.join(project,'src/main.cjs'),mainSource=fs.readFileSync(mainFile,'utf8'),projectRequire=createRequire(mainFile);
const {LyricsService}=projectRequire('./lyrics-service.cjs');
const song=folder=>({key:'same-checksum',set:42,beatmapFolder:folder,audioFile:'audio.ogg',title:'Same',artist:'Artist'});
function fixture(actualLyrics=null,contents={older:'OLDER',newer:'NEWER',invalid:'INVALID'}){
  const dialogs=[],reads=[],writes=[],handlers=new Map();
  const lyrics=actualLyrics||{song:song('A'),generation:1,importText:text=>{writes.push(text);return true;}};
  const app={getPath:()=>path.join(os.tmpdir(),'UNUSED-PURE-MAIN-APPDATA'),setPath:()=>{},requestSingleInstanceLock:()=>true,on:()=>{},whenReady:()=>({then:()=>{}}),quit:()=>{throw Error('Unexpected app quit');}};
  const electron={app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},dialog:{showOpenDialog:()=>new Promise((resolve,reject)=>dialogs.push({resolve,reject}))},BrowserWindow:class{constructor(){throw Error('Native windows prohibited');}}};
  const fakeFs={mkdirSync:()=>{},readFileSync:(file,encoding)=>{assert.equal(encoding,'utf8');assert(Object.hasOwn(contents,file));reads.push(file);return contents[file];}};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='node:fs'?fakeFs:projectRequire(name),__dirname:path.dirname(mainFile),process:{argv:[]},setTimeout:()=>{throw Error('Unexpected startup timer');},clearTimeout:()=>{},Buffer,URL,AbortController,console,testLyrics:lyrics});
  vm.runInContext(mainSource,context,{timeout:1000});
  vm.runInContext('lyrics = testLyrics;',context,{timeout:1000});
  return {lyrics,dialogs,reads,writes,run:()=>handlers.get('import-lyrics')(),finish:(index,file)=>dialogs[index].resolve(file===null?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]})};
}
test('newer same-recording import finishing first prevents older read and overwrite',async()=>{
  const f=fixture(),older=f.run(),newer=f.run();f.finish(1,'newer');assert.equal(await newer,true);f.finish(0,'older');
  assert.equal(await older,false);assert.deepEqual(f.reads,['newer']);assert.deepEqual(f.writes,['NEWER']);
});
test('latest cancellation invalidates an older same-recording import',async()=>{
  const f=fixture(),older=f.run(),newer=f.run();f.finish(1,null);assert.equal(await newer,false);f.finish(0,'older');
  assert.equal(await older,false);assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
});
test('older completion while newest chooser is pending cannot write',async()=>{
  const f=fixture(),older=f.run(),newer=f.run();f.finish(0,'older');assert.equal(await older,false);assert.deepEqual(f.reads,[]);
  f.finish(1,'newer');assert.equal(await newer,true);assert.deepEqual(f.writes,['NEWER']);
});
test('latest cancelled chooser invalidates both older requests in a three-request sequence',async()=>{
  const f=fixture(),first=f.run(),middle=f.run(),last=f.run();f.finish(2,null);assert.equal(await last,false);
  f.finish(1,'newer');assert.equal(await middle,false);f.finish(0,'older');assert.equal(await first,false);assert.deepEqual(f.reads,[]);
});
test('latest chooser rejection propagates and does not revive older import',async()=>{
  const f=fixture(),older=f.run(),newer=f.run();const rejection=assert.rejects(newer,/chooser failed/);
  f.dialogs[1].reject(new Error('chooser failed'));await rejection;f.finish(0,'older');assert.equal(await older,false);assert.deepEqual(f.reads,[]);
});
test('completed sequential imports remain valid',async()=>{
  const f=fixture(),older=f.run();f.finish(0,'older');assert.equal(await older,true);
  const newer=f.run();f.finish(1,'newer');assert.equal(await newer,true);assert.deepEqual(f.writes,['OLDER','NEWER']);
});
test('older cancellation after newest completion preserves newest import',async()=>{
  const f=fixture(),older=f.run(),newer=f.run();f.finish(1,'newer');assert.equal(await newer,true);
  f.finish(0,null);assert.equal(await older,false);assert.deepEqual(f.reads,['newer']);assert.deepEqual(f.writes,['NEWER']);
});
test('recording/generation change still accepts only the newest recording',async()=>{
  const f=fixture(),older=f.run();f.lyrics.generation++;f.lyrics.song=song('B');const newer=f.run();f.finish(1,'newer');assert.equal(await newer,true);
  f.finish(0,'older');assert.equal(await older,false);assert.deepEqual(f.reads,['newer']);assert.deepEqual(f.writes,['NEWER']);
});
async function realCache(run){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'osu-import-order-'));
  const lyrics=new LyricsService(folder,()=>{},{requestLyrics:async()=>{throw Error('Real network prohibited');}});
  lyrics.song=song('A');fs.writeFileSync(lyrics.paths().lrc,'[00:00.10]INITIAL\n');lyrics.writeMeta({offsetMs:327,source:'manual fixture',selectionMode:'manual'});lyrics.song=null;
  try{await lyrics.setSong(song('A'));await run(lyrics);}finally{
    await lyrics.setSong(null);
    const resolved=path.resolve(folder),temp=path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved),temp);assert(path.basename(resolved).startsWith('osu-import-order-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
test('newest real-cache import keeps offset and manual policy while stale result changes no files',async()=>realCache(async lyrics=>{
  const f=fixture(lyrics,{older:'[00:00.20]OLDER\n',newer:'[00:00.30]NEWER\n'}),older=f.run(),newer=f.run();
  f.finish(1,'newer');assert.equal(await newer,true);const paths=lyrics.paths(),lrc=fs.readFileSync(paths.lrc),meta=fs.readFileSync(paths.meta);
  f.finish(0,'older');assert.equal(await older,false);assert.deepEqual(fs.readFileSync(paths.lrc),lrc);assert.deepEqual(fs.readFileSync(paths.meta),meta);
  assert.equal(lyrics.payload.lines[0].original,'NEWER');assert.equal(lyrics.payload.offsetMs,327);assert.equal(lyrics.readMeta().offsetMs,327);
  assert.equal(lyrics.readMeta().selectionMode,'manual');assert.notEqual(lyrics.readMeta().source,'LRCLIB');assert.deepEqual(f.reads,['newer']);
}));
test('newest invalid text leaves original real cache and does not restore old pending import',async()=>realCache(async lyrics=>{
  const paths=lyrics.paths(),lrc=fs.readFileSync(paths.lrc),meta=fs.readFileSync(paths.meta);
  const f=fixture(lyrics,{older:'[00:00.20]OLDER\n',invalid:'No timestamp or lyrics'}),older=f.run(),newer=f.run();
  f.finish(1,'invalid');assert.equal(await newer,false);f.finish(0,'older');assert.equal(await older,false);
  assert.deepEqual(fs.readFileSync(paths.lrc),lrc);assert.deepEqual(fs.readFileSync(paths.meta),meta);assert.equal(lyrics.payload.offsetMs,327);assert.deepEqual(f.reads,['invalid']);
}));
