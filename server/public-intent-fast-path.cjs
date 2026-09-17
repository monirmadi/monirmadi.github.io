'use strict';
const {compileExtraction}=require('./local-language-runtime.cjs');
const {buildDefaultClaims,buildDefaultGroups}=require('./semantic-pipeline-bridge.cjs');
const {sourceFingerprint}=require('../contracts/interpretation-boundary.cjs');
const {isDeepStrictEqual}=require('node:util');
// Closed public vocabulary, not fuzzy keyword matching. Unconsumed words fail to the heavy path.
const CATEGORIES={cafe:['coffee','cafe','café','caffe','kaffee','kaffeehaus','مقهى','مقاهي','قهوة'],park:['park','parks','حديقة'],museum:['museum','متحف'],library:['library','bibliothek','مكتبة'],garden:['garden','garten','حدائق'],playground:['playground','spielplatz','ملعب أطفال']};
const PLACES={Berlin:['berlin','برلين'],Potsdam:['potsdam','بوتسدام'],Hamburg:['hamburg','هامبورغ'],München:['münchen','munich','ميونخ'],Köln:['köln','cologne','كولونيا'],Frankfurt:['frankfurt','فرانكفورت'],Leipzig:['leipzig','لايبزيغ'],Dresden:['dresden','دريسدن'],Bremen:['bremen','بريمن'],Hannover:['hannover','هانوفر'],Stuttgart:['stuttgart','شتوتغارت'],Düsseldorf:['düsseldorf','دوسلدورف'],Alexanderplatz:['alexanderplatz','ألكسندر بلاتس','الكسندر بلاتس'],'Berlin Hauptbahnhof':['berlin hauptbahnhof','محطة برلين الرئيسية'],'Potsdam Hauptbahnhof':['potsdam hauptbahnhof']};
const LANDMARKS=new Set(['Alexanderplatz','Berlin Hauptbahnhof','Potsdam Hauptbahnhof']);
const TOPICS={Anmeldung:['anmeldung','residence registration','تسجيل السكن'],Reisepass:['passport','reisepass','جواز السفر'],Radverkehr:['cycling infrastructure','bicycle infrastructure','radverkehr','بنية الدراجات'],Abfall:['waste collection','abfall','جمع النفايات'],Schulen:['schools','schulen','المدارس']};
const AREAS={Neukölln:['neukölln','neukoelln','نويكولن','نويكولن'],Kreuzberg:['kreuzberg','كرويتسبرغ'],Mitte:['mitte','ميته'],Charlottenburg:['charlottenburg','شارلوتنبورغ'],Friedrichshain:['friedrichshain','فريدريشسهاين'],Wedding:['wedding','فيدينغ'],Spandau:['spandau','شبانداو'],Pankow:['pankow','بانكو'],'Prenzlauer Berg':['prenzlauer berg','برينسلاور بيرغ'],Tempelhof:['tempelhof','تمبلهوف'],Schöneberg:['schöneberg','schoeneberg','شونبيرغ'],Treptow:['treptow','تريبتو']};
const normalize=s=>s.trim().toLocaleLowerCase().replace(/\s+/gu,' ').replace(/[.?!؟]+$/u,'');
function lookup(table,text){const n=normalize(text);return Object.keys(table).find(k=>table[k].includes(n))??null;}
function location(text){const n=normalize(text);const m=n.match(/^(?:in|at|near|around|bei|in der nähe von|nahe|في|قريب من|بالقرب من)\s+(.+)$/u);const name=m?.[1]??n;
 if(['hauptbahnhof','main station','المحطة الرئيسية'].includes(name))return {value:'Hauptbahnhof',dimension:'NEAR',ambiguous:true};
 const station=name.match(/^(?:hauptbahnhof|main station|المحطة الرئيسية) (.+)$/u);
 const city=station&&lookup(PLACES,station[1]);
 const value=city&&!LANDMARKS.has(city)?city+' Hauptbahnhof':lookup(PLACES,name);if(!value)return null;return {value,dimension:LANDMARKS.has(value)||station||/^(?:near|around|in der nähe von|nahe|قريب من|بالقرب من) /u.test(n)?'NEAR':'LOCATION'};}
