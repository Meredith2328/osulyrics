const cp=require('node:child_process'),Module=require('node:module'),path=require('node:path');
const originalSpawn=cp.spawn;
cp.spawn=function(exe,args,options){
 if(path.resolve(String(exe)).toLowerCase()!==process.execPath.toLowerCase()||!Array.isArray(args)||!args.some(x=>typeof x==='string'&&x.endsWith('.test.cjs')))throw Error('Only Node test-runner subprocesses are permitted');
 return originalSpawn.call(this,exe,args,{...options,windowsHide:true});
};
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync'])cp[name]=()=>{throw Error('External process execution blocked in pure Node review')};
const originalLoad=Module._load;Module._load=function(name,...rest){if(name==='electron')throw Error('Real Electron module blocked in pure Node review');return originalLoad.call(this,name,...rest)};
global.fetch=async()=>{throw Error('Real network fetch blocked in pure Node review; inject a fake fetch')};
