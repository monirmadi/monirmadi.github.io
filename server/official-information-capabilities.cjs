'use strict';
// Capability scope is discovery of public catalogue records, never execution.
const CAPABILITIES=Object.freeze({
 GOVERNMENT_SERVICES:{informationForm:'CATALOG_DISCOVERY',resultType:'INFORMATION_RESOURCE'},
 HOUSING_INTELLIGENCE:{informationForm:'CATALOG_DISCOVERY',resultType:'INFORMATION_RESOURCE'},
 LIVE_HOUSING_LISTINGS:{available:false},
 HOUSING_SEEKER_TO_HOUSING_OFFER:{available:false,requires:'FUTURE_OPT_IN_INTERNAL_NETWORK'}
});
function scopeFor(provider,route){
 const constraints=route.constraints||[];
 const countries=constraints.filter(c=>c.dimension==='COUNTRY'&&c.operator==='equals'&&c.value?.state==='known').map(c=>c.value.value);
 const places=constraints.filter(c=>c.dimension==='LOCATION'&&c.operator==='equals'&&c.value?.state==='known').map(c=>c.value.value);
 const geo=provider.geographicScope;
 const mapped=places.map(p=>geo?.namedLocations?.[p]).filter(Boolean);
 const all=[...new Set([...countries,...mapped])];
 if(all.length!==1)return {status:all.length?'conflicting':'unresolved'};
 return {status:geo?.countries?.includes(all[0])?'supported':'unsupported',country:all[0],places};
}
function officialCatalogRequest(route,provider,topic){
 const capability=route.primaryStrategy?.kind,scope=scopeFor(provider,route);
 if(!['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(capability)||!provider.capabilities.includes(capability)||scope.status!=='supported'||typeof topic!=='string'||!topic.trim())return null;
 return {providerId:provider.id,operation:'datasets',capability,country:scope.country,query:[topic,...scope.places].join(' '),queryMode:'all-terms',results:5};
}
module.exports={CAPABILITIES,scopeFor,officialCatalogRequest};
