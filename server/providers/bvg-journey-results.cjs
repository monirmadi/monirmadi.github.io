'use strict';
const {sourceKnowledge,BOUNDARY}=require('../psaksiconcepts.cjs');
const parse=v=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
function normalizeJourneys(data,provenance,request,freshness){
 const fail=code=>({...BOUNDARY,status:'failed',code});
 if(!Array.isArray(data?.journeys)||data.journeys.length>100)return fail('INVALID_JOURNEYS');
 const results=[];
 for(const [index,j]of data.journeys.entries()){
  if(!Array.isArray(j?.legs)||!j.legs.length||j.legs.length>30)return fail('INVALID_JOURNEY_LEGS');
  const legs=[];let previous=-Infinity;
  for(const l of j.legs){
   const dep=parse(l.departure??l.plannedDeparture),arr=parse(l.arrival??l.plannedArrival);
   if(!Number.isFinite(dep)||!Number.isFinite(arr)||arr<dep||dep<previous||typeof l.origin?.id!=='string'||typeof l.destination?.id!=='string')return fail('INCONSISTENT_JOURNEY');previous=arr;
   legs.push({originId:l.origin.id,originName:l.origin.name??null,destinationId:l.destination.id,destinationName:l.destination.name??null,departure:l.departure??l.plannedDeparture,arrival:l.arrival??l.plannedArrival,line:l.line?.name??null,walking:l.walking===true,cancelled:l.cancelled===true});
  }
  const first=legs[0],last=legs.at(-1),departure=parse(first.departure);
  if(departure<Date.parse(provenance.requestedAt)-120000||departure>Date.parse(provenance.retrievedAt)+86400000){freshness.status='UNVERIFIED';freshness.issues.push('JOURNEY_OUTSIDE_CURRENT_SNAPSHOT_WINDOW');}
  results.push(sourceKnowledge({id:'journey-'+index,entityType:'TRANSPORT_SERVICE',originId:first.originId,destinationId:last.destinationId,departure:first.departure,arrival:last.arrival,durationSeconds:(parse(last.arrival)-departure)/1000,legs,cancelled:legs.some(l=>l.cancelled),requestedEndpoints:{fromId:request.fromId,toId:request.toId},timeBasis:'API_DEFAULT_CURRENT_SNAPSHOT_NOT_USER_TIME'},{...provenance,jsonPointer:`/journeys/${index}`,sourceUpdatedAt:freshness.sourceUpdatedAt}));
 }
 return {...BOUNDARY,status:!results.length?'no-results':freshness.status==='FRESH'?'source-results':'unverified-results',epistemicStatus:'SOURCE_DERIVED',results,provenance,freshness,unresolvedInformation:['USER_TRAVEL_TIME_UNSPECIFIED'],requestPolicy:'EXPLORATORY_CURRENT_SNAPSHOT'};
}
module.exports={normalizeJourneys};
