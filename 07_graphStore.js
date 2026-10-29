import "dotenv/config";
import path from "path";
import neo4j from "neo4j-driver";

const graphEnabled = process.env.ENABLE_NEO4J === "true";

const driver = graphEnabled
  ? neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
    )
  : null;

async function runQuery(query, params = {}) {
  if (!graphEnabled || !driver) {
    return { records: [] };
  }

  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

export async function clearRepoGraph(repoId) {
  if (!repoId || typeof repoId !== "string" || repoId.trim().length === 0) {
    throw new Error("A non-empty repoId is required to clear graph data");
  }

  if (!graphEnabled) {
    return;
  }

  await runQuery(
    `MATCH (n {repoId: $repoId})
     DETACH DELETE n`,
    { repoId },
  );
}

export async function syncChunksToGraph(chunks, files = []) {
  if (!chunks?.length) {
    return { enabled: graphEnabled, nodes: 0, relationships: 0 };
  }

  if (!graphEnabled) {
    return { enabled: false, nodes: 0, relationships: 0 };
  }

  const nodesById = new Map();
  const modules = new Map();
  let relationships = 0;

  for (const file of files) {
    const repoId = chunks[0].metadata.repoId;
    const moduleId = `${repoId}::${file.path}`;
    modules.set(file.path, moduleId);
    await createModuleNode(moduleId, file.path, file.language, repoId);
  }

  for (const chunk of chunks) {
    const { file, symbol, type, language, id, repoId } = chunk.metadata;
    const moduleId = `${repoId}::${file}`;
    if (!modules.has(file)) {
      modules.set(file, moduleId);
      await createModuleNode(moduleId, file, language, repoId);
    }

    if (type === "function") {
      await createFunctionNode(symbol, file, id, repoId);
      nodesById.set(id, { label: "Function", metadata: chunk.metadata });
    } else if (type === "class") {
      await createClassNode(symbol, file, id, repoId);
      nodesById.set(id, { label: "Class", metadata: chunk.metadata });
    }
  }

  for (const [id, node] of nodesById) {
    const { parentId, file, repoId } = node.metadata;
    const moduleId = modules.get(file) || `${repoId}::${file}`;
    const parent = nodesById.get(parentId);
    const parentIdToLink = parent ? parentId : moduleId;
    const parentLabel = parent ? parent.label : "Module";
    relationships += await linkToParent(id, parentIdToLink, parentLabel);
  }

  const functionsByName = new Map();
  const functionsByFileAndName = new Map();
  for (const [id, node] of nodesById) {
    if (node.label !== "Function") continue;
    const { file, symbol } = node.metadata;
    functionsByName.set(symbol, [
      ...(functionsByName.get(symbol) || []),
      id,
    ]);
    functionsByFileAndName.set(`${file}\0${symbol}`, id);
  }

  for (const file of files) {
    const fromModule = modules.get(file.path);
    for (const importText of file.symbols?.imports || []) {
      const importedPath = getImportedFilePath(file, importText, modules);
      const toModule = importedPath && modules.get(importedPath);
      if (fromModule && toModule) {
        relationships += await linkModules(fromModule, toModule);
      }
    }

    for (const [functionName, callees] of Object.entries(
      file.symbols?.callsByFunction || {},
    )) {
      const fromId = functionsByFileAndName.get(
        `${file.path}\0${functionName}`,
      );
      if (!fromId) continue;

      for (const callee of callees) {
        const calleeName = callee.split(/[.(\s]/).filter(Boolean).pop();
        const candidates = functionsByName.get(calleeName) || [];
        if (candidates.length === 1) {
          relationships += await linkFunctionCalls(fromId, candidates[0]);
        }
      }
    }
  }

  return {
    enabled: true,
    nodes: modules.size + nodesById.size,
    relationships,
  };
}

function getImportedFilePath(file, importText, modules) {
  let specifier;
  let isPythonRelative = false;

  const jsImport = importText.match(
    /(?:from\s*)?["']([^"']+)["']/,
  );
  if (jsImport) {
    specifier = jsImport[1];
    if (!specifier.startsWith(".")) return null;
  } else {
    const pythonImport = importText.match(
      /^\s*from\s+([.\w]+)\s+import|^\s*import\s+([\w.]+)/,
    );
    if (!pythonImport) return null;
    specifier = pythonImport[1] || pythonImport[2];
    isPythonRelative = specifier.startsWith(".");
    if (!isPythonRelative) specifier = specifier.replace(/\./g, "/");
  }

  const isPythonImport = !jsImport;
  const normalizedSpecifier = isPythonRelative
    ? specifier.replace(/^\.+/, "").replace(/\./g, "/")
    : specifier;
  const base =
    isPythonRelative || (isPythonImport && !specifier.startsWith("."))
      ? path.posix.normalize(
          isPythonRelative
            ? path.posix.join(path.posix.dirname(file.path), normalizedSpecifier)
            : normalizedSpecifier,
        )
      : path.posix.normalize(
          path.posix.join(path.posix.dirname(file.path), normalizedSpecifier),
        );
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.py`,
    `${base}/index.js`,
    `${base}/index.ts`,
    `${base}/__init__.py`,
  ];

  return candidates.find((candidate) => modules.has(candidate)) || null;
}

async function createModuleNode(uid, filePath, language, repoId) {
  await runQuery(
    `MERGE (m:Module {id: $uid})
     SET m.path = $filePath, m.language = $language, m.repoId = $repoId`,
    { uid, filePath, language, repoId },
  );
}

async function createFunctionNode(name, file, uid, repoId) {
  await runQuery(
    `MERGE (f:Function {id: $uid})
     SET f.name = $name, f.file = $file, f.repoId = $repoId`,
    { uid, name, file, repoId },
  );
}

async function createClassNode(name, file, uid, repoId) {
  await runQuery(
    `MERGE (c:Class {id: $uid})
     SET c.name = $name, c.file = $file, c.repoId = $repoId`,
    { uid, name, file, repoId },
  );
}

async function linkToParent(childId, parentId, parentType) {
  if (!["Module", "Class", "Function"].includes(parentType)) {
    throw new Error(`Unsupported graph parent type: ${parentType}`);
  }

  const result = await runQuery(
    `MATCH (child {id: $childId})
     MATCH (parent:${parentType} {id: $parentId})
     MERGE (child)-[:DEFINED_IN]->(parent)
     RETURN child.id AS childId`,
    { childId, parentId },
  );

  if (result.records.length === 0) {
    throw new Error(
      `Could not connect graph node ${childId} to parent ${parentId}`,
    );
  }
  return result.records.length;
}

async function linkModules(fromId, toId) {
  const result = await runQuery(
    `MATCH (a:Module {id: $fromId})
     MATCH (b:Module {id: $toId})
     MERGE (a)-[:IMPORTS]->(b)
     RETURN a.id AS fromId`,
    { fromId, toId },
  );
  return result.records.length;
}

async function linkFunctionCalls(fromId, toId) {
  const result = await runQuery(
    `MATCH (a:Function {id: $fromId})
     MATCH (b:Function {id: $toId})
     MERGE (a)-[:CALLS]->(b)
     RETURN a.id AS fromId`,
    { fromId, toId },
  );
  return result.records.length;
}

export async function expandSymbol(uid) {
  if (!graphEnabled) {
    return [];
  }

  const result = await runQuery(
    `MATCH (n {id: $uid})
     MATCH (n)-[:DEFINED_IN|CALLS|IMPORTS*1..2]-(neighbor)
     RETURN DISTINCT neighbor.id AS id,
                     head(labels(neighbor)) AS type,
                     neighbor.name AS name
     LIMIT 10`,
    { uid },
  );

  return result.records.map((record) => ({
    id: record.get("id"),
    type: record.get("type"),
    name: record.get("name") || record.get("id"),
  }));
}
