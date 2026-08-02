ALTER TABLE provider_runs
  ADD COLUMN execution_policy_json TEXT NOT NULL
  DEFAULT '{"maxCanonicalInputBytes":4096,"maxCanonicalValidatedOutputBytes":8192,"maxOutputTokens":256,"timeoutMs":30000,"version":"kernel-probe-execution-v1"}';