function parsePublicIntent(text){
 if(typeof text!=='string'||text.length>240||/[\n\r\d@:/\\<>]/u.test(text))return null;
 const n=normalize(text);if(!n)return null;
 const prefix=n.replace(/^(?:find(?: me)?(?: a| an)?|i want(?: a| an)?|i am looking for(?: a| an)?|ich suche(?: einen| ein| eine)?|suche(?: einen| ein| eine)?|ابحث عن|أبحث عن|بدي)\s+/u,'');
 for(const [category,words]of Object.entries(CATEGORIES))for(const word of words){
  if(prefix===word)return {family:'place',category,place:null,verb:'FIND',kind:'PLACE',term:category};
  if(prefix.startsWith(word+' ')){const rest=prefix.slice(word.length+1);const areaOnly=lookup(AREAS,rest.replace(/^(?:in|في) /u,''));if(areaOnly)return {family:'place',category,area:areaOnly,place:null,verb:'FIND',kind:'PLACE',term:category};const areaCity=rest.replace(/^(?:in|في) /u,'').match(/^(.+?)(?:,? (?:in|في))? (berlin|برلين)$/u);const area=areaCity&&lookup(AREAS,areaCity[1]);if(area)return {family:'place',category,place:{value:'Berlin',dimension:'LOCATION'},area,verb:'FIND',kind:'PLACE',term:category};const place=location(rest);if(place)return {family:'place',category,place,verb:'FIND',kind:'PLACE',term:category};}
 }
 const journey=n.match(/^(?:how do i get|take me|travel|go|route) from (.+) to (.+)$/u)||n.match(/^(?:wie komme ich|fahrt|reise) von (.+) nach (.+)$/u)||n.match(/^(?:كيف أصل|كيف أروح|كيف أذهب|بدي أروح|أريد الذهاب) من (.+) إلى (.+)$/u);
 if(journey){const origin=lookup(PLACES,journey[1]),destination=lookup(PLACES,journey[2]);if(origin&&destination)return {family:'transport',verb:'TRAVEL',kind:'TRANSPORT_SERVICE',term:'public transport',origin,destination};}
 const info=n.match(/^(?:find )?(?:(?:official|public) )?information (?:about|on) (.+) in (.+)$/u)||n.match(/^(?:offizielle|öffentliche) informationen (?:über|zu) (.+) in (.+)$/u)||n.match(/^(?:(?:ابحث عن|أبحث عن) )?معلومات (?:رسمية|عامة) عن (.+) في (.+)$/u);
 if(info){const topic=lookup(TOPICS,info[1]),place=location(info[2]);if(topic&&place?.dimension==='LOCATION')return {family:'information',verb:'ASK',kind:'INFORMATION_RESOURCE',term:topic,place};}
 return null;
}
function extraction(text,parsed){const field=value=>({value,quote:text});const q=(dimension,value)=>({dimension,operator:'equals',value:field(value)});return {action:field(parsed.verb),entity:{kind:field(parsed.kind),description:field(parsed.term)},constraints:[...(parsed.category?[q('CATEGORY',parsed.category)]:[]),...(parsed.area?[q('AREA',parsed.area)]:[]),...(parsed.place?[q(parsed.place.dimension,parsed.place.value)]:[]),...(parsed.origin?[q('ORIGIN',parsed.origin),q('DESTINATION',parsed.destination)]:[])],unresolved:[]};}
function parsePublicContext(turns){
 if(!Array.isArray(turns)||turns.length<1||turns.length>6||turns.some(t=>typeof t!=='string'||t.length>240))return null;
 let parsed=parsePublicIntent(turns[0]);if(!parsed)return null;
 for(const reply of turns.slice(1)){
  if(parsed.family!=='place')return null;
  const stripped=normalize(reply).replace(/^(?:only in|nur in|فقط في|in|at|im|في) /u,'');const area=lookup(AREAS,stripped);
  if(area&&parsed.place?.value==='Berlin'&&parsed.place.dimension==='LOCATION'){parsed={...parsed,area};continue;}
  const place=location(reply);if(!place)return null;parsed={...parsed,place};delete parsed.area;
 }
 return parsed;
}
function createPublicRuntime(input,{turns}={}){
 const parse=text=>turns&&turns.join('\n')===text?parsePublicContext(turns):parsePublicIntent(text);
 const parsed=parse(input);if(!parsed)return null;
 let expected=null;
 const extractor={id:'public-grammar-v1',version:'1',extract:async source=>{
  if(source.originalText!==input)throw Error('FAST_SOURCE_CHANGED');
  const fresh=parse(source.originalText);if(!isDeepStrictEqual(fresh,parsed))throw Error('FAST_SOURCE_CHANGED');
  const wire=compileExtraction(source,extraction(input,fresh),extractor);
  expected={claims:buildDefaultClaims(wire.need.interpretation.intent,wire.textReferences,sourceFingerprint(source)),groups:buildDefaultGroups(buildDefaultClaims(wire.need.interpretation.intent,wire.textReferences,sourceFingerprint(source)),wire.need.interpretation.intent),evidence:wire.textReferences.map((r,index)=>({index,text:r.quote,start:r.start,end:r.end}))};return wire;
 }};
 const assessor={id:'public-grammar-proof-v1',version:'1',assess:async payload=>{
  // Only the exact grammar-derived graph, including every relationship, may pass.
  if(!expected||!isDeepStrictEqual(payload.claims,expected.claims)||!isDeepStrictEqual(payload.groups,expected.groups)||!isDeepStrictEqual(payload.evidence,expected.evidence))throw Error('FAST_PROOF_MISMATCH');
  return {binding:payload.binding,claims:payload.claims.map(c=>({claimId:c.id,decision:'support',reasons:['evidence-support'],evidenceIndexes:c.evidenceIndexes})),graph:{decision:'support',reasons:['evidence-support'],evidenceIndexes:payload.evidence.map(e=>e.index),claimIds:payload.claims.map(c=>c.id)}};
 }};
 // Separate outbound check: closed public lexical scope, exact source-authorized fields.
 const privacyAssessor={review:async({input:original,request:r})=>{
  const p=parse(original);let safe=isDeepStrictEqual(p,parsed);
  const strings=[p?.term,p?.area,p?.place?.value,p?.origin,p?.destination].filter(Boolean);
  const allowed=new Set([...strings,[p?.term,p?.area,p?.place?.dimension==='LOCATION'?p.place.value:null].filter(Boolean).join(' ')]);
  if(r.operation==='journeys')safe&&=p.family==='transport'&&/^\d+$/.test(r.fromId)&&/^\d+$/.test(r.toId);
  else safe&&=allowed.has(r.query);
  const provider={place:'photon-places',transport:'bvg-transport-v6',information:'govdata-catalog'}[p?.family];
  safe&&=r.providerId===provider&&({place:['places'],transport:['locations','journeys'],information:['datasets']}[p?.family]??[]).includes(r.operation);
  safe&&=Object.keys(r).every(k=>['providerId','operation','query','results','category','anchor','queryMode','fromId','toId'].includes(k));
  safe&&=r.category===undefined||r.category===p.category;
  safe&&=r.results===undefined||Number.isInteger(r.results)&&r.results>=1&&r.results<=(p.family==='place'?20:5);
  if(r.anchor)safe&&=p?.place?.dimension==='NEAR'&&Object.keys(r.anchor).sort().join(',')==='latitude,longitude'&&[r.anchor.latitude,r.anchor.longitude].every(v=>Number.isFinite(v)&&Math.abs(v*100-Math.round(v*100))<1e-7);
  return {decision:safe?'PUBLIC_NON_PERSONAL':'UNCERTAIN'};
 }};
 return {requiresLocationClarification:parsed.place?.ambiguous===true,parsed,extractor,assessor,privacyAssessor,receipts:[],model:'DETERMINISTIC_PUBLIC_GRAMMAR',assessorTimeoutMs:1000};
}
module.exports={parsePublicIntent,parsePublicContext,createPublicRuntime,location};
