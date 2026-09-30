'use strict';
const {isIP}=require('node:net');
// Display links only. Never fetch provider-supplied URLs or reuse retrieval URLs.
function publicPageUrl(value){
 try{
  if(typeof value!=='string'||value.length>2048)return null;
  const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||isIP(host)||host.includes(':')||!host.includes('.')||/(^|\.)(localhost|local|internal|invalid|test)$/.test(host))return null;
  const path=decodeURIComponent(u.pathname);
  if(/(?:^|\/)(?:api|sparql|wfs|wms)(?:\/|$)|\.(?:json(?:ld)?|geojson|xml|rdf|ttl|csv|zip)$/i.test(path))return null;
  for(const [key,val] of u.searchParams){
   if(/^(?:token|api[_-]?key|access_token|authorization)$/i.test(key)||(/^(?:format|output|f)$/i.test(key)&&/json|xml|rdf|csv|ttl/i.test(val))||(/^service$/i.test(key)&&/wfs|wms/i.test(val)))return null;
  }
  return u.href;
 }catch{return null;}
}
function govDataSourceUrl(dataset){
 const supplied=publicPageUrl(dataset.url);if(supplied)return supplied;
 // CKAN's source-provided name is the public GovData dataset slug.
 return typeof dataset.name==='string'&&/^[a-z0-9][a-z0-9_-]{0,199}$/.test(dataset.name)?'https://www.govdata.de/suche/daten/'+encodeURIComponent(dataset.name):null;
}
module.exports={publicPageUrl,govDataSourceUrl};
