const test=require('node:test'),assert=require('node:assert/strict'),path=require('path'),fs=require('fs'),vm=require('vm');
const project=process.env.OSU_CLOCK_REVIEW_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(project,'src/main.cjs'),'utf8');
const {fileId}=require(path.join(project,'src/lyrics-service.cjs'));
const code=source.match(/ipcMain\.handle\('import-lyrics', async \(\) => \{[\s\S]*?\n\}\);/)[0];
const song=folder=>({key:'same',set:42,beatmapFolder:folder,audioFile:'audio.mp3',title:'Same',artist:'Artist'});
function fixture(){let resolve,read=0,imported=[];const lyrics={song:song('A'),generation:1,importText:t=>{imported.push(t);return true}};const context={lyrics,fileId,importRequestId:0,appWindow:{},dialog:{showOpenDialog:()=>new Promise(r=>resolve=r)},fs:{readFileSync:()=>{read++;return 'FAKE LRC'}},ipcMain:{handle:(_name,fn)=>context.run=fn}};vm.runInNewContext(code,context);return{lyrics,run:()=>context.run(),finish:r=>resolve(r),read:()=>read,imported}}
test('import result with an old generation cannot read or assign lyrics',async()=>{const f=fixture(),p=f.run();f.lyrics.generation++;f.finish({canceled:false,filePaths:['FAKE']});assert.equal(await p,false);assert.equal(f.read(),0);assert.deepEqual(f.imported,[])});
test('same-generation changed recording still rejects old import result',async()=>{const f=fixture(),p=f.run();f.lyrics.song=song('B');f.finish({canceled:false,filePaths:['FAKE']});assert.equal(await p,false);assert.equal(f.read(),0)});
test('cleared song rejects a pending old import result',async()=>{const f=fixture(),p=f.run();f.lyrics.song=null;f.finish({canceled:false,filePaths:['FAKE']});assert.equal(await p,false);assert.equal(f.read(),0)});
test('unchanged recording accepts the normal import result',async()=>{const f=fixture(),p=f.run();f.finish({canceled:false,filePaths:['FAKE']});assert.equal(await p,true);assert.equal(f.read(),1);assert.deepEqual(f.imported,['FAKE LRC'])});
test('cancelled import never reads a file',async()=>{const f=fixture(),p=f.run();f.finish({canceled:true,filePaths:[]});assert.equal(await p,false);assert.equal(f.read(),0)});
