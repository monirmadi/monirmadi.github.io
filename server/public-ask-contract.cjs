'use strict';
const {createHash}=require('node:crypto');
const {resultView}=require('./beta-results.cjs');
const COPY={
 personPending:['Your need is to connect with a person. Matching with consenting participants is not available in this beta yet. You can sign in to My Space and save your request privately. Saving does not publish it, contact anyone or start monitoring.','Du möchtest eine passende Person finden. Die Vermittlung mit einwilligenden Teilnehmenden ist in dieser Beta noch nicht verfügbar. Du kannst dich in My Space anmelden und dein Anliegen privat speichern. Das veröffentlicht nichts, kontaktiert niemanden und startet keine Überwachung.','طلبك هو التواصل مع شخص مناسب. المطابقة مع أشخاص وافقوا على المشاركة غير متاحة في النسخة التجريبية بعد. يمكنك تسجيل الدخول إلى مساحتي وحفظ طلبك بشكل خاص. الحفظ لا ينشر الطلب ولا يتواصل مع أحد ولا يبدأ متابعة تلقائية.'],
 languageUnavailable:['This request is not supported yet. Try a simple public search such as “Café in Berlin” or “How do I get from Alexanderplatz to Potsdam?”. Additional conditions cannot yet be verified.','Diese Anfrage wird noch nicht unterstützt. Versuche eine einfache öffentliche Suche wie „Café in Berlin“. Zusätzliche Bedingungen können noch nicht überprüft werden.','هذا الطلب غير مدعوم بعد. جرّب بحثًا عامًا بسيطًا مثل «مقهى في برلين». لا يمكن التحقق من الشروط الإضافية حاليًا.'],
 results:['Here are source results for your need. Coverage is limited; review each source.','Hier sind Quellergebnisse zu deinem Anliegen. Die Abdeckung ist begrenzt; prüfe die Quellen.','هذه نتائج المصادر لحاجتك. التغطية محدودة؛ راجع كل مصدر.'],
 clarification:['Please clarify what you need or where to search.','Bitte präzisiere dein Anliegen oder den Suchort.','يرجى توضيح حاجتك أو مكان البحث.'],
 whereSearch:['In which city or area should I look?','In welcher Stadt oder Gegend soll ich suchen?','في أي مدينة أو منطقة تريد البحث؟'],
 areaQuestion:['Which area should I search in?','In welcher Gegend soll ich suchen?','في أي منطقة تريد البحث؟'],
 refineUnsupported:['That condition cannot be verified by the connected sources. Which supported detail would you like to change?','Diese Bedingung können die verbundenen Quellen nicht prüfen. Welche unterstützte Angabe möchtest du ändern?','لا تستطيع المصادر المتصلة التحقق من هذا الشرط. ما التفصيل المدعوم الذي تريد تغييره؟'],
 stopClarify:['Please provide the full origin and destination stop names.','Bitte nenne die vollständigen Start- und Zielhaltestellen.','يرجى ذكر اسمي محطتي الانطلاق والوصول كاملين.'],
 anchorClarify:['Please clarify the public place and its city.','Bitte präzisiere den öffentlichen Ort und seine Stadt.','يرجى توضيح المكان العام والمدينة.'],
 no_result:['No suitable source results were found. You can refine your need.','Keine passenden Quellergebnisse gefunden. Du kannst dein Anliegen präzisieren.','لم نجد نتائج مصادر مناسبة. يمكنك توضيح حاجتك.'],
 provider_unavailable:['The source is unavailable or its response could not be verified. Please try again later.','Die Quelle ist nicht verfügbar oder ihre Antwort konnte nicht geprüft werden. Bitte versuche es später erneut.','المصدر غير متاح أو تعذر التحقق من استجابته. حاول لاحقًا.'],
 unsupported:['This need is not supported by the connected sources yet.','Die verbundenen Quellen unterstützen dieses Anliegen noch nicht.','المصادر المتصلة لا تدعم هذه الحاجة بعد.'],
 invalid_request:['Check the request fields and try again.','Prüfe die Anfragefelder und versuche es erneut.','راجع حقول الطلب وحاول مجددًا.'],
 privacy_required:['Acknowledge the public-search privacy disclosure before searching.','Bestätige vor der Suche den Datenschutzhinweis zur öffentlichen Suche.','أقرّ بإفصاح خصوصية البحث العام قبل البحث.'],
 privacy_blocked:['This request cannot be shared with public sources. Rephrase without private details.','Diese Anfrage kann nicht mit öffentlichen Quellen geteilt werden. Formuliere sie ohne private Angaben.','لا يمكن مشاركة هذا الطلب مع المصادر العامة. أعد صياغته دون تفاصيل خاصة.'],
 conversation_expired:['This conversation is unavailable or expired. Start a new conversation.','Dieses Gespräch ist nicht verfügbar oder abgelaufen. Beginne ein neues Gespräch.','هذه المحادثة غير متاحة أو انتهت. ابدأ محادثة جديدة.'],
 conversation_limit:['This conversation reached its limit. Start a new conversation with your full need.','Dieses Gespräch hat sein Limit erreicht. Beginne ein neues mit deinem vollständigen Anliegen.','بلغت المحادثة حدها. ابدأ محادثة جديدة تتضمن حاجتك كاملة.'],
 conversation_busy:['Wait for the current reply before sending another message.','Warte auf die aktuelle Antwort, bevor du eine weitere Nachricht sendest.','انتظر الرد الحالي قبل إرسال رسالة أخرى.'],
 rate_limited:['Too many requests. Please try again later.','Zu viele Anfragen. Bitte versuche es später erneut.','طلبات كثيرة. حاول لاحقًا.'],
 temporarily_unavailable:['Search is temporarily unavailable. Please try again later.','Die Suche ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.','البحث غير متاح مؤقتًا. حاول لاحقًا.'],
 internal_error:['The request could not be completed. Please try again.','Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.','تعذر إكمال الطلب. حاول مجددًا.'],
 origin_not_allowed:['This origin is not allowed.','Dieser Ursprung ist nicht erlaubt.','هذا المصدر غير مسموح.'],
 method_not_allowed:['Use POST for this endpoint.','Verwende POST für diesen Endpunkt.','استخدم POST لهذا المسار.'],
 not_found:['Endpoint not found.','Endpunkt nicht gefunden.','المسار غير موجود.'],
 body_too_large:['The request is too large.','Die Anfrage ist zu groß.','الطلب أكبر من الحد المسموح.'],
 unsupported_media_type:['Send UTF-8 JSON.','Sende UTF-8-JSON.','أرسل JSON بترميز UTF-8.'],
 request_timeout:['The request took too long. Please try again.','Die Anfrage dauerte zu lange. Bitte versuche es erneut.','استغرق الطلب وقتًا طويلًا. حاول مجددًا.'],
 'change-location':['Change location','Ort ändern','تغيير المكان'],
 'change-area':['Choose an area','Gegend auswählen','اختيار منطقة'],
 'new-search':['Start a new search','Neue Suche starten','بدء بحث جديد']
};
function message(key,locale='en'){return (COPY[key]??COPY.internal_error)[({en:0,de:1,ar:2})[locale.split('-')[0]]??0];}
function envelope({conversationId=null,status='error',locale='en',key=status,results=[],resultType=null,refinements=[],canRefine=false,expiresAt=null,error=null}={}){
 return {version:1,conversationId,status,phase:'completed',message:message(key,locale),resultType,results,refinements,canRefine,expiresAt,error};
}
function errorResponse(code,locale='en',conversationId=null){return envelope({locale,conversationId,key:code,error:{code}});}
function httpsUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function publicResponse(report,{conversationId,locale,canRefine,expiresAt}){
 const {publicResolutionPlan,compositeMessage}=require('./public-resolution-plan.cjs');
 const plan=publicResolutionPlan(report);
 if(plan?.components.length>1&&['PERSON_MATCHING_NOT_CONNECTED','COMPOSITE_NEED_REQUIRES_COMPONENT_EVIDENCE_AND_INDEPENDENT_GATES'].includes(report.code))return {
  ...envelope({conversationId,locale,expiresAt,status:'unsupported',resultType:'COMPOSITE'}),
  message:compositeMessage(plan,locale),resolutionPlan:plan,nextAction:'open_account'
 };
 if(report.code==='PERSON_MATCHING_NOT_CONNECTED')return {...envelope({conversationId,locale,expiresAt,status:'unsupported',key:'personPending',resultType:'PERSON'}),nextAction:'open_account'};
 if(report.code==='PUBLIC_LANGUAGE_UNAVAILABLE')return envelope({conversationId,locale,expiresAt,status:'unsupported',key:'languageUnavailable'});
 if(report.code==='LOCAL_EXTRACTION_FAILED'||['extraction','semantic'].includes(report.stage)&&['EXTRACTOR_FAILED','ASSESSOR_FAILED','TIMEOUT','CANCELLED'].includes(report.code))return errorResponse('temporarily_unavailable',locale,conversationId);
 const view=resultView(report);
 // Only the existing evidence-filtered projection is eligible. Demo modules are never imported.
 const cards=['photon-places','bvg-transport-v6','govdata-catalog'].includes(report.PROVIDER_SELECTED)?view.cards:[];
 let status=cards.length?'results':view.status==='clarification'?'clarification':view.guidance==='sourceUnavailable'||view.guidance==='clock'?'provider_unavailable':view.guidance==='providerUnavailable'||report.stage==='resolution-planning'?'unsupported':view.guidance==='interpretation'?'clarification':'no_result';
 if(['authorization','input','privacy'].includes(report.stage))return errorResponse(report.stage==='privacy'?'privacy_blocked':'invalid_request',locale,conversationId);
 const results=cards.map(c=>{
  const url=httpsUrl(c.url),location=[c.address?.street,c.address?.houseNumber,c.address?.postcode,c.area,c.city].filter(Boolean).join(' · ')||null;
  const source={name:c.source,url,retrievedAt:c.retrievedAt,attribution:c.sourceDetails.attribution,classification:'SOURCE_DERIVED'};
  const result={id:createHash('sha256').update(JSON.stringify([c.type,c.title,location,url,c.departure,c.arrival])).digest('hex').slice(0,24),type:c.type,title:c.title,description:c.description,location,source,actions:url?[{type:'open_source',url}]:[],independentlyVerified:false};
  if(c.journey)result.journey={lines:c.lines,departure:c.departure,arrival:c.arrival};
  if(c.catalogOnly)result.catalogOnly=true;
  return result;
 });
 const key=status==='clarification'&&['whereSearch','areaQuestion','refineUnsupported','stopClarify','anchorClarify'].includes(view.guidance)?view.guidance:status;
 return envelope({conversationId,status,locale,key,results,resultType:results[0]?.type??null,canRefine,expiresAt,refinements:view.refinements.filter(id=>canRefine||id==='new-search').map(id=>({id,label:message(id,locale)}))});
}
module.exports={publicResponse,errorResponse};
