'use strict';
const {listProviders}=require('./provider-registry.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
function selectProviders(route,{allowPartialDiscovery=false}={}){
 const blocked=code=>({...BOUNDARY,status:'blocked',code,providers:[]});
 if(route?.status!=='candidate'||route.actionAuthority!=='NONE'||route.worldVerification!=='UNVERIFIED'||route.executionAllowed!==false)return blocked('INVALID_ROUTE');
 if(!Array.isArray(route.unresolvedStrategyAlternatives)||route.unresolvedStrategyAlternatives.length||!Array.isArray(route.clarificationNeeds)||route.clarificationNeeds.some(q=>!['LOCATION_NOT_SUPPLIED','TIME_NOT_SUPPLIED'].includes(q.code)))return blocked('CLARIFICATION_REQUIRED');
 const kinds=[route.primaryStrategy,...(route.secondaryStrategies||[])].filter(Boolean).map(s=>s.kind);
 let providers=listProviders().filter(p=>p.strategies.includes(route.primaryStrategy?.kind));
 const official=['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(route.primaryStrategy?.kind);
 if(official){
  const {scopeFor}=require('./official-information-capabilities.cjs');
  if(!providers.some(p=>scopeFor(p,route).status==='supported'))return blocked(providers.some(p=>scopeFor(p,route).status==='unresolved')?'GEOGRAPHIC_SCOPE_REQUIRED':'UNSUPPORTED_GEOGRAPHIC_SCOPE');
  providers=providers.filter(p=>scopeFor(p,route).status==='supported');
 }
 if(!providers.length)return blocked('NO_SUPPORTED_PROVIDER');
 if(route.clarificationNeeds.length)return blocked('CLARIFICATION_REQUIRED');
 const requirements=route.providerRequirements;
 if(!Array.isArray(requirements))return blocked('INVALID_REQUIREMENTS');
 // Extra requirements are never silently satisfied by a convenient transport source.
 const eligible=providers.filter(p=>requirements.every(r=>p.capabilities.includes(r)));
 if(!eligible.length&&allowPartialDiscovery){
  const safeMissing=new Set(['LOCATION_FILTER','LOCAL_SCOPE','TIME_CONSTRAINTS','TIME_AVAILABILITY']);
  const partial=providers.map(p=>({...p,unresolvedRequirements:requirements.filter(r=>!p.capabilities.includes(r))})).filter(p=>p.unresolvedRequirements.every(r=>safeMissing.has(r)));
  if(partial.length)return {...BOUNDARY,status:'partial-candidate',providers:partial,executionAllowed:false,coverage:'DISCOVERY_ONLY_UNSATISFIED_CONSTRAINTS_RETAINED'};
 }
 return eligible.length?{...BOUNDARY,status:'candidate',providers:eligible,executionAllowed:false}:blocked('UNSUPPORTED_REQUIREMENTS');
}
module.exports={selectProviders};
