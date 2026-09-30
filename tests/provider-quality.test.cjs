'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicPageUrl,govDataSourceUrl}=require('../server/public-source-url.cjs');
const {searchGovData}=require('../server/providers/govdata-catalog-provider.cjs');
const {searchPhoton}=require('../server/providers/photon-places-provider.cjs');
const {normalizeJourneys}=require('../server/providers/bvg-journey-results.cjs');
const {buildPublicPlan}=require('../server/public-provider-plan.cjs');
const {resultView}=require('../server/beta-results.cjs');
const provenance={responseSha256:'a'.repeat(64),url:'https://www.govdata.de/ckan/api/3/action/package_search?q=x',requestedAt:'2026-09-30T10:00:00Z',retrievedAt:'2026-09-30T10:00:01Z',attribution:'Test source'};
test('display sources prefer publisher pages, retain legitimate query parameters and never expose retrieval endpoints',()=>{
 assert.equal(govDataSourceUrl({url:'https://publisher.de/view?id=42',name:'dataset'}),'https://publisher.de/view?id=42');
 for(const url of ['https://host.de/api/3/action/package_show','https://host.de/data.json','https://host.de/data?format=geojson','https://user:secret@host.de/page','https://127.0.0.1/page','https://[::1]/page','https://host.internal/page','https://host.de/page?api_key=secret']){
  assert.equal(publicPageUrl(url),null,url);assert.equal(govDataSourceUrl({url,name:'dataset'}),'https://www.govdata.de/suche/daten/dataset');
 }
 assert.equal(govDataSourceUrl({name:'../../evil'}),null);
 const report={status:'end-to-end-read-and-match',PROVIDER_SELECTED:'bvg-transport-v6',MATCHING_RESULT:[{result:{epistemicStatus:'SOURCE_DERIVED',value:{name:'Transit',entityType:'TRANSPORT_SERVICE'},provenance},match:{status:'unresolved'}}]};
 assert.deepEqual(resultView(report).cards[0].actions,[]);
});
test('GovData keeps retrieval provenance separate from the public catalogue page',async()=>{
 const r=await searchGovData({providerId:'govdata-catalog',operation:'datasets',query:'Fahrrad'},{transport:async()=>({status:'received',provenance,data:{success:true,result:{results:[{id:'record',name:'fahrrad-zahlung-zahlstellen',title:'Fahrrad',url:'https://host.de/data.json'}]}}})});
 assert.equal(r.results[0].value.sourceUrl,'https://www.govdata.de/suche/daten/fahrrad-zahlung-zahlstellen');assert.equal(r.results[0].provenance.url,provenance.url);assert.equal(r.results[0].epistemicStatus,'SOURCE_DERIVED');assert.equal(r.freshness.status,'UNVERIFIED');
});
test('punctuation-only catalogue query is blocked instead of throwing or searching broadly',()=>{
 assert.equal(buildPublicPlan({providerId:'govdata-catalog',operation:'datasets',query:'***',queryMode:'all-terms'}).code,'INVALID_PUBLIC_QUERY');
});
test('Photon deduplicates OSM identities while keeping private and foreign places excluded',async()=>{
 const feature=(id,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[13.41234,52.51234]},properties:{osm_id:id,osm_type:'N',osm_key:'amenity',osm_value:'cafe',name:'Cafe',countrycode:'DE',...extra}});
 const run=features=>searchPhoton({providerId:'photon-places',operation:'places',query:'cafe Berlin'},{transport:async()=>({status:'received',provenance,data:{type:'FeatureCollection',features}})});
 const r=await run([feature(1),feature(1),feature(2,{countrycode:'GR'}),feature(3,{osm_key:'building',osm_value:'house'})]);
 assert.equal(r.results.length,1);assert.equal(r.omitted,3);assert.equal(r.results[0].value.sourceUrl,'https://www.openstreetmap.org/node/1');assert.equal(r.results[0].value.location.precision,'approximate');assert.equal((await run([feature(-1)])).code,'INVALID_PLACE');
});
test('BVG refuses disconnected legs and keeps valid current-snapshot journeys unverified',()=>{
 const leg=(from,to,minute)=>({origin:{id:from,name:from},destination:{id:to,name:to},departure:`2026-09-30T10:${minute}:00Z`,arrival:`2026-09-30T10:${Number(minute)+5}:00Z`,line:{name:'U2'}});
 const run=legs=>normalizeJourneys({journeys:[{legs}]},provenance,{fromId:'900100001',toId:'900100003'},{status:'UNVERIFIED',issues:[]});
 const r=run([leg('900100001','900100002','10'),leg('900100002','900100003','20')]);assert.equal(r.results.length,1);assert.equal(r.results[0].value.timeBasis,'API_DEFAULT_CURRENT_SNAPSHOT_NOT_USER_TIME');
 assert.equal(run([leg('900100001','900100002','10'),leg('900100004','900100003','20')]).code,'DISCONNECTED_JOURNEY');
});
