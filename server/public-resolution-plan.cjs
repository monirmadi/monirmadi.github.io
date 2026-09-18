'use strict';
// A plan explains an assessed need. It never authorizes a provider call,
// participant disclosure, publication, contact, or background monitoring.
const {validateResolutionNeed}=require('../contracts/need-resolution.cjs');
function publicResolutionPlan(report){
 if(report.SEMANTIC_GATE?.semanticReady!==true||report.RESOLUTION_INTELLIGENCE?.status!=='INTERPRETED')return null;
 const checked=validateResolutionNeed(report.RESOLUTION_INTELLIGENCE.need);
 if(!checked.valid)return null;
 const n=checked.need;
 return {
  classification:'INTERPRETED',userConfirmed:false,resolved:false,
  executionAllowed:false,communicationAuthorized:false,monitoringEnabled:false,
  components:n.components.map(c=>({id:c.id,target:c.target,kind:c.capability,quantity:c.quantity,
   dependsOn:[...c.dependsOn],status:'NOT_SEARCHED'})),
  constraints:n.constraints.map(c=>({dimension:c.dimension,operator:c.operator,value:c.value,
   unit:c.unit,componentIds:[...c.componentIds],confirmed:c.confirmed})),
  missingInformation:[...n.missingInformation],
 };
}
function compositeMessage(plan,locale='en'){
 const language=locale.split('-')[0];
 const parts=plan.components.map(c=>c.target).join(' / ');
 if(language==='ar')return `فهمت أن طلبك يتضمن: ${parts}. هذه أجزاء من حاجة واحدة، ويجب الحفاظ على شروطها معًا. لم أبحث هذه الأجزاء بعد ولم أجد حلًا كاملًا. يمكنك تحديد الجزء الذي تريد البدء به في طلب جديد، أو مراجعة الطلب كاملًا وحفظه بشكل خاص في مساحتي. الحفظ لا ينشره ولا يتواصل مع أحد ولا يفعّل متابعة تلقائية.`;
 if(language==='de')return `Dein Anliegen umfasst: ${parts}. Diese Teile gehören zusammen; ihre Bedingungen müssen erhalten bleiben. Die Teile wurden noch nicht durchsucht und es wurde keine vollständige Lösung gefunden. Starte eine neue Anfrage mit dem Teil, den du zuerst bearbeiten möchtest, oder prüfe und speichere das ganze Anliegen privat in My Space. Speichern veröffentlicht nichts, kontaktiert niemanden und aktiviert keine Überwachung.`;
 return `I understood these parts of your need: ${parts}. They belong together and their conditions must be preserved. These parts have not been searched and no complete solution has been found. Start a new request with the part you want to address first, or review and save the whole request privately in My Space. Saving does not publish it, contact anyone, or enable monitoring.`;
}
module.exports={publicResolutionPlan,compositeMessage};
