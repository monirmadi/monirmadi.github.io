'use strict';
const provider=Object.freeze({id:'bvg-transport-v6',baseUrl:'https://v6.bvg.transport.rest',region:'Berlin-Brandenburg',readOnly:true,apiKeyRequired:false,cost:'NO_PAID_PACKAGE',strategies:Object.freeze(['TRANSPORT_STATUS','TRANSPORT_SEARCH']),operations:Object.freeze(['locations','departures','journeys']),capabilities:Object.freeze(['TRANSPORT_DATA','CURRENT_DATA','SOURCE_TIMESTAMP','LOCAL_SCOPE','LOCATION_FILTER']),freshnessMaxAgeMs:120000});
const {expansion,bvgMetadata}=require('./provider-catalog.cjs');
function listProviders(){return structuredClone([{...provider,...bvgMetadata},...expansion]);}
function getProvider(id){return listProviders().find(p=>p.id===id)||null;}
module.exports={listProviders,getProvider};
