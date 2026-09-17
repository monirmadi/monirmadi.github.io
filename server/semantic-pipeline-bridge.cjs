'use strict';
// Semantic Pipeline Bridge: Connects Universal Extractor output to Semantic Assessor.
// Preserves: worldVerification: 'UNVERIFIED', actionAuthority: 'NONE'.

const { sourceFingerprint } = require('../contracts/interpretation-boundary.cjs');
const { proposalFingerprint, validateSemanticClaims } = require('../contracts/semantic-claim-boundary.cjs');
const { runSemanticAssessor } = require('../contracts/semantic-assessor-runner.cjs');

function buildDefaultClaims(intent, textReferences, sourceFp) {
  const claims = [];
  const entities = new Set(intent.entities.map(e => e.id));
  const actions = new Set(intent.actions.map(a => a.id));

  function findEvidenceIndexes(target) {
    const indexes = [];
    textReferences.forEach((ref, idx) => {
      if (ref.target === target) indexes.push(idx);
    });
    return indexes;
  }

  // 1. Entity claims
  intent.entities.forEach((entity, eIdx) => {
    const kindTarget = `/interpretation/intent/entities/${eIdx}/kind`;
    if (entity.kind?.state === 'known') {
      const eIdxs = findEvidenceIndexes(kindTarget);
      if (eIdxs.length > 0) {
        claims.push({
          id: `c-entity-${entity.id}-kind`,
          target: kindTarget,
          subjects: [entity.id],
          actions: [],
          predicate: 'entity kind',
          value: entity.kind.value,
          roles: [],
          evidenceIndexes: eIdxs,
          polarity: 'positive',
          negationScope: [],
          modality: 'asserted',
          attribution: { kind: 'user', reporterEntityId: null },
          epistemicBasis: 'user-assertion',
          certainty: null,
          meaningState: 'proposed',
          time: [],
          location: []
        });
      }
    }

    const descTarget = `/interpretation/intent/entities/${eIdx}/description`;
    if (entity.description?.state === 'known') {
      const eIdxs = findEvidenceIndexes(descTarget);
      if (eIdxs.length > 0) {
        claims.push({
          id: `c-entity-${entity.id}-desc`,
          target: descTarget,
          subjects: [entity.id],
          actions: [],
          predicate: 'entity description',
          value: entity.description.value,
          roles: [],
          evidenceIndexes: eIdxs,
          polarity: 'positive',
          negationScope: [],
          modality: 'asserted',
          attribution: { kind: 'user', reporterEntityId: null },
          epistemicBasis: 'user-assertion',
          certainty: null,
          meaningState: 'proposed',
          time: [],
          location: []
        });
      }
    } else if (entity.description?.state === 'ambiguous') {
      entity.description.candidates.forEach((cand, cIdx) => {
        const candTarget = `/interpretation/intent/entities/${eIdx}/description/candidates/${cIdx}`;
        const eIdxs = findEvidenceIndexes(candTarget);
        if (eIdxs.length > 0) {
          claims.push({
            id: `c-entity-${entity.id}-cand-${cIdx}`,
            target: candTarget,
            subjects: [entity.id],
            actions: [],
            predicate: 'candidate description',
            value: cand.value,
            roles: [],
            evidenceIndexes: eIdxs,
            polarity: 'positive',
            negationScope: [],
            modality: 'possible',
            attribution: { kind: 'user', reporterEntityId: null },
            epistemicBasis: 'user-assertion',
            certainty: null,
            meaningState: 'ambiguous',
            time: [],
            location: []
          });
        }
      });
    }
  });

  // 2. Action claims
  intent.actions.forEach((action, aIdx) => {
    const verbTarget = `/interpretation/intent/actions/${aIdx}/verb`;
    if (action.verb?.state === 'known') {
      const eIdxs = findEvidenceIndexes(verbTarget);
      if (eIdxs.length > 0) {
        claims.push({
          id: `c-action-${action.id}-verb`,
          target: verbTarget,
          subjects: action.entityIds.filter(id => entities.has(id)),
          actions: [action.id],
          predicate: 'action verb',
          value: action.verb.value,
          roles: [],
          evidenceIndexes: eIdxs,
          polarity: 'positive',
          negationScope: [],
          modality: 'asserted',
          attribution: { kind: 'user', reporterEntityId: null },
          epistemicBasis: 'user-assertion',
          certainty: null,
          meaningState: 'proposed',
          time: [],
          location: []
        });
      }
    }
  });

  // 3. Role claims
  intent.roles.forEach((role, rIdx) => {
    const roleTarget = `/interpretation/intent/roles/${rIdx}/role`;
    if (role.role?.state === 'known' && entities.has(role.participantId) && actions.has(role.actionId)) {
      const eIdxs = findEvidenceIndexes(roleTarget);
      if (eIdxs.length > 0) {
        claims.push({
          id: `c-role-${role.id}`,
          target: roleTarget,
          subjects: [role.participantId],
          actions: [role.actionId],
          predicate: 'participant role',
          value: role.role.value,
          roles: [{ entityId: role.participantId, actionId: role.actionId, role: role.role.value }],
          evidenceIndexes: eIdxs,
          polarity: 'positive',
          negationScope: [],
          modality: 'asserted',
          attribution: { kind: 'user', reporterEntityId: null },
          epistemicBasis: 'user-assertion',
          certainty: null,
          meaningState: 'proposed',
          time: [],
          location: []
        });
      }
    }
  });

  // 4. Constraint claims (including negation / exclusion)
  intent.constraints.forEach((constraint, cIdx) => {
    const valTarget = `/interpretation/intent/constraints/${cIdx}/value`;
    if (constraint.value?.state === 'known') {
      const eIdxs = findEvidenceIndexes(valTarget);
      if (eIdxs.length > 0) {
        const isExclusion = constraint.operator === 'excludes';
        const proximityAction = constraint.dimension.toUpperCase() === 'NEAR' ? intent.actions.find(a => a.id === constraint.subjectId && a.verb?.state === 'known' && a.verb.value === 'FIND') : null;
        const claimId = `c-constraint-${constraint.id}`;
        claims.push({
          id: claimId,
          target: valTarget,
          subjects: entities.has(constraint.subjectId) ? [constraint.subjectId] : proximityAction ? proximityAction.entityIds.filter(id => entities.has(id)) : [],
          actions: actions.has(constraint.subjectId) ? [constraint.subjectId] : [],
          predicate: `constraint ${constraint.dimension} ${constraint.operator}`,
          value: constraint.value.value,
          roles: [],
          evidenceIndexes: eIdxs,
          polarity: isExclusion ? 'negative' : 'positive',
          negationScope: isExclusion ? [claimId] : [],
          modality: isExclusion ? 'hypothetical' : proximityAction ? 'wanted' : 'asserted',
          attribution: { kind: 'user', reporterEntityId: null },
          epistemicBasis: 'user-assertion',
          certainty: null,
          meaningState: 'proposed',
          time: constraint.dimension.toUpperCase() === 'TIME' ? [{ kind: 'event', expression: constraint.value.value, anchor: sourceFp }] : [],
          location: constraint.dimension.toUpperCase() === 'LOCATION' ? [{ kind: 'mentioned', expression: constraint.value.value, entityId: null }] : []
        });
      }
    }
  });

  // Context domains influence routing and must be assessed independently too.
  (intent.domains ?? []).forEach((domain, index) => {
    const target = `/interpretation/intent/domains/${index}/context`;
    const evidenceIndexes = findEvidenceIndexes(target);
    if (domain.context?.state === 'known' && evidenceIndexes.length) claims.push({
      id: `c-domain-${domain.id}`, target, subjects: domain.entityIds, actions: [],
      predicate: 'domain context', value: domain.context.value, roles: [], evidenceIndexes,
      polarity: 'positive', negationScope: [], modality: 'asserted',
      attribution: {kind: 'user', reporterEntityId: null}, epistemicBasis: 'user-assertion',
      certainty: null, meaningState: 'proposed', time: [], location: []
    });
  });

  return claims;
}

