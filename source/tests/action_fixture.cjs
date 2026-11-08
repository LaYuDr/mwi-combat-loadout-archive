"use strict";
// Native SkillActionDetail contract checked against official main.8add56c3.chunk.js
// on 2026-11-08. Synthetic data and queued state updates; no game connection.
module.exports = `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="root"></main><script>
window.startedActions=[];
window.loadouts={1:{id:1,name:'所有行动',actionTypeHrid:''},2:{id:2,name:'三采',actionTypeHrid:'/action_types/woodcutting'},3:{id:3,name:'战斗',actionTypeHrid:'/action_types/combat'}};
window.currentCharacter=71;
window.makePanel=function(action='redwood',type='woodcutting',reuse=false){
 if(!reuse || !window.actionController){
  document.getElementById('root').innerHTML='<section class="SkillActionDetail_skillActionDetail__fixture"><h1></h1><div class="SkillActionDetail_loadoutDropdown__fixture"><label>配装<select aria-label="配装"></select></label></div><button id="start">立即开始</button><button id="close">关闭</button></section>';
  window.actionController={props:{},state:{},setState(patch,callback){queueMicrotask(()=>{const update=typeof patch==='function'?patch(this.state,this.props):patch;if(update)Object.assign(this.state,update);paintAction();callback?.call(this);});},
   loadoutSelected(event){this.setState({selectedCharacterLoadoutId:Number(event.target.value)});}};
 }
 const c=actionController;
 c.props={characterInfo:{characterID:currentCharacter},actionDetail:{hrid:'/actions/'+action,type:'/action_types/'+type},characterLoadoutDict:loadouts};
 c.state={actionDetail:c.props.actionDetail,selectedCharacterLoadoutId:1,loadoutOptions:[{value:0,text:'无配装'},...Object.values(loadouts).filter(l=>!l.actionTypeHrid||l.actionTypeHrid===c.props.actionDetail.type).map(l=>({value:l.id,text:l.name}))],difficultyTier:0};
 const panel=document.querySelector('section');panel.hidden=false;
 // No host fiber expandos: exercise the production fallback through the current root.
 const owner={stateNode:c},host={stateNode:panel,return:owner};owner.child=host;
 document.getElementById('root')._reactRootContainer={current:owner};
 document.querySelector('select').onchange=e=>c.loadoutSelected(e);
 document.getElementById('start').onclick=()=>startedActions.push({action:c.props.actionDetail.hrid,loadout:c.state.selectedCharacterLoadoutId});
 document.getElementById('close').onclick=()=>{panel.hidden=true;};
 paintAction();
};
window.paintAction=function(){const c=actionController, select=document.querySelector('select');
 document.querySelector('h1').textContent=c.props.actionDetail.hrid;
 select.replaceChildren(...c.state.loadoutOptions.map(o=>{const e=document.createElement('option');e.value=o.value;e.textContent=o.text;return e;}));select.value=c.state.selectedCharacterLoadoutId;
};
makePanel();
</script></body></html>`;
