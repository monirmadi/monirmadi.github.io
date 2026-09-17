'use strict';
const {verifyTextEvidence}=require('../contracts/text-evidence-boundary.cjs');
const {sourceFingerprint}=require('../contracts/interpretation-boundary.cjs');
const {proposalFingerprint}=require('../contracts/semantic-claim-boundary.cjs');
const {VERSION,STRATEGIES,ACTIONS,KINDS,DOMAINS,REQUIREMENTS,token}=require('./search-strategy-policy.cjs');
const BASE={schemaVersion:1,policyVersion:VERSION,worldVerification:'UNVERIFIED',actionAuthority:'NONE',executionAllowed:false};
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
// Bounded data copy, not a sandbox for malicious executable proxies.
function copy(value){let nodes=0,chars=0;const seen=new Set();function walk(v,depth){
 if(++nodes>20000||depth>30)throw Error();
 if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){if((chars+=v.length)>200000)throw Error();return v;}
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(typeof v!=='object'||seen.has(v)||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))))throw Error();
 seen.add(v);const out=Array.isArray(v)?[]:{};
 for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);
 if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value')||(Array.isArray(v)&&!/^(0|[1-9][0-9]*)$/.test(k)))throw Error();
 if((chars+=k.length)>200000)throw Error();out[k]=walk(d.value,depth+1);}
 if(Array.isArray(v)&&Object.keys(out).length!==v.length)throw Error();seen.delete(v);return out;
 }return walk(value,0);}