function buildDefaultGroups(claims, intent) {
  const groups = [];
  const claimIds = new Set(claims.map(c => c.id));

  // Ambiguous candidates group
  const candClaimIds = claims.filter(c => c.id.includes('-cand-')).map(c => c.id);
  if (candClaimIds.length >= 2) {
    groups.push({
      id: 'g-candidates-alternative',
      kind: 'alternative',
      claimIds: candClaimIds
    });
  }

  // Exclusion group
  const exclusionClaims = claims.filter(c => c.polarity === 'negative');
  const positiveActionClaims = claims.filter(c => c.actions.length > 0 && c.polarity === 'positive');
  if (exclusionClaims.length > 0 && positiveActionClaims.length > 0) {
    const gClaimIds = [positiveActionClaims[0].id, exclusionClaims[0].id];
    if (gClaimIds.every(id => claimIds.has(id))) {
      groups.push({
        id: 'g-action-exclusion',
        kind: 'exclusion',
        claimIds: gClaimIds
      });
    }
  }

  return groups;
}

function buildSemanticEnvelope({
  source,
  proposal,
  textReferences,
  assessor,
  claims = null,
  groups = null
}) {
  if (!source || !proposal || !Array.isArray(textReferences) || !assessor) {
    throw new Error('INVALID_BUILD_ENVELOPE_INPUT');
  }

  const sFp = sourceFingerprint(source);
  const pFp = proposalFingerprint(proposal, textReferences);

  const finalClaims = claims || buildDefaultClaims(proposal.need.interpretation.intent, textReferences, sFp);
  const finalGroups = groups || buildDefaultGroups(finalClaims, proposal.need.interpretation.intent);

  return {
    version: 1,
    sourceFingerprint: sFp,
    proposalFingerprint: pFp,
    assessor: { id: assessor.id, version: assessor.version },
    claims: finalClaims,
    groups: finalGroups
  };
}

