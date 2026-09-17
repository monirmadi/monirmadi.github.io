'use strict';
const {getProvider}=require('./provider-registry.cjs');
const {BOUNDARY}=require('./psaksiconcepts.cjs');
function buildPublicPlan(r){
 const fail=code=>({...BOUNDARY,status:'blocked',code,executionAllowed:false});
 if(!r||Object.keys(r).some(k=>!['providerId','operation','query','results','category','anchor','queryMode','capability','country'].includes(k)))return fail('INVALID_REQUEST');
 const p=getProvider(r.providerId),n=r.results??5;
 if(!['photon-places','govdata-catalog'].includes(p?.id)||!p.operations.includes(r.operation))return fail('UNSUPPORTED_OPERATION');
 if(r.capability!==undefined||r.country!==undefined){
  if(p.id!=='govdata-catalog'||!['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'].includes(r.capability)||!p.capabilities.includes(r.capability))return fail('UNSUPPORTED_CAPABILITY');
  if(!p.geographicScope?.countries.includes(r.country))return fail('UNSUPPORTED_GEOGRAPHIC_SCOPE');
 }
 if(typeof r.query!=='string'||!r.query.trim()||r.query.length>120||/[\x00-\x1f@]|https?:\/\//i.test(r.query))return fail('INVALID_PUBLIC_QUERY');
 if(!Number.isInteger(n)||n<1||n>(p.id==='photon-places'?20:5))return fail('INVALID_RESULTS');
 if(r.providerId!=='photon-places'&&(r.category!==undefined||r.anchor!==undefined))return fail('INVALID_REQUEST');
 if(r.category!==undefined&&!['cafe','park','garden','playground','museum','library'].includes(r.category))return fail('UNSUPPORTED_PUBLIC_CATEGORY');
 if(r.anchor!==undefined){const a=r.anchor;if(!a||Object.keys(a).sort().join('|')!=='latitude|longitude'||![a.latitude,a.longitude].every(Number.isFinite)||Math.abs(a.latitude)>90||Math.abs(a.longitude)>180||[a.latitude,a.longitude].some(v=>Math.abs(v*100-Math.round(v*100))>1e-7))return fail('APPROXIMATE_PUBLIC_ANCHOR_REQUIRED');}
 if(r.queryMode!==undefined&&(r.providerId!=='govdata-catalog'||r.queryMode!=='all-terms'))return fail('INVALID_QUERY_MODE');
 const query=r.query.trim();
 const path=p.id==='photon-places'?'/api/':'/ckan/api/3/action/package_search';
 const params=p.id==='photon-places'?{q:query,limit:String(n),lang:'de',countrycode:'DE'}:{q:'"'+query.replace(/["\\]/g,' ')+'"',rows:String(n),start:'0'};
 if(r.queryMode==='all-terms')params.q=query.match(/[\p{L}\p{N}]+/gu).map(term=>'\"'+term+'\"').join(' AND ');
 if(r.category!==undefined)params.osm_tag=({cafe:'amenity:cafe',park:'leisure:park',garden:'leisure:garden',playground:'leisure:playground',museum:'tourism:museum',library:'amenity:library'})[r.category];
 if(r.anchor!==undefined){params.lat=String(r.anchor.latitude);params.lon=String(r.anchor.longitude);}
 return {...BOUNDARY,status:'planned',executionAllowed:false,providerId:p.id,operation:r.operation,method:'GET',path,params,request:structuredClone(r)};
}
module.exports={buildPublicPlan};
