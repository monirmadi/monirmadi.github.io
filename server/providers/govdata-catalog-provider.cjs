'use strict';
const {readPublic}=require('../public-provider-http.cjs');
const {sourceKnowledge,BOUNDARY}=require('../psaksiconcepts.cjs');
function metadataTime(value,at){
 // CKAN naive metadata timestamps are deliberately NOT assumed to be UTC.
 const t=typeof value==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
 return {raw:typeof value==='string'?value:null,interpretedAt:Number.isFinite(t)?new Date(t).toISOString():null,status:!Number.isFinite(t)?'UNKNOWN_TIMEZONE_OR_MISSING':t>at+30000?'FUTURE_TIMESTAMP':'METADATA_ONLY'};
}
async function searchGovData(request,{transport=readPublic}={}){
 if(request?.providerId!=='govdata-catalog')return {...BOUNDARY,status:'failed',code:'INVALID_PROVIDER'};
 const plan=require('../public-provider-plan.cjs').buildPublicPlan(request);if(plan.status!=='planned')return plan;
 const response=await transport(request);if(response.status!=='received')return response;
 const {data,provenance}=response;
 if(data?.success!==true||!Array.isArray(data.result?.results)||data.result.results.length>100)return {...BOUNDARY,status:'failed',code:'INVALID_CATALOG'};
 const results=[];
 for(const [i,d] of data.result.results.entries()){
  if(typeof d?.id!=='string'||typeof d.title!=='string')return {...BOUNDARY,status:'failed',code:'INVALID_DATASET'};
  const time=metadataTime(d.metadata_modified,Date.parse(provenance.retrievedAt));
  let sourceUrl=null;try{const u=new URL(d.url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search)sourceUrl=u.href;}catch{}
  results.push(sourceKnowledge({id:d.id,name:d.title,...(typeof d.notes==='string'?{description:d.notes.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,400)}:{}),entityType:'INFORMATION_RESOURCE',publisher:typeof d.organization?.title==='string'?d.organization.title:null,licenseId:typeof d.license_id==='string'?d.license_id:null,metadataTime:time,resourceCount:Array.isArray(d.resources)?d.resources.length:null,availability:null,sourceReference:d.id,sourceUrl,geographicInformation:typeof d.spatial==='string'?d.spatial.slice(0,4000):null,...(request.capability?{requestedCapability:request.capability,informationForm:'CATALOG_DISCOVERY',topicAndGeographyVerified:false}:{})},{...provenance,jsonPointer:`/result/results/${i}`,sourceUpdatedAt:time.interpretedAt}));
 }
 return {...BOUNDARY,status:results.length?'source-results':'no-results',epistemicStatus:'SOURCE_DERIVED',results,provenance,clock:response.clock,fromCache:response.fromCache,freshness:{status:'UNVERIFIED',basis:'CATALOG_METADATA_ONLY',issues:['DATASET_CONTENT_NOT_FETCHED','METADATA_TIME_IS_NOT_DATA_FRESHNESS']}};
}
module.exports={searchGovData,metadataTime};
