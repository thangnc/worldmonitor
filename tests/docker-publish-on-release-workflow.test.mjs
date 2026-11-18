import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

// A release published with GITHUB_TOKEN never starts other workflows, so
// docker-publish.yml must also accept workflow_dispatch (exempt from that rule)
// and tag `latest` for a release tag whichever way it was started.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadWorkflow = (name) =>
  loadYaml(readFileSync(resolve(root, '.github/workflows', name), 'utf8'));

const docker = loadWorkflow('docker-publish.yml');
// `on:` is parsed as the boolean `true` by YAML 1.1, which js-yaml implements.
const dockerTriggers = docker.on ?? docker[true];

test('docker-publish accepts the dispatch and tags latest for a release tag either way', () => {
  assert.ok(dockerTriggers.workflow_dispatch !== undefined, 'the dispatch target must accept workflow_dispatch');
  assert.ok(dockerTriggers.release, 'a release a person publishes by hand still triggers the build');

  const meta = docker.jobs.docker.steps.find((s) => String(s.uses ?? '').startsWith('docker/metadata-action'));
  assert.ok(meta, 'metadata-action step not found');
  const tagRules = meta.with.tags.split('\n').map((line) => line.trim()).filter(Boolean);
  // A `#` line inside the block scalar is not a YAML comment; metadata-action
  // would read it as a tag rule.
  assert.deepEqual(tagRules.filter((line) => !line.startsWith('type=')), [], 'every tags line must be a type= rule');
  const latest = tagRules.find((line) => line.includes('value=latest'));
  assert.ok(latest, 'no latest tag rule');
  assert.doesNotMatch(
    latest,
    /event_name == 'release'/,
    'gating latest on the release event leaves the dispatched release build without latest'
  );
  assert.match(latest, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(latest, /!contains\(github\.ref, '-'\)/, 'a pre-release tag must not move latest');
});
