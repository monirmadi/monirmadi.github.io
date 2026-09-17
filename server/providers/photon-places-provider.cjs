'use strict';
const {readPublic}=require('../public-provider-http.cjs');
const {sourceKnowledge,BOUNDARY}=require('../psaksiconcepts.cjs');
const PUBLIC_POIS={tourism:['museum','gallery','attraction','viewpoint'],historic:['monument','memorial','city_gate','archaeological_site'],amenity:['cafe','library','townhall','theatre','community_centre','marketplace','fountain'],leisure:['park','garden','playground'],railway:['station','halt'],natural:['peak','beach','wood']};
const PUBLIC_AREAS=['city','town','village','suburb','locality','island','square'];
async function searchPhoton(request,{transport=readPublic}={}){
 if(request?.providerId!=='photon-places')return {...BOUNDARY,status:'failed',code:'INVALID_PROVIDER'};
 const response=await transport(request);if(response.status!=='received')return response;
 const {data,provenance}=response;
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>100)return {...BOUNDARY,status:'failed',code:'INVALID_PLACES'};
 const results=[];let omitted=0;
 for(const [i,f] of data.features.entries()){
  const p=f?.properties,c=f?.geometry?.coordinates;
  if(f?.type!=='Feature'||!p||f.geometry?.type!=='Point'||!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90||!Number.isSafeInteger(p.osm_id)||!['N','W','R'].includes(p.osm_type))return {...BOUNDARY,status:'failed',code:'INVALID_PLACE'};
  // Never return residential address records or silently accept foreign results.
  const publicPoi=Object.hasOwn(PUBLIC_POIS,p.osm_key)&&PUBLIC_POIS[p.osm_key].includes(p.osm_value);
  const publicArea=p.osm_key==='place'&&PUBLIC_AREAS.includes(p.osm_value)&&!p.housenumber;
  // Photon uses type=house for landmarks too. Only explicit public categories
  // qualify; street, house number and extent are never included in our output.
  if(typeof p.countrycode!=='string'||p.countrycode.toUpperCase()!=='DE'||typeof p.name!=='string'||(!publicPoi&&!publicArea)){omitted++;continue;}
  const type={N:'node',W:'way',R:'relation'}[p.osm_type];
  results.push(sourceKnowledge({id:`osm:${type}:${p.osm_id}`,name:p.name,entityType:'PLACE',countryCode:'DE',city:typeof p.city==='string'?p.city:null,area:typeof p.district==='string'?p.district:typeof p.locality==='string'?p.locality:null,address:publicPoi&&typeof p.street==='string'?{street:p.street.slice(0,160),...(typeof p.housenumber==='string'?{houseNumber:p.housenumber.slice(0,20)}:{}),...(typeof p.postcode==='string'?{postcode:p.postcode.slice(0,20)}:{})}:null,category:p.osm_value??null,location:{latitude:Math.round(c[1]*100)/100,longitude:Math.round(c[0]*100)/100,precision:'approximate',uncertaintyMeters:1000},sourceUrl:`https://www.openstreetmap.org/${type}/${p.osm_id}`},{...provenance,jsonPointer:`/features/${i}`,sourceUpdatedAt:null}));
 }
 return {...BOUNDARY,status:results.length?'source-results':'no-results',epistemicStatus:'SOURCE_DERIVED',results,omitted,provenance,clock:response.clock,fromCache:response.fromCache,freshness:{status:'UNVERIFIED',basis:'MAP_SNAPSHOT',sourceUpdatedAt:null,issues:['SOURCE_UPDATE_TIME_UNAVAILABLE','RETRIEVAL_IS_NOT_WORLD_FRESHNESS']}};
}
module.exports={searchPhoton};