async function assessExtractedIntent(extractionResult, assessor, options = {}) {
  const fail = (stage, code, diagnostic = null) => ({
    status: 'rejected',
    stage,
    code,
    ...(diagnostic ? { diagnostic } : {}),
    worldVerification: 'UNVERIFIED',
    actionAuthority: 'NONE'
  });

  if (!extractionResult || extractionResult.status !== 'verified') {
    return fail('input-verification', 'EXTRACTION_NOT_VERIFIED');
  }
  if (!assessor || typeof assessor.assess !== 'function' || !assessor.id || !assessor.version) {
    return fail('assessor-validation', 'INVALID_ASSESSOR');
  }

  const {
    source,
    proposal,
    expectedProvider,
    textReferences
  } = extractionResult;

  if (!source || !proposal || !expectedProvider || !Array.isArray(textReferences)) {
    return fail('input-verification', 'INCOMPLETE_EXTRACTION_BUNDLE');
  }

  let envelope;
  try {
    envelope = buildSemanticEnvelope({
      source,
      proposal,
      textReferences,
      assessor,
      claims: options.customClaims || null,
      groups: options.customGroups || null
    });
  } catch {
    return fail('envelope-builder', 'ENVELOPE_BUILD_FAILED');
  }

  // 1. Validate envelope through the strict semantic claim boundary
  const claimValidation = validateSemanticClaims(
    source,
    proposal,
    expectedProvider,
    textReferences,
    envelope,
    { id: assessor.id, version: assessor.version }
  );

  if (claimValidation.status !== 'valid-envelope') {
    return fail('semantic-claim-boundary', claimValidation.code);
  }

  // 2. Authorize evidence indices for runner
  const authorizedEvidenceIndexes = textReferences.map((_, i) => i);

  const runnerInput = {
    source,
    proposal,
    interpretationProvider: expectedProvider,
    evidence: textReferences,
    envelope,
    expectedAssessor: { id: assessor.id, version: assessor.version },
    policyVersion: options.policyVersion || '1',
    modelVersion: options.modelVersion || null,
    configVersion: options.configVersion || null,
    authorizedEvidenceIndexes
  };

  // 3. Execute runner
  const runResult = await runSemanticAssessor(runnerInput, assessor, {
    timeoutMs: options.timeoutMs || 5000,
    signal: options.signal
  });

  if (runResult.status !== 'assessed') {
    return {...fail('semantic-assessor-runner', runResult.code, runResult.diagnostic), envelope};
  }

  return {
    status: 'assessed',
    extraction: extractionResult,
    envelope,
    assessment: runResult.assessment,
    worldVerification: 'UNVERIFIED',
    actionAuthority: 'NONE'
  };
}

module.exports = {
  buildDefaultClaims,
  buildDefaultGroups,
  buildSemanticEnvelope,
  assessExtractedIntent
};
