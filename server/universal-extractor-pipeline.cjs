'use strict';
// Safe Universal Intent Extractor pipeline coordinator.
// Enforces structural integrity and exact source-text grounding before emitting output.

const { emptyNeed } = require('../contracts/universal.cjs');
const { acceptProposal, sourceFingerprint } = require('../contracts/interpretation-boundary.cjs');
const { verifyTextEvidence } = require('../contracts/text-evidence-boundary.cjs');

async function extractUniversalIntent(sourceInput, extractor, options = {}) {
  let source;
  if (typeof sourceInput === 'string') {
    source = emptyNeed({ id: 'request-' + Date.now(), originalText: sourceInput });
  } else if (sourceInput && typeof sourceInput === 'object') {
    if (sourceInput.schemaVersion === 1 && typeof sourceInput.id === 'string' && typeof sourceInput.originalText === 'string') {
      source = JSON.parse(JSON.stringify(sourceInput));
    } else if (typeof sourceInput.originalText === 'string') {
      source = emptyNeed({ id: sourceInput.id || ('request-' + Date.now()), originalText: sourceInput.originalText });
      if (sourceInput.language) source.language = sourceInput.language;
      if (sourceInput.market) source.market = sourceInput.market;
    } else {
      return {
        status: 'rejected',
        stage: 'input-validation',
        code: 'INVALID_INPUT_TEXT',
        worldTruth: 'UNVERIFIED',
        actionAuthority: 'NONE'
      };
    }
  } else {
    return {
      status: 'rejected',
      stage: 'input-validation',
      code: 'INVALID_INPUT_TEXT',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  if (!extractor || typeof extractor.extract !== 'function' || !extractor.id || !extractor.version) {
    return {
      status: 'rejected',
      stage: 'extractor-validation',
      code: 'INVALID_EXTRACTOR',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  const expectedProvider = {
    providerId: extractor.id,
    providerVersion: extractor.version
  };

  let extracted;
  try {
    extracted = await extractor.extract(source, options);
  } catch (err) {
    return {
      status: 'rejected',
      stage: 'extractor-adapter',
      code: err.message === 'TIMEOUT' ? 'TIMEOUT' : (err.message === 'CANCELLED' ? 'CANCELLED' : 'EXTRACTOR_FAILED'),
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  if (!extracted || typeof extracted !== 'object' || !extracted.need || !Array.isArray(extracted.textReferences)) {
    return {
      status: 'rejected',
      stage: 'extractor-shape',
      code: 'MALFORMED_OUTPUT',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  // 1. Structural gate
  let sourceFp;
  try {
    sourceFp = sourceFingerprint(source);
  } catch {
    return {
      status: 'rejected',
      stage: 'source-snapshot',
      code: 'INVALID_SOURCE_NEED',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  const proposal = {
    sourceFingerprint: sourceFp,
    need: extracted.need
  };

  const gateResult = acceptProposal(source, proposal, expectedProvider);
  if (gateResult.status !== 'accepted') {
    return {
      status: 'rejected',
      stage: 'interpretation-boundary',
      code: gateResult.code,
      trust: 'structural-only',
      semanticGrounding: 'unverified',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  // 2. Exact source-text span verification
  const evidenceResult = verifyTextEvidence(source, proposal, expectedProvider, extracted.textReferences);
  if (evidenceResult.status !== 'verified') {
    return {
      status: 'rejected',
      stage: 'text-evidence-boundary',
      code: evidenceResult.code,
      trust: 'structural-only',
      semanticGrounding: 'unverified',
      worldTruth: 'UNVERIFIED',
      actionAuthority: 'NONE'
    };
  }

  return {
    status: 'verified',
    source,
    proposal,
    expectedProvider,
    need: gateResult.need,
    textReferences: extracted.textReferences,
    evidenceReport: evidenceResult,
    trust: 'structural-only',
    semanticGrounding: 'text-reference-verified',
    semanticSupport: 'unverified',
    worldTruth: 'UNVERIFIED',
    actionAuthority: 'NONE'
  };
}

module.exports = { extractUniversalIntent };
