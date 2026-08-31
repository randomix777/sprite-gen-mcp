/**
 * Shared test reporting helper for the commercial orchestrator (Phase 4).
 *
 * Every suite MUST emit exactly one stable JSON line of the form:
 *   {"suite":"<name>","assertions":N,"passed":N,"failed":N,"skipped":0,"duration_ms":N,"status":"PASS"}
 * The orchestrator parses this line and rejects: missing fields, assertions===0,
 * status/exit-code conflicts, and unparseable output. This closes the "fake green"
 * gap where a suite could exit 0 while asserting nothing.
 */
export function emitReport(name, { assertions, passed, failed, skipped = 0, startedAt = Date.now() }) {
  const status = failed > 0 ? 'FAIL' : (assertions > 0 ? 'PASS' : 'FAIL');
  const line = JSON.stringify({
    suite: name,
    assertions,
    passed,
    failed,
    skipped,
    duration_ms: Date.now() - startedAt,
    status,
  });
  // Emit on stderr so it is unambiguous to parse (stdout may have PASS/✓ noise).
  process.stderr.write(`COMMERCIAL_JSON ${line}\n`);
  return status;
}
