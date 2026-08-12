#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline';

const API_BASE_URL = process.env.VOICEFLOW_API_BASE_URL ||
  'https://realtime-http-api.empyrean.voiceflow.com/v1alpha1';
const TARGET_SCHEMA_VERSION = process.env.VOICEFLOW_TARGET_SCHEMA_VERSION || '13.1';

function printHelp() {
  console.log(`Copy a Voiceflow project between workspaces.

Usage:
  node copy_voiceflow_project.mjs
  node copy_voiceflow_project.mjs --help

Environment:
  VOICEFLOW_API_BASE_URL       API base URL (default: ${API_BASE_URL})
  VOICEFLOW_TARGET_SCHEMA_VERSION  Import schema version (default: ${TARGET_SCHEMA_VERSION})`);
}

async function askQuestions() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async question => {
    process.stdout.write(question);
    const result = await lines.next();
    if (result.done) throw new Error('Input ended before all fields were entered.');
    return result.value;
  };
  try {
    // Keep every prompt on one readline async iterator. readline owns stdin's
    // line buffering and raw-mode handling, so no newline can be consumed by
    // a second input listener.
    const writeToOutput = rl._writeToOutput;
    rl._writeToOutput = () => {};
    const token = await ask('JWT token (hidden): ');
    rl._writeToOutput = writeToOutput;
    process.stdout.write('\n');
    const sourceId = await ask('Source assistant/version ID: ');
    const workspaceId = await ask('Destination workspace ID: ');
    const folderID = await ask('Destination folder ID: ');
    return { token, sourceId: sourceId.trim(), workspaceId: workspaceId.trim(), folderID: folderID.trim() };
  } finally {
    rl.close();
  }
}

async function requestJson(url, options, operation) {
  const response = await fetch(url, options);
  if (response.status === 304) throw new Error(`${operation} failed: HTTP 304 Not Modified.`);
  if (!response.ok) {
    let detail = '';
    try { detail = `: ${await response.text()}`; } catch { /* ignore unreadable error bodies */ }
    throw new Error(`${operation} failed: HTTP ${response.status} ${response.statusText}${detail}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON.`);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const { token, sourceId, workspaceId, folderID } = await askQuestions();
  if (!token || !sourceId || !workspaceId || !folderID) throw new Error('All fields are required.');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
  };
  const base = API_BASE_URL.replace(/\/$/, '');
  const exportUrl = `${base}/assistant/export-json/${encodeURIComponent(sourceId)}`;
  console.log('Exporting project...');
  const exported = await requestJson(exportUrl, { headers }, 'Export');
  const exportPath = `voiceflow-export-${sourceId}.json`;
  await writeFile(exportPath, JSON.stringify(exported, null, 2) + '\n', 'utf8');
  console.log(`Export saved to ${exportPath}`);

  const form = new FormData();
  const fileBytes = await readFile(exportPath);
  form.append('file', new Blob([fileBytes], { type: 'application/json' }), `${exportPath}`);
  form.append('targetSchemaVersion', TARGET_SCHEMA_VERSION);
  form.append('folderID', folderID);
  console.log('Importing project...');
  const imported = await requestJson(`${base}/assistant/import-file/${encodeURIComponent(workspaceId)}`, {
    method: 'POST', headers, body: form,
  }, 'Import');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const importPath = `voiceflow-import-result-${timestamp}.json`;
  await writeFile(importPath, JSON.stringify(imported, null, 2) + '\n', 'utf8');
  console.log(`Import saved to ${importPath}`);
  const project = imported?.project;
  const assistant = imported?.assistant;
  console.log('Import completed.');
  console.log(`project._id: ${project?._id ?? 'not present'}`);
  console.log(`project.devVersion: ${project?.devVersion ?? 'not present'}`);
  console.log(`project.liveVersion: ${project?.liveVersion ?? 'not present'}`);
  console.log(`assistant.id: ${assistant?.id ?? 'not present'}`);
  console.log(`assistant.folderID: ${assistant?.folderID ?? 'not present'}`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
