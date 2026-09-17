'use strict';
const {getProvider}=require('./provider-registry.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
function buildProviderPlan(request){
 const blocked=code=>({...BOUNDARY,status:'blocked',code,executionAllowed:false});
 if(['photon-places','govdata-catalog'].includes(request?.providerId))return require('./public-provider-plan.cjs').buildPublicPlan(request);
 if(!request||Object.keys(request).some(k=>!['providerId','operation','stopId','query','duration','results','fromId','toId'].includes(k)))return blocked('INVALID_REQUEST');
 const p=getProvider(request.providerId);
 if(!p||!p.operations.includes(request.operation))return blocked('UNSUPPORTED_OPERATION');
 const results=request.results??5;
 if(!Number.isInteger(results)||results<1||results>20)return blocked('INVALID_RESULTS');
 let path,params={results:String(results)};
 if(request.operation==='journeys'){
  if(![request.fromId,request.toId].every(v=>typeof v==='string'&&/^\d{6,12}$/.test(v))||request.fromId===request.toId||['query','stopId','duration'].some(k=>request[k]!==undefined))return blocked('INVALID_JOURNEY_ENDPOINTS');
  path='/journeys';params.from=request.fromId;params.to=request.toId;params.stopovers='false';
 }else if(request.fromId!==undefined||request.toId!==undefined)return blocked('INVALID_REQUEST');
 else if(request.operation==='locations'){
  if(typeof request.query!=='string'||!request.query.trim()||request.query.length>120||request.stopId!==undefined||request.duration!==undefined)return blocked('INVALID_QUERY');
  path='/locations';Object.assign(params,{query:request.query.trim(),stops:'true',addresses:'false',poi:'false'});
 }else{
  if(typeof request.stopId!=='string'||!/^\d{6,12}$/.test(request.stopId)||request.query!==undefined)return blocked('INVALID_STOP');
  const duration=request.duration??10;
  if(!Number.isInteger(duration)||duration<1||duration>60)return blocked('INVALID_DURATION');
  path=`/stops/${request.stopId}/departures`;params.duration=String(duration);
 }
 return {...BOUNDARY,status:'planned',executionAllowed:false,providerId:p.id,operation:request.operation,method:'GET',path,params,request:structuredClone(request)};
}
module.exports={buildProviderPlan};
