"use strict";
module.exports = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{background:#171822;color:#eeeef5;font:16px Arial,sans-serif;margin:0;padding:24px}main{max-width:850px;margin:auto}
.LoadoutsPanel_loadoutsPanel__fixture{text-align:center;display:flex;flex-direction:column}.LoadoutsPanel_details__fixture{width:21.25rem;max-width:100%;margin:auto;display:flex;flex-direction:column;text-align:left}.LoadoutsPanel_setup__fixture{padding:20px;background:#202130;border-radius:7px}
.LoadoutsPanel_metadata__fixture{margin:12px 0}button,input{font:inherit}button{background:#465bb3;color:#fff;border:0;border-radius:5px;padding:10px;cursor:pointer}
.LoadoutsPanel_playerModel__fixture{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.slot{min-height:80px;border:1px solid #858caf;padding:6px;border-radius:5px;overflow-wrap:anywhere}
.LoadoutsPanel_abilities__fixture,.LoadoutsPanel_consumables__fixture{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}.ability,.consumable{flex:1 1 80px;min-width:0}
h1{text-align:center}h2{font-size:18px;width:100%}.LoadoutsPanel_playerModel__fixture{margin:12px 0}
@media(max-width:520px){body{padding:12px}.LoadoutsPanel_setup__fixture{padding:10px}.slot{font-size:12px;min-height:65px}}
</style></head><body><main id="root"><div class="LoadoutsPanel_loadoutsPanel__fixture"><h1>配装</h1><div class="LoadoutsPanel_details__fixture">
<div class="LoadoutsPanel_metadata__fixture" id="parent-name">名称：远程</div>
<div class="LoadoutsPanel_metadata__fixture"><label><input type="checkbox">设为战斗的默认配装</label></div>
<div class="LoadoutsPanel_metadata__fixture"><label><input type="checkbox">缺失物品时不要提醒</label></div>
<div class="LoadoutsPanel_metadata__fixture"><label><input id="highest" type="checkbox">使用最高强化等级</label></div>
<div class="LoadoutsPanel_setup__fixture"><div><button>导入当前配置</button> <button>装备配装</button></div><h2>装备</h2>
<div class="LoadoutsPanel_playerModel__fixture"></div><div class="LoadoutsPanel_abilities__fixture"></div><div class="LoadoutsPanel_consumables__fixture"></div></div>
</div></div><div id="native-editor" hidden><label>原生配置 JSON<textarea aria-label="原生配置 JSON"></textarea></label><button id="native-save">手动保存原生配置</button></div>
<button id="open-editor">模拟玩家打开原生编辑器</button></main><script>
window.nativeCalls=0;
window.original={id:12,name:'远程',actionTypeHrid:'/action_types/combat',useExactEnhancement:true,isDefault:false,suppressValidation:false,
wearableMap:{'/item_locations/two_hand':'71::/item_locations/inventory::/items/bow::12','/item_locations/head':'71::/item_locations/inventory::/items/hood::8','/item_locations/back':''},
abilityMap:{1:'/abilities/shot',2:'/abilities/heal',3:'',4:'',5:''},foodItemHrids:['/items/yogurt','',''],drinkItemHrids:['/items/coffee','',''],
abilityCombatTriggersMap:{'/abilities/shot':[{dependencyHrid:'/combat_trigger_dependencies/self',conditionHrid:'/combat_trigger_conditions/current_hp',comparatorHrid:'/combat_trigger_comparators/less_than_equal',value:0,extension:{empty:{},flag:false}}]},
consumableCombatTriggersMap:{'/items/yogurt':[{dependencyHrid:'/combat_trigger_dependencies/self',conditionHrid:'/combat_trigger_conditions/current_hp',comparatorHrid:'/combat_trigger_comparators/less_than_equal',value:50}]},nativeExtension:{empty:[],zero:0}};
const words={'/items/bow':'银杏弓','/items/hood':'远程兜帽','/items/coffee':'远程咖啡','/items/tea':'迅捷茶','/items/yogurt':'桃子酸奶','/abilities/shot':'精准射击','/abilities/heal':'治疗',
'/combat_trigger_dependencies/self':'自身','/combat_trigger_conditions/current_hp':'当前生命值','/combat_trigger_comparators/less_than_equal':'小于或等于'};
window.controller={state:{selectedCharacterLoadoutId:12},props:{characterLoadoutDict:{12:structuredClone(original)},characterInfo:{characterID:71},t:key=>words[key.slice(key.indexOf('.')+1)]||key,
updateLoadoutHandler:()=>{nativeCalls++;throw Error('must never call native handler')},loadLoadoutHandler:()=>{nativeCalls++;throw Error('must never call native handler')}}};
const panel=document.querySelector('[class*=LoadoutsPanel_loadoutsPanel]');
let fiberMode='root',panelFiber,rootFiber;
const fixtureFibers=new Map();
window.setFiberMode=function(mode){fiberMode=mode;paint();};
function mark(element,fiber){for(const key of Object.getOwnPropertyNames(element))if(/^__react(?:Fiber|InternalInstance)[$]/.test(key))delete element[key];
if(fiberMode==='modern')element.__reactFiber$fixture=fiber;
if(fiberMode==='legacy')element.__reactInternalInstance$fixture=fiber;
if(fiberMode==='nonenumerable')Object.defineProperty(element,'__reactFiber$fixture',{value:fiber,configurable:true});}
function initFibers(){fixtureFibers.clear();const container=document.getElementById('root'),controllerFiber={stateNode:controller};
rootFiber={stateNode:container,child:controllerFiber};controllerFiber.return=rootFiber;
panelFiber={stateNode:panel,return:controllerFiber};controllerFiber.child=panelFiber;fixtureFibers.set(panel,panelFiber);mark(panel,panelFiber);
for(const key of Object.getOwnPropertyNames(container))if(/^__reactContainer[$]/.test(key))delete container[key];
delete container._reactRootContainer;
if(fiberMode==='wrapped')container._reactRootContainer={_internalRoot:{current:rootFiber}};
else if(fiberMode==='container')container.__reactContainer$fixture={stateNode:{current:rootFiber}};
else if(fiberMode!=='missing')container._reactRootContainer={current:rootFiber};}

const positions={back:[1,1],head:[1,2],trinket:[1,3],main_hand:[2,1],off_hand:[2,3],body:[2,2],hands:[3,1],legs:[3,2],pouch:[3,3],feet:[4,2],neck:[1,5],earrings:[2,5],ring:[3,5],charm:[4,5],milking_tool:[7,1],foraging_tool:[7,2],woodcutting_tool:[7,3],cheesesmithing_tool:[7,4],crafting_tool:[7,5],tailoring_tool:[8,1],cooking_tool:[8,2],brewing_tool:[8,3],alchemy_tool:[8,4],enhancing_tool:[8,5]};
function props(el,value){const fiber={stateNode:el,memoizedProps:value,return:panelFiber,sibling:panelFiber.child};panelFiber.child=fiber;fixtureFibers.set(el,fiber);mark(el,fiber);}
window.paint=function(){initFibers();const raw=controller.props.characterLoadoutDict[controller.state.selectedCharacterLoadoutId];if(!raw)return;
document.querySelector('#parent-name').textContent='名称：'+raw.name;document.querySelector('#highest').checked=!raw.useExactEnhancement;
const gear=document.querySelector('[class*=LoadoutsPanel_playerModel]');gear.replaceChildren();for(const [key,pos] of Object.entries(positions)){if(raw.actionTypeHrid==='/action_types/combat'&&key.endsWith('_tool'))continue;const cell=document.createElement('div');cell.className='slot';cell.style.gridRowStart=pos[0];cell.style.gridColumnStart=pos[1];const hash=raw.wearableMap['/item_locations/'+key]||(key==='main_hand'?raw.wearableMap['/item_locations/two_hand']:'');cell.textContent=hash?words[hash.split('::')[2]]+' +'+hash.split('::')[3]:key;gear.append(cell);}
const abilities=document.querySelector('[class*=LoadoutsPanel_abilities]');abilities.replaceChildren();abilities.hidden=raw.actionTypeHrid!=='/action_types/combat';if(!abilities.hidden)for(let i=1;i<=5;i++){const cell=document.createElement('div');cell.className='ability slot';cell.textContent=i+'. '+(words[raw.abilityMap[i]]||'空技能');props(cell,{slotNumber:i});const setting=document.createElement('button');setting.textContent='条件';setting.className='CombatTriggersSetting_settingButton__fixture';cell.append(setting);abilities.append(cell);}
const consumables=document.querySelector('[class*=LoadoutsPanel_consumables]');consumables.replaceChildren();for(const kind of raw.actionTypeHrid==='/action_types/combat'?['food','drink']:raw.actionTypeHrid?['drink']:[])for(let i=0;i<3;i++){const cell=document.createElement('div');cell.className='consumable slot';cell.textContent=(kind==='food'?'食物':'饮料')+(i+1)+' '+(words[raw[kind+'ItemHrids'][i]]||'空槽');props(cell,{slotIndex:i,consumableSlotTypeHrid:'/consumable_slot_types/'+kind});const setting=document.createElement('button');setting.textContent='条件';setting.className='CombatTriggersSetting_settingButton__fixture';if(raw.actionTypeHrid==='/action_types/combat')cell.append(setting);consumables.append(cell);}}
paint();
document.querySelector('#open-editor').onclick=()=>{document.querySelector('#native-editor').hidden=false;document.querySelector('textarea').value=JSON.stringify(controller.props.characterLoadoutDict[controller.state.selectedCharacterLoadoutId]);};
document.querySelector('#native-save').onclick=()=>{const raw=JSON.parse(document.querySelector('textarea').value);controller.props.characterLoadoutDict[raw.id]=raw;paint();document.querySelector('#native-editor').hidden=true;};
</script></body></html>`;
