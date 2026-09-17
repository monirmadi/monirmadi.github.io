'use strict';
// Trusted adapter seam. All outbound requests MUST use the supplied read function,
// which retains independent privacy review, scoped authorization and provenance.
async function executeConnectedProvider({provider,report,route,profile,value,term,read,sourceFact}){
 const finish=(stage,code)=>({stop:{stage,code}});
  let final;
  if(provider.id==='bvg-transport-v6'&&report.STRATEGY==='TRANSPORT_SEARCH'){
   const from=value('ORIGIN'),to=value('DESTINATION');
   if(!from||!to)return finish('location-resolution','ORIGIN_OR_DESTINATION_UNRESOLVED');
   if(value('TIME'))return finish('time-resolution','EXPLICIT_TIME_REQUIRES_RESOLUTION_NO_DEFAULT_ALLOWED');
   const origins=await read({providerId:provider.id,operation:'locations',query:from,results:5});
   if(origins.code==='PUBLIC_QUERY_NOT_ESTABLISHED')return finish('privacy',origins.code);
   if(!origins.results?.length)return finish(origins.status==='failed'?'real-search':'location-resolution',origins.code||'LIVE_STATION_LOOKUP_EMPTY_OR_FAILED');
   const destinations=await read({providerId:provider.id,operation:'locations',query:to,results:5});
   if([origins,destinations].some(r=>r.code==='PUBLIC_QUERY_NOT_ESTABLISHED'))return finish('privacy','PUBLIC_QUERY_NOT_ESTABLISHED');
   if(!origins.results?.length||!destinations.results?.length)return finish('location-resolution','LIVE_STATION_LOOKUP_EMPTY_OR_FAILED');
   // Exploration is tied to named live candidates, never declared a confirmed choice.
   const words=s=>(s??'').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
   const named=(result,query)=>{const have=new Set(words(result.value.name));return words(query).every(t=>have.has(t));};
   const a=origins.results.find(r=>named(r,from)),b=destinations.results.find(r=>named(r,to));
   if(!a||!b){report.UNRESOLVED_INFORMATION.push(...(!a?['ORIGIN_STOP_NAME_NOT_ESTABLISHED']:[]),...(!b?['DESTINATION_STOP_NAME_NOT_ESTABLISHED']:[]));return finish('location-resolution','STOP_NAME_CLARIFICATION_REQUIRED');}
   report.RESOLUTION={policy:'FIRST_SOURCE_RANKED_CANDIDATES_UNCONFIRMED',origin:a,destination:b};
   profile.uncertainty.push('STATION_SELECTION_REQUIRES_CONFIRMATION','USER_TRAVEL_TIME_UNSPECIFIED');
   profile.constraints=profile.constraints.filter(q=>!['ORIGIN','DESTINATION'].includes(q.dimension));
   profile.constraints.push({dimension:'ORIGIN_ID',operator:'equals',value:sourceFact(a.value.id,a)},{dimension:'DESTINATION_ID',operator:'equals',value:sourceFact(b.value.id,b)});
   final=await read({providerId:provider.id,operation:'journeys',fromId:a.value.id,toId:b.value.id,results:3});
   report.UNRESOLVED_INFORMATION.push('TIME_NOT_SUPPLIED: live journey times are an API current snapshot, not a user constraint','STATION_CANDIDATES_NOT_USER_CONFIRMED');
  }else if(provider.id==='photon-places'){
   const near=value('NEAR'),location=value('LOCATION'),area=value('AREA');
   let anchor;
   if(near){
    const resolved=await read({providerId:provider.id,operation:'places',query:near,results:5});
    if(resolved.code==='PUBLIC_QUERY_NOT_ESTABLISHED')return finish('privacy',resolved.code);
    if(!resolved.results?.length)return finish('location-resolution','LIVE_ANCHOR_LOOKUP_EMPTY_OR_FAILED');
    const terms=near.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
    anchor=resolved.results.find(r=>{const words=(r.value.name??'').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[];return terms.every(t=>words.includes(t));});
    if(!anchor)return finish('location-resolution','PUBLIC_ANCHOR_NAME_UNRESOLVED');
    report.RESOLUTION={policy:'FIRST_SOURCE_RANKED_PUBLIC_ANCHOR_UNCONFIRMED',anchor};
    profile.location=sourceFact(anchor.value.location,anchor);profile.uncertainty.push('NEAR_RADIUS_NOT_SUPPLIED','ANCHOR_SELECTION_REQUIRES_CONFIRMATION');profile.constraints=profile.constraints.filter(q=>q.dimension!=='NEAR');
    report.UNRESOLVED_INFORMATION.push('NEAR_RADIUS_NOT_SUPPLIED','ANCHOR_SELECTION_UNCONFIRMED');
   }
   const category=value('CATEGORY')?.toLowerCase();
   const knownCategories=['cafe','park','garden','playground','museum','library'];
   const categoryDiscovery=Boolean(near&&knownCategories.includes(category));
   const searchTerm=knownCategories.includes(category)?category:term;
   if(categoryDiscovery&&term?.toLowerCase()!==category){
    profile.uncertainty.push('CATEGORY_DISCOVERY_TARGET_RELEVANCE_UNVERIFIED');
    report.UNRESOLVED_INFORMATION.push('CATEGORY_DISCOVERY_TARGET_RELEVANCE_UNVERIFIED');
   }
   report.QUERY_CONSTRUCTION={target:term,category,location,near,searchTerm,mode:categoryDiscovery?'CATEGORY_AT_SOURCE_RESOLVED_ANCHOR':'TARGET_AND_LOCATION'};
   const request={providerId:provider.id,operation:'places',query:[searchTerm,area,location].filter(Boolean).join(' '),results:20};
   if(knownCategories.includes(category))request.category=category;
   if(anchor)request.anchor={latitude:anchor.value.location.latitude,longitude:anchor.value.location.longitude};
   final=await read(request);
  }else if(provider.id==='govdata-catalog'){
   const query=[value('TOPIC')||term,value('LOCATION')].filter(Boolean).join(' ');
   const specialized=['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(report.STRATEGY);
   const request=specialized?require('./official-information-capabilities.cjs').officialCatalogRequest(route,provider,value('TOPIC')||term):{providerId:provider.id,operation:'datasets',query,queryMode:'all-terms',results:5};
   if(!request)return finish('query-plan','OFFICIAL_DISCOVERY_SCOPE_UNRESOLVED');
   final=await read(request);
   report.UNRESOLVED_INFORMATION.push('CATALOG_TOPIC_AND_GEOGRAPHIC_RELEVANCE_REQUIRE_REVIEW','DATASET_CONTENT_NOT_FETCHED');
  }else return finish('query-plan','UNSUPPORTED_END_TO_END_OPERATION');
 return {final};
}
module.exports={executeConnectedProvider};