function routeUniversalSearch(input,context){
 const fail=code=>({...BASE,status:'rejected',code});
 let x,c;try{[x,c]=copy([input,context]);}catch{return fail('INVALID_OR_OVERSIZED_INPUT');}
 if(!shape(x,['proposal','textReferences'])||!shape(c,['source','expectedProvider']))return fail('INVALID_INPUT');
 if(verifyTextEvidence(c.source,x.proposal,c.expectedProvider,x.textReferences).status!=='verified')return fail('BOUNDARY_REJECTED');
 const need=x.proposal.need,i=need.interpretation.intent,root='/interpretation/intent';
 const fields=new Map(),clarificationNeeds=[],ambiguous=[];
 function scan(v,path){if(!v||typeof v!=='object')return;
  if(['known','unknown','ambiguous'].includes(v.state)&&path!==root){fields.set(path,v);if(v.state==='ambiguous')ambiguous.push({path,field:v});return;}
  for(const [k,value]of Object.entries(v))scan(value,path+'/'+k);
 }
 scan(i,root);
 // Tighten routing eligibility: every populated field needs original-text evidence.
 for(const [path,f]of fields){const populated=f.state==='known'?[f]:f.state==='ambiguous'?f.candidates:[];
  for(let n=0;n<populated.length;n++){const p=f.state==='ambiguous'?path+'/candidates/'+n:path,e=populated[n].evidence;
   if(!e.length||e.some(r=>r.source!=='user-text')||!e.every(r=>x.textReferences.some(t=>t.target===p&&t.reference===r.reference)))return fail('UNSUPPORTED_ROUTING_EVIDENCE');
  }
 }
 const known=f=>f?.state==='known'?token(f.value):null;
 const prov=paths=>[...new Set(paths)].map(path=>({path,evidenceIndexes:x.textReferences.flatMap((r,n)=>r.target===path?[n]:[])}));
 const entities=new Map(i.entities.map((e,n)=>[e.id,{...e,path:root+'/entities/'+n}]));
 const actionPath=a=>root+'/actions/'+i.actions.indexOf(a);
 const constraintPath=q=>root+'/constraints/'+i.constraints.indexOf(q);
 const locationDimensions=new Set(['LOCATION','CITY','AREA','EVENT_LOCATION','DESTINATION']);
 const localDimensions=new Set(['LOCATION','CITY','AREA','DESTINATION']);
 const timeDimensions=new Set(['TIME','DATE','DURATION','START_DATE','TIME_WINDOW']);
 const locations=i.constraints.filter(q=>locationDimensions.has(token(q.dimension)));
 const times=i.constraints.filter(q=>timeDimensions.has(token(q.dimension)));
 const timeSensitive=q=>['TODAY','TONIGHT','NOW','CURRENT','LIVE'].includes(known(q.value));
 const exclusionKinds=v=>v==='BUY'||v==='PRODUCT_PURCHASE'?['BUY','PRODUCT_PURCHASE']:Object.hasOwn(ACTIONS,v)?ACTIONS[v]:STRATEGIES.includes(v)?[v]:[];
 function routeSet(actions,constraints){
  const routes=[],excluded=[];
  for(const q of constraints.filter(q=>q.operator==='excludes'&&['ACTION','STRATEGY'].includes(token(q.dimension)))){
   const kinds=exclusionKinds(known(q.value));
   if(!kinds.length)clarificationNeeds.push({code:'UNMAPPED_EXCLUSION',path:constraintPath(q)+'/value'});
   for(const kind of kinds)excluded.push({kind,subjectId:q.subjectId,provenance:prov([constraintPath(q)+'/value'])});
  }
  function add(kind,a,paths){const route={kind,entityIds:[...a.entityIds],actionIds:[a.id],constraintIds:constraints.filter(q=>q.subjectId===need.id||q.subjectId===a.id||a.entityIds.includes(q.subjectId)).map(q=>q.id),provenance:prov(paths)};
   if(!routes.some(r=>r.kind===kind&&r.actionIds[0]===a.id))routes.push(route);
  }
  for(const a of actions){
   const verb=known(a.verb),ap=actionPath(a)+'/verb',targets=a.entityIds.map(id=>entities.get(id));
   if(a.verb.state!=='known'){clarificationNeeds.push({code:'MISSING_OR_AMBIGUOUS_ACTION',path:ap});continue;}
   const relevant=constraints.filter(q=>q.subjectId===need.id||q.subjectId===a.id||a.entityIds.includes(q.subjectId));
   const blocked=excluded.filter(e=>e.subjectId===need.id||e.subjectId===a.id||a.entityIds.includes(e.subjectId));
   if(relevant.some(q=>q.operator==='excludes'&&['ACTION','STRATEGY'].includes(token(q.dimension))&&!exclusionKinds(known(q.value)).length))continue;
   if(blocked.some(e=>e.kind===verb||(ACTIONS[verb]||[]).includes(e.kind)))continue;
   const base=ACTIONS[verb]||[];for(const kind of base)add(kind,a,[ap]);
   if(['FIND','SEEK','REQUEST','RENT','NEED'].includes(verb))for(const e of targets){const kind=KINDS[known(e.kind)];if(kind)add(kind,a,[ap,e.path+'/kind']);}
   const roles=i.roles.filter(r=>r.actionId===a.id);
   const people=roles.filter(r=>['CO_PARTICIPANT','PARTNER','HELPER','EXPERIENCED_PERSON'].includes(known(r.role)));
   for(const r of people)add('PEOPLE_MATCHING',a,[ap,root+'/roles/'+i.roles.indexOf(r)+'/role']);
   const experienced=roles.filter(r=>known(r.role)==='EXPERIENCED_PERSON');
   for(const r of experienced)add('EXPERIENCE_MATCHING',a,[ap,root+'/roles/'+i.roles.indexOf(r)+'/role']);
   const domains=i.domains.filter(d=>d.entityIds.some(id=>a.entityIds.includes(id)));
   if(['ASK','FIND','SEEK','REQUEST'].includes(verb)){
    for(const e of targets){
     const specialized={GOVERNMENT_SERVICE_INFORMATION:'GOVERNMENT_SERVICES',HOUSING_INFORMATION:'HOUSING_INTELLIGENCE',LIVE_HOUSING_LISTING:'LIVE_HOUSING_LISTINGS'}[known(e.kind)];
     if(specialized)add(specialized,a,[ap,e.path+'/kind']);
     if(known(e.kind)==='INFORMATION_RESOURCE')for(const d of domains.filter(d=>d.entityIds.includes(e.id)&&['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(known(d.context))))add(known(d.context),a,[ap,e.path+'/kind',root+'/domains/'+i.domains.indexOf(d)+'/context']);
    }
   }
   const transport=domains.find(d=>known(d.context)==='TRANSPORT');
   const current=relevant.filter(q=>q.operator!=='excludes'&&timeSensitive(q));
   if(['ASK','CHECK_STATUS'].includes(verb)&&transport&&current.length){const paths=[ap,root+'/domains/'+i.domains.indexOf(transport)+'/context',...current.map(q=>constraintPath(q)+'/value')];add('CURRENT_INFORMATION',a,paths);add('TRANSPORT_STATUS',a,paths);}
   else if(verb==='CHECK_STATUS'&&transport)add('TRANSPORT_STATUS',a,[ap,root+'/domains/'+i.domains.indexOf(transport)+'/context']);
   const loc=relevant.filter(q=>q.operator!=='excludes'&&localDimensions.has(token(q.dimension))&&q.value.state==='known');
   if(loc.length&&routes.some(r=>r.actionIds[0]===a.id))add('LOCAL_SEARCH',a,[ap,...loc.map(q=>constraintPath(q)+'/value')]);
   if(current.length&&routes.some(r=>r.actionIds[0]===a.id&&['ACTIVITY_MATCHING','PEOPLE_MATCHING'].includes(r.kind)))add('LIVE_INTENT',a,[ap,...current.map(q=>constraintPath(q)+'/value')]);
   if(!routes.some(r=>r.actionIds[0]===a.id)&&!base.length)clarificationNeeds.push({code:a.verb.state==='unknown'?'MISSING_ACTION':'UNMAPPED_CONCEPT',path:ap});
  }
  const filtered=routes.filter(r=>!excluded.some(e=>e.kind===r.kind&&(e.subjectId===need.id||r.actionIds.includes(e.subjectId)||r.entityIds.includes(e.subjectId))));
  // Specific information/experience routes take precedence over broader companions.
  const priority=['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE','LIVE_HOUSING_LISTINGS','HOUSING_SEARCH','REPAIR_HELP','CURRENT_INFORMATION','LOST_AND_FOUND','EXPERIENCE_MATCHING','BORROW','LEND','GIVE','SWAP','ACTIVITY_MATCHING','PEOPLE_MATCHING','JOB_SEARCH','STUDY_SEARCH','PLACE_SEARCH','TRANSPORT_SEARCH','BUY','SELL','HELP_REQUEST','HELP_OFFER','OPPORTUNITY_SEARCH','WATCH','PERSISTENT_SEARCH','PRODUCT_SEARCH','GENERAL_INFORMATION','SERVICE_SEARCH','TRANSPORT_STATUS','LOCAL_RESOURCE_MATCHING','LOCAL_SEARCH','LIVE_INTENT','PRODUCT_PURCHASE'];
  filtered.sort((a,b)=>priority.indexOf(a.kind)-priority.indexOf(b.kind));
  return {strategies:filtered,excludedStrategies:excluded};
 }
 const alternativeConstraintIds=new Set(i.alternatives.flatMap(a=>a.constraintIds));
 const commonConstraints=i.constraints.filter(q=>!alternativeConstraintIds.has(q.id));
 const unresolvedStrategyAlternatives=[];
 let selected;
 if(i.alternatives.length){
  selected={strategies:[],excludedStrategies:routeSet([],commonConstraints).excludedStrategies};
  for(const group of i.alternatives){const routes=routeSet(i.actions.filter(a=>group.actionIds.includes(a.id)),i.constraints.filter(q=>!alternativeConstraintIds.has(q.id)||group.constraintIds.includes(q.id)));unresolvedStrategyAlternatives.push({kind:'INTENT_ALTERNATIVE',id:group.id,...routes});}
  clarificationNeeds.push({code:'CHOOSE_INTENT_ALTERNATIVE',path:root+'/alternatives'});
 }else selected=routeSet(i.actions,i.constraints);
 for(const {path,field}of ambiguous){
  unresolvedStrategyAlternatives.push({kind:'AMBIGUOUS_FIELD',path,choices:field.candidates.map((v,n)=>({value:v.value,strategyHints:ACTIONS[token(v.value)]|| (KINDS[token(v.value)]?[KINDS[token(v.value)]]:[]),provenance:prov([path+'/candidates/'+n])}))});
  clarificationNeeds.push({code:'RESOLVE_AMBIGUITY',path});
 }
 if(ambiguous.length){if(selected.strategies.length)unresolvedStrategyAlternatives.push({kind:'WITHHELD_PENDING_CLARIFICATION',strategies:selected.strategies});selected.strategies=[];}
 if(i.strategies.length)clarificationNeeds.push({code:'UPSTREAM_STRATEGY_HINTS_NOT_AUTHORITY',path:root+'/strategies'});
 if(!selected.strategies.length&&!unresolvedStrategyAlternatives.length)clarificationNeeds.push({code:'INSUFFICIENT_NORMALIZED_INTENT',path:root});
 const allRoutes=[...selected.strategies,...unresolvedStrategyAlternatives.flatMap(a=>a.strategies||[])];
 if(allRoutes.length>256)return fail('ROUTE_LIMIT_EXCEEDED');
 function requirements(routes){const req=new Set(routes.flatMap(r=>REQUIREMENTS[r.kind]||[]));
  const ids=new Set(routes.flatMap(r=>r.constraintIds));
  if(routes.some(r=>['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(r.kind)))for(const q of i.constraints.filter(q=>ids.has(q.id)&&q.dimension==='INFORMATION_FORM'&&q.operator==='equals')){if(q.value?.state!=='known'||q.value.value!=='CATALOG_DISCOVERY')req.add('DIRECT_OFFICIAL_INSTRUCTIONS');}
  if(locations.some(q=>q.operator!=='excludes'&&localDimensions.has(token(q.dimension))&&q.value.state==='known'&&ids.has(q.id)))req.add('LOCATION_FILTER');
  if(locations.some(q=>q.operator!=='excludes'&&token(q.dimension)==='EVENT_LOCATION'&&q.value.state==='known'&&ids.has(q.id)))req.add('EVENT_LOCATION_FILTER');
  if(routes.some(r=>r.kind==='PEOPLE_MATCHING')&&req.has('LOCATION_FILTER'))req.add('APPROXIMATE_LOCATION');
  if(times.some(q=>q.operator!=='excludes'&&q.value.state==='known'&&ids.has(q.id))){req.add('TIME_CONSTRAINTS');if(times.some(q=>ids.has(q.id)&&q.operator!=='excludes'&&timeSensitive(q)))req.add('TIME_AVAILABILITY');}
  return [...req].sort();
 }
 for(const a of unresolvedStrategyAlternatives)if(a.strategies)a.providerRequirements=requirements(a.strategies);
 const project=q=>({id:q.id,subjectId:q.subjectId,dimension:q.dimension,operator:q.operator,value:q.value,unit:q.unit,provenance:prov([constraintPath(q)+'/value',constraintPath(q)+'/unit'])});
 if(allRoutes.some(r=>['HOUSING_SEARCH','LOCAL_SEARCH','LOCAL_RESOURCE_MATCHING','SERVICE_SEARCH'].includes(r.kind))&&!locations.some(q=>q.operator!=='excludes'&&q.value.state==='known'))clarificationNeeds.push({code:'LOCATION_NOT_SUPPLIED',path:root+'/constraints'});
 if(allRoutes.some(r=>['LIVE_INTENT','ACTIVITY_MATCHING'].includes(r.kind))&&!times.some(q=>q.value.state==='known'))clarificationNeeds.push({code:'TIME_NOT_SUPPLIED',path:root+'/constraints'});
 return {...BASE,status:'candidate',primaryStrategy:selected.strategies[0]||null,secondaryStrategies:selected.strategies.slice(1),excludedStrategies:selected.excludedStrategies,
  unresolvedStrategyAlternatives,domainHints:i.domains.filter(d=>DOMAINS.includes(known(d.context))).map(d=>({value:known(d.context),entityIds:d.entityIds,provenance:prov([root+'/domains/'+i.domains.indexOf(d)+'/context'])})),
  entityTargets:i.entities.map(e=>({id:e.id,kind:e.kind,description:e.description})),roleTargets:i.roles,
  constraints:i.constraints.map(project),locationScope:{precision:'not-verified',requiredPrecision:'approximate',inferred:false,items:locations.map(project)},temporalScope:{resolved:false,timeSensitiveCandidate:times.some(q=>q.operator!=='excludes'&&timeSensitive(q)),items:times.map(project)},
  persistenceCandidate:{candidate:allRoutes.some(r=>['WATCH','PERSISTENT_SEARCH'].includes(r.kind)),activated:false,requiresExplicitOptIn:true},
  liveIntentCandidate:{candidate:allRoutes.some(r=>r.kind==='LIVE_INTENT'),activated:false,requiresExplicitOptIn:true},
  providerRequirements:requirements(selected.strategies),clarificationNeeds:[...new Map(clarificationNeeds.map(v=>[v.code+v.path,v])).values()],
  uncertainty:{confidence:null,basis:'DETERMINISTIC_RULES',textEvidence:'VERIFIED',semanticSupport:'UNASSESSED',worldFacts:'UNVERIFIED'},
  provenance:{sourceFingerprint:sourceFingerprint(c.source),proposalFingerprint:proposalFingerprint(x.proposal,x.textReferences)},
  privacy:{visibility:'private',discoveryConsentGranted:false,contactConsentGranted:false,locationDisclosureAuthorized:false},trustRequirements:['VERIFY_SOURCE','RECHECK_CONSENT_BEFORE_DISCOVERY_OR_CONTACT','SAFETY_REVIEW_BEFORE_ACTION']};
}
module.exports={routeUniversalSearch};
