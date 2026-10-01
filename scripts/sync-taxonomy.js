'use strict';

/* Fetch and validate one immutable commit of freight-fraud-taxonomy before
   updating Fraud Watch's public data mirror. This creates no Git refs and
   cannot promote the fetched data: the workflow that calls it opens a PR. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY = 'Jeevan-0508/freight-fraud-taxonomy';
const DATA_PATH = 'docs/data.json';
const SCHEMA_PATH = 'taxonomy/schema.json';
const INDEX_PATH = 'taxonomy/index.json';
const REQUIRED_PATTERN_FIELDS = [
  'id', 'name', 'category', 'severity', 'prevalence', 'modes', 'summary',
  'how_it_works', 'indicators', 'false_positives', 'countermeasures',
  'references', 'version', 'last_reviewed'
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function validateAgainstSchema(value, spec, where, errors) {
  if (!spec || typeof spec !== 'object') {
    errors.push(where + ': schema node is missing or invalid');
    return;
  }
  if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
    errors.push(where + ': value is outside the declared enum');
    return;
  }
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(where + ': expected object');
      return;
    }
    for (const key of spec.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(where + ': missing ' + key);
    }
    const properties = spec.properties || {};
    if (spec.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(where + ': unexpected field ' + key);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) validateAgainstSchema(child, properties[key], where + '.' + key, errors);
    }
    return;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(where + ': expected array');
      return;
    }
    if (value.length < (spec.minItems || 0)) errors.push(where + ': too few items');
    if (spec.items) value.forEach((child, i) => validateAgainstSchema(child, spec.items, where + '[' + i + ']', errors));
    return;
  }
  if (spec.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(where + ': expected string');
      return;
    }
    if (value.length < (spec.minLength || 0)) errors.push(where + ': string is shorter than the schema minimum');
    if (spec.pattern && !(new RegExp(spec.pattern).test(value))) errors.push(where + ': string does not match the schema pattern');
    if (spec.format === 'uri') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.push(where + ': URI scheme is not HTTP(S)');
      } catch (_) {
        errors.push(where + ': expected an absolute HTTP(S) URI');
      }
    }
    return;
  }
  if (spec.type === 'integer') {
    if (!Number.isInteger(value)) {
      errors.push(where + ': expected integer');
      return;
    }
    if (spec.minimum != null && value < spec.minimum) errors.push(where + ': below schema minimum');
    if (spec.maximum != null && value > spec.maximum) errors.push(where + ': above schema maximum');
  }
}

function validateBundle(bundle, schema, index) {
  const errors = [];
  const add = message => errors.push(message);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('taxonomy bundle must be an object');
  const meta = bundle.meta;
  const patterns = bundle.patterns;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) add('meta must be an object');
  if (!Array.isArray(patterns) || patterns.length === 0) add('patterns must be a non-empty array');
  if (errors.length) throw new Error(errors.join('\n'));

  for (const field of ['taxonomy', 'version']) {
    if (typeof meta[field] !== 'string' || !meta[field].trim()) add('meta.' + field + ' must be a non-empty string');
  }
  for (const field of ['pattern_count', 'indicator_count', 'countermeasure_count']) {
    if (!Number.isInteger(meta[field]) || meta[field] < 0) add('meta.' + field + ' must be a non-negative integer');
  }
  if (!Array.isArray(meta.categories) || meta.categories.some(x => typeof x !== 'string')) add('meta.categories must be an array of strings');

  const ids = new Set();
  let indicatorCount = 0;
  let countermeasureCount = 0;
  const related = [];
  function checkNoMarkup(value, where) {
    if (typeof value === 'string' && /[<>]/.test(value)) add(where + ' contains angle brackets and cannot be safely rendered by current HTML views');
    else if (Array.isArray(value)) value.forEach((child, i) => checkNoMarkup(child, where + '[' + i + ']'));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) checkNoMarkup(child, where + '.' + key);
    }
  }
  patterns.forEach((pattern, i) => {
    const where = 'patterns[' + i + ']';
    if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
      add(where + ' must be an object');
      return;
    }
    for (const field of REQUIRED_PATTERN_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(pattern, field)) add(where + ' is missing ' + field);
    }
    if (typeof pattern.id === 'string') {
      if (!/^FFT-[0-9]{3}$/.test(pattern.id)) add(where + '.id does not match FFT-NNN');
      if (ids.has(pattern.id)) add('duplicate pattern id ' + pattern.id);
      ids.add(pattern.id);
    }
    if (!Array.isArray(pattern.indicators)) add(where + '.indicators must be an array');
    else indicatorCount += pattern.indicators.length;
    if (!pattern.countermeasures || typeof pattern.countermeasures !== 'object' || Array.isArray(pattern.countermeasures)) {
      add(where + '.countermeasures must be an object');
    } else {
      for (const [kind, entries] of Object.entries(pattern.countermeasures)) {
        if (!Array.isArray(entries)) add(where + '.countermeasures.' + kind + ' must be an array');
        else countermeasureCount += entries.length;
      }
    }
    if (Array.isArray(pattern.related)) related.push(...pattern.related.map(id => ({ id, from: pattern.id })));
    if (Array.isArray(pattern.references)) {
      pattern.references.forEach((ref, ri) => {
        if (!ref || typeof ref.url !== 'string' || !/^https:\/\//i.test(ref.url)) {
          add(where + '.references[' + ri + '].url must use HTTPS');
        }
      });
    }
    checkNoMarkup(pattern, where);
    if (schema && schema.properties) validateAgainstSchema(pattern, schema, where, errors);
  });

  for (const entry of related) {
    if (!ids.has(entry.id)) add(entry.from + ' relates to unknown pattern ' + entry.id);
    if (entry.from === entry.id) add(entry.from + ' relates to itself');
  }
  const categories = [...new Set(patterns.map(p => p && p.category).filter(x => typeof x === 'string'))].sort();
  if (meta.pattern_count !== patterns.length) add('meta.pattern_count does not match patterns.length');
  if (meta.indicator_count !== indicatorCount) add('meta.indicator_count does not match indicator arrays');
  if (meta.countermeasure_count !== countermeasureCount) add('meta.countermeasure_count does not match countermeasure arrays');
  if (canonicalJson(meta.categories) !== canonicalJson(categories)) add('meta.categories does not match the categories present in patterns');

  if (index) {
    const indexMeta = { ...index };
    delete indexMeta.patterns;
    if (canonicalJson(indexMeta) !== canonicalJson(meta)) add('taxonomy/index.json metadata disagrees with docs/data.json metadata');
    if (!Array.isArray(index.patterns) || index.patterns.length !== patterns.length) {
      add('taxonomy/index.json pattern list does not match docs/data.json');
    } else {
      patterns.forEach((p, i) => {
        const entry = index.patterns[i];
        if (!entry || ['id', 'name', 'category', 'severity', 'prevalence', 'summary'].some(k => entry[k] !== p[k])) {
          add('taxonomy/index.json entry ' + i + ' disagrees with docs/data.json');
        }
      });
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    pattern_count: patterns.length,
    indicator_count: indicatorCount,
    countermeasure_count: countermeasureCount,
    categories
  };
}

async function fetchBuffer(url, token) {
  const headers = { 'User-Agent': 'fraud-watch-taxonomy-sync', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('GET ' + url + ' returned HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchPinned(sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha || '')) throw new Error('source commit must be a 40-character Git SHA');
  const rawRoot = 'https://raw.githubusercontent.com/' + REPOSITORY + '/' + sha.toLowerCase() + '/';
  const [bundleBytes, schemaBytes, indexBytes] = await Promise.all([
    fetchBuffer(rawRoot + DATA_PATH, ''),
    fetchBuffer(rawRoot + SCHEMA_PATH, ''),
    fetchBuffer(rawRoot + INDEX_PATH, '')
  ]);
  const bundle = parseJson(bundleBytes, DATA_PATH);
  const schema = parseJson(schemaBytes, SCHEMA_PATH);
  const index = parseJson(indexBytes, INDEX_PATH);
  return { sha: sha.toLowerCase(), bundleBytes, bundle, counts: validateBundle(bundle, schema, index) };
}

function parseJson(bytes, label) {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(source);
  } catch (error) {
    throw new Error(label + ' is not valid UTF-8 JSON: ' + error.message);
  }
}

function writeAtomic(file, content) {
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

async function sync() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const apiRoot = 'https://api.github.com/repos/' + REPOSITORY;
  const apiHeaders = { 'User-Agent': 'fraud-watch-taxonomy-sync', Accept: 'application/vnd.github+json' };
  if (token) apiHeaders.Authorization = 'Bearer ' + token;
  const commitResponse = await fetch(apiRoot + '/commits/main', {
    headers: apiHeaders,
    signal: AbortSignal.timeout(30000)
  });
  if (!commitResponse.ok) throw new Error('Could not resolve taxonomy main: HTTP ' + commitResponse.status);
  const commit = await commitResponse.json();
  if (!/^[0-9a-f]{40}$/i.test(commit.sha || '')) throw new Error('GitHub returned an invalid source commit SHA');
  const sha = commit.sha.toLowerCase();
  const snapshot = await fetchPinned(sha);
  const bundle = snapshot.bundle;
  const counts = snapshot.counts;
  const source = {
    source_repository: REPOSITORY,
    source_path: DATA_PATH,
    source_commit: sha,
    source_url: 'https://github.com/' + REPOSITORY + '/blob/' + sha + '/' + DATA_PATH,
    content_sha256: crypto.createHash('sha256').update(snapshot.bundleBytes).digest('hex'),
    taxonomy_version: bundle.meta.version,
    counts
  };
  writeAtomic(path.join(ROOT, 'data', 'fraud-data.json'), JSON.stringify(bundle, null, 2) + '\n');
  writeAtomic(path.join(ROOT, 'data', 'taxonomy-source.json'), JSON.stringify(source, null, 2) + '\n');
  console.log('Validated ' + counts.pattern_count + ' patterns, ' + counts.indicator_count +
    ' indicators and ' + counts.countermeasure_count + ' countermeasures from ' + REPOSITORY + '@' + sha + '.');
}

async function verifyLocal() {
  const bundleFile = path.join(ROOT, 'data', 'fraud-data.json');
  const sourceFile = path.join(ROOT, 'data', 'taxonomy-source.json');
  const localBundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  if (source.source_repository !== REPOSITORY || source.source_path !== DATA_PATH) {
    throw new Error('local source manifest names an unexpected repository or path');
  }
  const expectedUrl = 'https://github.com/' + REPOSITORY + '/blob/' + source.source_commit + '/' + DATA_PATH;
  if (source.source_url !== expectedUrl) throw new Error('local source manifest URL is not pinned to its commit');
  if (!/^[0-9a-f]{64}$/i.test(source.content_sha256 || '')) throw new Error('local source manifest has no valid SHA-256');
  const snapshot = await fetchPinned(source.source_commit);
  const actualHash = crypto.createHash('sha256').update(snapshot.bundleBytes).digest('hex');
  if (actualHash !== source.content_sha256) throw new Error('local source manifest SHA-256 does not match the pinned upstream bytes');
  if (canonicalJson(localBundle) !== canonicalJson(snapshot.bundle)) {
    throw new Error('local taxonomy mirror differs from its pinned upstream bundle');
  }
  if (source.taxonomy_version !== snapshot.bundle.meta.version ||
      canonicalJson(source.counts) !== canonicalJson(snapshot.counts)) {
    throw new Error('local source manifest metadata does not match its pinned upstream bundle');
  }
  console.log('Verified Fraud Watch taxonomy mirror against ' + REPOSITORY + '@' + snapshot.sha +
    ' (' + actualHash + ').');
}

if (require.main === module) {
  const mode = process.argv[2];
  const operation = mode === '--verify' ? verifyLocal() : mode ? Promise.reject(new Error('expected no argument or --verify')) : sync();
  Promise.resolve(operation).catch(error => {
    console.error('Taxonomy sync refused: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { canonicalJson, validateAgainstSchema, validateBundle, sync, verifyLocal };
