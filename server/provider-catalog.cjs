'use strict';
// Reviewed 2026-09-16. Metadata is operational policy, never a truth certificate.
const common={readOnly:true,apiKeyRequired:false,cost:'FREE_PUBLIC_ACCESS',policyReviewedAt:'2026-09-16',actionAuthority:'NONE'};
const expansion=[
 {...common,id:'photon-places',baseUrl:'https://photon.komoot.io',region:'Germany (DE filter); source worldwide',strategies:['PLACE_SEARCH'],operations:['places'],capabilities:['PLACE_DATA','LOCAL_SCOPE','LOCATION_FILTER','SOURCE_ATTRIBUTION'],freshnessMaxAgeMs:null,
  coverage:{countries:['DE'],complete:false},freshness:{kind:'MAP_SNAPSHOT',sourceTimestampAvailable:false,claim:'Retrieval time is not map verification time'},
  usage:{minimumIntervalMs:2000,maxRequestsPerProcess:30,cacheTtlMs:300000,policy:'Reasonable usage only; no availability guarantee; extensive usage may be blocked. Local cap is PSAKSI policy, not a provider quota.'},
  privacy:'Only explicitly approved public non-personal place queries; no private coordinates, reverse lookup, autocomplete or tracking. Results rounded to 0.01 degrees.',
  provenance:{publisher:'komoot Photon / OpenStreetMap contributors',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',licenseUrl:'https://www.openstreetmap.org/copyright'},
  sourceUrl:'https://photon.komoot.io',policyUrl:'https://github.com/komoot/photon#demo-server',documentationUrl:'https://github.com/komoot/photon/blob/master/docs/api-v1.md',
  reliability:{role:'MAP_DISCOVERY_ONLY',guarantee:false,fallback:'Return unavailable; no silent alternate source or invented places.'}},
 {...common,id:'govdata-catalog',baseUrl:'https://www.govdata.de',region:'Germany public data catalogue',domains:['GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'],sourceType:'OFFICIAL_METADATA_CATALOG',classification:['OFFICIAL','OPEN_DATA','CATALOG'],authentication:'NONE',informationForms:['CATALOG_DISCOVERY'],geographicScope:{countries:['DE'],namedLocations:{Berlin:'DE'},complete:false},strategies:['GENERAL_INFORMATION','GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'],operations:['datasets'],capabilities:['INFORMATION_DATA','SOURCE_ATTRIBUTION','GOVERNMENT_SERVICES','HOUSING_INTELLIGENCE'],freshnessMaxAgeMs:null,
  coverage:{countries:['DE'],complete:false},freshness:{kind:'CATALOG_METADATA',sourceTimestampAvailable:'WHEN_PUBLISHED',claim:'Metadata modification is not underlying dataset freshness'},
  usage:{minimumIntervalMs:2000,maxRequestsPerProcess:30,cacheTtlMs:300000,policy:'No numeric public quota established in reviewed documentation. Conservative local cap; obey Retry-After, no bulk harvesting.'},
  privacy:'Explicit public topic query only. No personal Need text. No linked datasets downloaded or personal records ingested.',
  provenance:{publisher:'GovData and contributing public bodies',license:'PER_DATASET',attribution:'GovData; originating publisher and returned license retained',licenseUrl:'https://www.govdata.de/suche/daten/govdata-metadatenkatalog'},
  sourceUrl:'https://www.govdata.de',policyUrl:'https://www.govdata.de/suche/daten/govdata-metadatenkatalog',documentationUrl:'https://www.govdata.de/sparql-assistent',
  reliability:{role:'OFFICIAL_CATALOG_DISCOVERY',guarantee:false,fallback:'No automatic fallback; linked data needs separate license/freshness review.'}}
];
const bvgMetadata={policyReviewedAt:'2026-09-16',coverage:{countries:['DE'],region:'Berlin-Brandenburg and some long-distance services',complete:false},freshness:{kind:'REALTIME_FEED',sourceTimestampAvailable:true},usage:{policy:'Public limit documented as 100 requests/minute; existing adapter unchanged'},privacy:'Public station query/ID only; explicit scoped read',provenance:{publisher:'BVG data via transport.rest third-party wrapper',license:'Review upstream terms before redistribution',attribution:'BVG via v6.bvg.transport.rest'},sourceUrl:'https://v6.bvg.transport.rest',policyUrl:'https://v6.bvg.transport.rest',documentationUrl:'https://v6.bvg.transport.rest/api.html',reliability:{role:'CURRENT_DEPARTURES',guarantee:false,fallback:'No silent fallback'}};
module.exports={expansion,bvgMetadata};
