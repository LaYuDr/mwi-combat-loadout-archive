"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../native_document.js'), C = require('../archive_core.js'), F = require('./fixtures.cjs');
function group() { const a=F.modern().player, b=F.modern('队友').player; b.id='2'; return {version:2,format:'mwi-vue-group',players:[a,b],simulationSettings:{simulationTimeHours:0,unknownFuture:{flag:false,list:[],map:{},nil:null}}}; }
test('native snapshots retain the exact original JSON and all original/future fields including simulation settings', async()=>{
 const data=F.modern(); data.player.futureField={zero:0,no:false,empty:{},array:[],nil:null};
 const text=JSON.stringify(data,null,4)+'\n';const row=await D.prepare(text,{name:'保存当前方案'});
 assert.equal(row.jsonText,text); assert.deepEqual(D.describe(row).data,data);assert.equal(row.documentKind,'solo');
 assert.equal(D.describe(row).data.simulationSettings.simulationTimeHours,99);
 const restored=await D.importFile(D.backup([row]));assert.equal(restored[0].jsonText,text);assert.equal(restored[0].name,row.name);
});
test('group is kept as one complete document instead of splitting players and losing global settings',async()=>{
 const data=group(),text=JSON.stringify(data),rows=await D.importFile(text);
 assert.equal(rows.length,1);assert.equal(rows[0].documentKind,'group');assert.deepEqual(D.describe(rows[0]).data,data);
 assert.equal((await D.importFile(D.backup(rows)))[0].jsonText,text);
});
test('legacy v1 backup and native empty-object compatibility remain readable without mutating existing records',async()=>{
 const legacy=await C.prepare(F.emptyCombatSlots(),{kind:'named',name:'旧版空槽'}),original=JSON.stringify(legacy);
 const result=await D.importFile(C.exportFile([legacy]));assert.equal(result.length,1);
 assert.deepEqual(D.describe(result[0]).data.actionTypeFoodSlotsMap['/action_types/combat'],{});
 assert.equal(JSON.stringify(legacy),original);assert.equal(D.describe(legacy).legacy,true);
 const mixed=await D.importFile(D.backup([legacy,await D.prepare(JSON.stringify(group()))]));assert.equal(mixed.length,2);
 assert.equal(D.describe(mixed[0]).legacy,true);assert.equal(D.describe(mixed[1]).scope,'group');
});
test('malformed/ambiguous backups, duplicate slots, prototype keys, raw game data and oversize files fail before storage',async()=>{
 const bad=group();bad.players[1].id='1';assert.throws(()=>D.inspect(JSON.stringify(bad)),/玩家槽位/);
 assert.throws(()=>D.inspect('{"__proto__":{}}'),/不安全/);
 assert.throws(()=>D.inspect('x'.repeat(D.MAX_BYTES+1)),/20 MB/);
 await assert.rejects(D.importFile(JSON.stringify(F.current())),/游戏原始资料/);
 await assert.rejects(D.importFile(JSON.stringify({format:D.FORMAT,version:2,archives:[{jsonText:JSON.stringify(group())},{jsonText:'bad'}]})),/JSON/);
 await assert.rejects(D.importFile(JSON.stringify({format:D.FORMAT,version:2,archives:[{jsonText:JSON.stringify(group()),legacyPayload:F.current()}]})),/冲突/);
});
module.exports={group};
