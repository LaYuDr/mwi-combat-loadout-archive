"use strict";
const F=require('./fixtures.cjs');
const initial=Array.from({length:5},(_,i)=>({...F.modern(i<2?'同名角色':`合成玩家${i+1}`).player,id:String(i+1)}));
module.exports=`<!doctype html><html class="dark" data-theme="dark" lang="zh"><head><meta charset="utf-8"><title>原生配置存档合成验收</title></head>
<body style="background:#0b1220;color:#e2e8f0;font:15px system-ui;margin:28px"><h1>MWI 战斗模拟器 · 合成测试</h1><p>仅使用合成玩家，验证原生导入导出往返。</p>
<main><section id="fixture-home"><div role="tablist" aria-label="主页工作区"><button role="tab" aria-selected="true">基础设置</button><button role="tab">战斗属性</button><button role="tab">完整结果</button></div><div id="fixture-native-config" style="min-height:230px;padding:12px 0"><h2>原生模拟器配置</h2><button id="native-open">导入/导出</button><label>模拟玩家 1 名称 <input aria-label="模拟玩家 1 名称" id="manual"></label><label>模拟玩家 1 武器强化 <input type="number" aria-label="模拟玩家 1 武器强化" id="manual-gear"></label>
</div></section></main><section role="dialog" hidden style="background:#182233;padding:20px;position:fixed;inset:5%;overflow:auto">
<p class="sr-only text-muted-foreground">导入/导出</p><button aria-label="关闭" id="native-close">关闭</button><div class="modal-body-text"><div>
<div class="native-group"><h3>组队导入/导出</h3><div><button id="group-export">导出组队</button></div><textarea id="group-text"></textarea><input type="file" id="group-file"><button id="group-import">导入组队</button></div>
<div class="native-solo"><h3>单人导入/导出</h3><button role="combobox" aria-label="单人导入/导出" aria-controls="player-options" aria-expanded="false">同名角色</button><div id="player-options" role="listbox" hidden></div><div><button id="solo-export">导出单人</button></div><textarea id="solo-text"></textarea><input type="file" id="solo-file"><button id="solo-import">导入到玩家</button></div>
<p id="native-status" class="text-muted-foreground"></p></div></div></section>
<script>
window.fixturePlayers=${JSON.stringify(initial)};window.fixtureSettings={simulationTimeHours:4,extra:{zero:0,no:false,nil:null,list:[],map:{}}};window.fixtureImports=[];window.fixtureExports=[];
window.fixtureReject=false;window.fixtureIgnoreExport=false;window.fixtureExportFailure=false;window.fixtureDelay=15;window.fixtureSlot='1';
const $=s=>document.querySelector(s);const modal=$('[role=dialog]'),options=$('#player-options'),selector=$('[role=combobox]');
function status(text,tone='success'){const p=$('#native-status');p.textContent=text;p.className=tone==='error'?'text-destructive':tone==='success'?'text-success':'text-muted-foreground';}
function syncOptions(){options.replaceChildren();for(const p of fixturePlayers){const o=document.createElement('div');o.role='option';o.textContent=p.name;o.tabIndex=-1;o.setAttribute('aria-selected',String(p.id===fixtureSlot));o.onkeydown=e=>{if(e.key==='Enter'){fixtureSlot=p.id;selector.textContent=p.name;options.hidden=true;selector.setAttribute('aria-expanded','false');syncOptions();}};options.append(o);}}
selector.onkeydown=e=>{if(e.key==='ArrowDown'){options.hidden=false;selector.setAttribute('aria-expanded','true');syncOptions();}};
$('#native-open').onclick=()=>{modal.hidden=false;status('','info');};$('#native-close').onclick=()=>{modal.hidden=true;options.hidden=true;selector.setAttribute('aria-expanded','false');};
$('#manual-gear').value=fixturePlayers[0].equipment.weapon.enhancementLevel;$('#manual-gear').oninput=e=>{fixturePlayers[0].equipment.weapon.enhancementLevel=Number(e.target.value);};
$('#manual').value=fixturePlayers[0].name;$('#manual').oninput=e=>{fixturePlayers[0].name=e.target.value;};
for(const kind of ['solo','group']){
 const text=$('#'+kind+'-text'),file=$('#'+kind+'-file');
 $('#'+kind+'-export').onclick=async()=>{if(fixtureIgnoreExport)return;await new Promise(r=>setTimeout(r,fixtureDelay));if(fixtureExportFailure){status('导出失败：合成加载错误','error');return;}
 const data={version:2,format:'mwi-vue-'+kind,simulationSettings:structuredClone(fixtureSettings)};
 if(kind==='group')data.players=structuredClone(fixturePlayers);else data.player=structuredClone(fixturePlayers.find(p=>p.id===fixtureSlot));
 text.value=JSON.stringify(data,null,2);fixtureExports.push({kind,slot:fixtureSlot,text:text.value});status('导出成功');};
 file.onchange=async()=>{const f=file.files[0];if(!f)return;text.value=await f.text();status('已载入文件：'+f.name);file.value='';};
 $('#'+kind+'-import').onclick=async()=>{await new Promise(r=>setTimeout(r,fixtureDelay));if(fixtureReject){status('请先保存或取消当前未提交编辑','info');return;}try{const data=JSON.parse(text.value);
 if(kind==='group'){for(const p of data.players){const i=fixturePlayers.findIndex(x=>x.id===p.id);if(i>=0)fixturePlayers[i]=structuredClone(p);}}
 else {const p=data.player||{name:data.character?.name||data.profile?.sharableCharacter?.name||'旧角色'};fixturePlayers=fixturePlayers.map(x=>x.id===fixtureSlot?{...x,...structuredClone(p),id:fixtureSlot}:x);}
 if(data.simulationSettings)fixtureSettings=structuredClone(data.simulationSettings);fixtureImports.push({kind,slot:fixtureSlot,text:text.value});status('导入成功（modern-'+kind+'）');
 }catch(e){status('导入失败：'+e.message,'error');}};
}
</script></body></html>`;
