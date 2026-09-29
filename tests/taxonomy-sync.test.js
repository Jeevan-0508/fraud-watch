'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateBundle } = require('../scripts/sync-taxonomy.js');

let pass = 0;
const failures = [];
function ok(condition, message) { if (condition) pass++; else failures.push(message); }
function rejects(fn, expected, message) {
  try {
    fn();
    failures.push(message + ' (did not reject)');
  } catch (error) {
    ok(error.message.includes(expected), message + ' (wrong refusal: ' + error.message + ')');
  }
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }

const localBundle = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'fraud-data.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'taxonomy-source.json'), 'utf8'));
const actual = validateBundle(localBundle, null, null);
ok(actual.pattern_count === localBundle.meta.pattern_count, 'local mirror pattern count reconciles');
ok(actual.indicator_count === localBundle.meta.indicator_count, 'local mirror indicator count reconciles');
ok(actual.countermeasure_count === localBundle.meta.countermeasure_count, 'local mirror countermeasure count reconciles');
ok(/^[0-9a-f]{40}$/i.test(manifest.source_commit), 'manifest records an immutable 40-character source commit');
ok(/^[0-9a-f]{64}$/i.test(manifest.content_sha256), 'manifest records a SHA-256 of the pinned source bundle');
ok(manifest.taxonomy_version === localBundle.meta.version, 'manifest version matches the local mirror');
ok(manifest.source_url.endsWith('/' + manifest.source_commit + '/docs/data.json'), 'manifest source URL is commit-pinned');

const required = [
  'id', 'name', 'category', 'severity', 'prevalence', 'modes', 'summary',
  'how_it_works', 'indicators', 'false_positives', 'countermeasures',
  'references', 'version', 'last_reviewed'
];
const pattern = {
  id: 'FFT-001',
  name: 'Example Freight Pattern',
  aliases: [],
  category: 'cargo_loss',
  severity: 'high',
  prevalence: 'rare',
  modes: ['road'],
  geography: [],
  summary: 'A sufficiently detailed example summary for the taxonomy validator fixture.',
  how_it_works: ['The first documented step.', 'The second documented step.'],
  indicators: [{ phase: 'in_transit', signal: 'Signal text', observable_in: 'A recorded field', weight: 3 }],
  false_positives: [{ looks_like: 'An observation', actually: 'A benign cause', how_to_rule_out: 'Check a primary record.' }],
  countermeasures: { preventive: ['Prevent'], detective: ['Detect'], responsive: ['Respond'] },
  regulatory_hooks: [],
  related: [],
  references: [{ title: 'Source', publisher: 'Publisher', url: 'https://example.org/source' }],
  version: '1.0.0',
  last_reviewed: '2026-09-29'
};
const fixture = {
  meta: {
    taxonomy: 'Fixture', version: '1.0.0', pattern_count: 1,
    categories: ['cargo_loss'], indicator_count: 1, countermeasure_count: 3
  },
  patterns: [pattern]
};
const schema = {
  type: 'object',
  required,
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^FFT-[0-9]{3}$' },
    name: { type: 'string', minLength: 3 },
    aliases: { type: 'array', items: { type: 'string' } },
    category: { enum: ['cargo_loss'] },
    severity: { enum: ['low', 'high'] },
    prevalence: { enum: ['rare'] },
    modes: { type: 'array', minItems: 1, items: { enum: ['road'] } },
    geography: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', minLength: 40 },
    how_it_works: { type: 'array', minItems: 2, items: { type: 'string' } },
    indicators: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['phase', 'signal', 'observable_in', 'weight'], additionalProperties: false,
        properties: {
          phase: { enum: ['in_transit'] }, signal: { type: 'string' },
          observable_in: { type: 'string' }, weight: { type: 'integer', minimum: 1, maximum: 5 }
        }
      }
    },
    false_positives: { type: 'array', minItems: 1 },
    countermeasures: { type: 'object', required: ['preventive', 'detective', 'responsive'] },
    regulatory_hooks: { type: 'array' },
    related: { type: 'array' },
    references: {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['title', 'publisher', 'url'], additionalProperties: false,
        properties: { title: { type: 'string' }, publisher: { type: 'string' }, url: { type: 'string', format: 'uri' } }
      }
    },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    last_reviewed: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
  }
};
const index = {
  ...fixture.meta,
  patterns: [{
    id: pattern.id, name: pattern.name, category: pattern.category,
    severity: pattern.severity, prevalence: pattern.prevalence, summary: pattern.summary
  }]
};
ok(validateBundle(fixture, schema, index).pattern_count === 1, 'schema- and index-matched source fixture validates');

const duplicate = copy(fixture);
duplicate.patterns.push(copy(duplicate.patterns[0]));
duplicate.meta.pattern_count = 2;
duplicate.meta.indicator_count = 2;
duplicate.meta.countermeasure_count = 6;
rejects(() => validateBundle(duplicate, null, null), 'duplicate pattern id', 'duplicate pattern IDs are refused');

const wrongCount = copy(fixture);
wrongCount.meta.indicator_count = 9;
rejects(() => validateBundle(wrongCount, null, null), 'indicator_count', 'inconsistent bundle counts are refused');

const dangling = copy(fixture);
dangling.patterns[0].related = ['FFT-999'];
rejects(() => validateBundle(dangling, null, null), 'unknown pattern', 'dangling related-pattern references are refused');

const markup = copy(fixture);
markup.patterns[0].summary = '<script>alert(1)</script>';
rejects(() => validateBundle(markup, null, null), 'angle brackets', 'HTML-like taxonomy text is refused before it reaches current HTML sinks');

const unsafeUrl = copy(fixture);
unsafeUrl.patterns[0].references[0].url = 'javascript:alert(1)';
rejects(() => validateBundle(unsafeUrl, null, null), 'must use HTTPS', 'non-HTTPS source links are refused');

const badSchemaValue = copy(fixture);
badSchemaValue.patterns[0].severity = 'extreme';
rejects(() => validateBundle(badSchemaValue, schema, null), 'enum', 'values outside the source schema are refused');

console.log(failures.length === 0
  ? 'PASS taxonomy-sync.test.js: ' + pass + '/' + pass + ' checks'
  : 'FAIL taxonomy-sync.test.js: ' + pass + '/' + (pass + failures.length) + ' checks');
if (failures.length) {
  failures.forEach(message => console.log('  - ' + message));
  process.exitCode = 1;
}
