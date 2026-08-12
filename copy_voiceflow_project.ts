export async function main(
  token: string,
  sourceProjectId: string,
  destinationWorkspaceId: string,
  destinationFolderId: string,
  targetSchemaVersion = "13.1",
  apiBaseUrl = "https://realtime-http-api.empyrean.voiceflow.com/v1alpha1",
) {
  // ——— Pure helpers (functional style) ———
  function normalizeBaseUrl(url: string): string {
    return url.replace(/\/$/, "");
  }

  function buildHeaders(authToken: string): HeadersInit {
    return {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    } as HeadersInit;
  }

  function buildExportUrl(baseUrl: string, projectId: string): string {
    return `${baseUrl}/assistant/export-json/${encodeURIComponent(projectId)}`;
  }

  function buildImportUrl(baseUrl: string, workspaceId: string): string {
    return `${baseUrl}/assistant/import-file/${encodeURIComponent(workspaceId)}`;
  }

  async function fetchStrictJson(
    url: string,
    options: RequestInit,
    operation: string,
  ): Promise<{ status: number; bytes: number; json: any }> {
    const response = await fetch(url, options);
    const body = await response.arrayBuffer();
    const text = new TextDecoder().decode(body);

    if (response.status === 304) {
      throw new Error(`${operation} failed: HTTP 304 Not Modified.`);
    }

    if (!response.ok) {
      throw new Error(
        `${operation} failed: HTTP ${response.status} ${response.statusText}${
          text ? `: ${text}` : ""
        }`,
      );
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${operation} returned invalid JSON.`);
    }

    return { status: response.status, bytes: body.byteLength, json };
  }

  function prettyPrintJson(json: unknown): string {
    return JSON.stringify(json, null, 2) + "\n";
  }

  function utf8ByteLength(s: string): number {
    return new TextEncoder().encode(s).byteLength;
  }

  function buildExportFilename(projectId: string): string {
    return `voiceflow-export-${projectId}.json`;
  }

  function buildImportForm(
    fileContent: string,
    filename: string,
    schemaVersion: string,
    folderId: string,
  ): FormData {
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileContent], { type: "application/json" }),
      filename,
    );
    form.append("targetSchemaVersion", schemaVersion);
    form.append("folderID", folderId);
    return form;
  }

  type ImportedJson = {
    project?: {
      _id?: unknown;
      devVersion?: unknown;
      liveVersion?: unknown;
    };
    assistant?: {
      id?: unknown;
      folderID?: unknown;
    };
  };

  function extractImportedIds(data: ImportedJson) {
    return {
      projectId: data.project?._id ?? null,
      devVersion: data.project?.devVersion ?? null,
      liveVersion: data.project?.liveVersion ?? null,
      assistantId: data.assistant?.id ?? null,
      assistantFolderId: data.assistant?.folderID ?? null,
    };
  }

  // ——— Flow orchestration ———
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  const headers = buildHeaders(token);

  // 1) Export assistant JSON
  const exported = await fetchStrictJson(
    buildExportUrl(baseUrl, sourceProjectId),
    { method: "GET", headers },
    "Export",
  );

  // 2) Serialize export as file payload
  const exportJson = prettyPrintJson(exported.json);
  const exportBytesLen = utf8ByteLength(exportJson);

  // 3) Build multipart form for import
  const form = buildImportForm(
    exportJson,
    buildExportFilename(sourceProjectId),
    targetSchemaVersion,
    destinationFolderId,
  );

  // 4) Import into destination workspace/folder
  const imported = await fetchStrictJson(
    buildImportUrl(baseUrl, destinationWorkspaceId),
    { method: "POST", headers, body: form },
    "Import",
  );

  const importedJson = imported.json as ImportedJson;

  // 5) Return a compact summary
  return {
    exportStatus: exported.status,
    exportBytes: exportBytesLen,
    importStatus: imported.status,
    importResponseBytes: imported.bytes,
    importedIds: extractImportedIds(importedJson),
    importResponse: imported.json,
  };
}
