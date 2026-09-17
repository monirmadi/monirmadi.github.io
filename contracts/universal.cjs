'use strict';
// Shape/reference validation only. Evidence/consent claims require server verification.
function validateNeed(n){
 const errors=[];const fail=p=>errors.push(p);const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const str=x=>typeof x==='string'&&x.trim().length>0&&x.length<=4000;
 function shape(x,keys,p){if(!obj(x)){fail(p);return false;}if(Object.keys(x).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(x,k)))fail(p+'.keys');return true;}
 function list(x,p,fn){if(!Array.isArray(x)||x.length>100){fail(p);return;}x.forEach((v,i)=>fn(v,p+'.'+i));}
 function evidence(x,p){if(!shape(x,['source','reference','confidence'],p))return;if(!['user-text','user-confirmation','provider','authored-fixture'].includes(x.source)||!str(x.reference)||(x.confidence!==null&&(!Number.isFinite(x.confidence)||x.confidence<0||x.confidence>1)))fail(p);}
 function field(x,p){if(!obj(x)){fail(p);return;}if(x.state==='unknown'){shape(x,['state'],p);return;}if(x.state==='known'){if(!shape(x,['state','value','confirmed','evidence'],p))return;if(!str(x.value)||typeof x.confirmed!=='boolean')fail(p);list(x.evidence,p+'.evidence',evidence);if(!x.evidence?.length)fail(p+'.evidence');if(x.confirmed===true&&!(Array.isArray(x.evidence)&&x.evidence.some(e=>e?.source==='user-confirmation')))fail(p+'.confirmation');return;}if(x.state==='ambiguous'){shape(x,['state','candidates'],p);list(x.candidates,p+'.candidates',(c,q)=>{if(shape(c,['value','evidence'],q)){if(!str(c.value)||!c.evidence?.length)fail(q);list(c.evidence,q+'.evidence',evidence);}});if(!Array.isArray(x.candidates)||x.candidates.length<2||new Set(x.candidates.map(c=>c?.value)).size!==x.candidates.length)fail(p+'.alternatives');return;}fail(p+'.state');}
 if(!shape(n,['schemaVersion','id','originalText','language','market','lifecycle','privacy','interpretation'],'need'))return {valid:false,errors};
 if(n.schemaVersion!==1||!str(n.id)||!str(n.originalText))fail('need.identity');field(n.language,'language');field(n.market,'market');
 if(shape(n.lifecycle,['mode','window'],'lifecycle')){if(!['one-time','persistent','live'].includes(n.lifecycle.mode))fail('lifecycle.mode');field(n.lifecycle.window,'lifecycle.window');}
 if(shape(n.privacy,['visibility','discoverability','communication','consentReferences','location'],'privacy')){
 if(n.privacy.visibility!=='private'||!['off','opt-in'].includes(n.privacy.discoverability)||!['off','opt-in'].includes(n.privacy.communication))fail('privacy');list(n.privacy.consentReferences,'privacy.consentReferences',(v,p)=>{if(!str(v))fail(p);});if((n.privacy.discoverability==='opt-in'||n.privacy.communication==='opt-in')&&!n.privacy.consentReferences?.length)fail('privacy.consent');
 if(shape(n.privacy.location,['precision','area'],'location')){if(n.privacy.location.precision!=='approximate')fail('location.precision');field(n.privacy.location.area,'location.area');}}
 if(!shape(n.interpretation,['providerId','providerVersion','intent'],'interpretation'))return {valid:false,errors};if(!str(n.interpretation.providerId)||!str(n.interpretation.providerVersion))fail('provider');
 const i=n.interpretation.intent;if(!shape(i,['state','entities','actions','roles','domains','constraints','strategies','alternatives'],'intent'))return {valid:false,errors};if(!['unknown','partial','interpreted'].includes(i.state))fail('intent.state');
 const ids=new Set([n.id]),groups={};for(const name of ['entities','actions','roles','domains','constraints','strategies','alternatives']){groups[name]=new Set();list(i[name],name,(v,p)=>{if(!obj(v)||!str(v.id)||ids.has(v.id)){fail(p+'.id');return;}ids.add(v.id);groups[name].add(v.id);});}
 const refs=(values,set,p)=>list(values,p,(v,q)=>{if(!set.has(v))fail(q);});
 list(i.entities,'entities',(v,p)=>{if(shape(v,['id','kind','description'],p)){field(v.kind,p+'.kind');field(v.description,p+'.description');}});
 list(i.actions,'actions',(v,p)=>{if(shape(v,['id','verb','entityIds'],p)){field(v.verb,p+'.verb');refs(v.entityIds,groups.entities,p+'.entityIds');}});
 list(i.roles,'roles',(v,p)=>{if(shape(v,['id','participantId','actionId','role'],p)){if(!groups.entities.has(v.participantId)||!groups.actions.has(v.actionId))fail(p+'.references');field(v.role,p+'.role');}});
 list(i.domains,'domains',(v,p)=>{if(shape(v,['id','context','entityIds'],p)){field(v.context,p+'.context');refs(v.entityIds,groups.entities,p+'.entityIds');}});
 list(i.constraints,'constraints',(v,p)=>{if(shape(v,['id','subjectId','dimension','operator','value','unit'],p)){if(!new Set([n.id,...groups.entities,...groups.actions]).has(v.subjectId)||!str(v.dimension)||!['equals','excludes','at-most','at-least','within','prefers'].includes(v.operator))fail(p);field(v.value,p+'.value');field(v.unit,p+'.unit');}});
 list(i.strategies,'strategies',(v,p)=>{if(shape(v,['id','kind','actionIds'],p)){field(v.kind,p+'.kind');refs(v.actionIds,groups.actions,p+'.actionIds');}});
 list(i.alternatives,'alternatives',(v,p)=>{if(shape(v,['id','actionIds','constraintIds'],p)){refs(v.actionIds,groups.actions,p+'.actionIds');refs(v.constraintIds,groups.constraints,p+'.constraintIds');if(!v.actionIds?.length)fail(p);}});
 if(i.state==='unknown'&&Object.keys(groups).some(k=>groups[k].size))fail('unknown intent must not supply defaults');
 return {valid:errors.length===0,errors};
}
function emptyNeed({id,originalText}){return {schemaVersion:1,id,originalText,language:{state:'unknown'},market:{state:'unknown'},lifecycle:{mode:'one-time',window:{state:'unknown'}},privacy:{visibility:'private',discoverability:'off',communication:'off',consentReferences:[],location:{precision:'approximate',area:{state:'unknown'}}},interpretation:{providerId:'unassigned',providerVersion:'1',intent:{state:'unknown',entities:[],actions:[],roles:[],domains:[],constraints:[],strategies:[],alternatives:[]}}};}
module.exports={validateNeed,emptyNeed};
