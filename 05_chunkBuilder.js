/**
 * Build semantic chunks from AST
 * @param {Array<{path:string, content:string, language:string, ast:any}>} files
 * @returns {Array<{text:string, metadata:Object}>}
 */
export function buildChunks(files) {
  const chunks = [];

  for (const file of files) {
    if (!file.content) {
      continue;
    }

    if (!file.ast || !file.ast.rootNode) {
      chunks.push({
        text: file.content,
        metadata: {
          id: `${file.path}#module`,
          parentId: null,
          file: file.path,
          symbol: "main",
          type: "module",
          language: file.language,
        },
      });
      continue;
    }

    const fileChunks = [];
    const queue = [{ node: file.ast.rootNode, parentId: file.path }];

    for (let index = 0; index < queue.length; index += 1) {
      const { node, parentId } = queue[index];
      const type = node.type;
      let isChunked = false;
      let nextParentId = parentId;

      const isFunction = [
        "function_declaration",
        "function_definition",
        "method_definition",
        "function_expression",
        "arrow_function",
        "generator_function",
        "async_function",
        "async_arrow_function",
        "async_generator_function",
        "function_type",
        "variable_declaration",
        "variable_declarator",
      ].includes(type);
      const isClass = [
        "class_declaration",
        "class_definition",
        "class",
      ].includes(type);

      if (isClass || isFunction) {
        let nameNode = node.childForFieldName ? node.childForFieldName("name") : null;
        let symbol = nameNode && typeof nameNode.text === "string"
          ? nameNode.text
          : "anonymous";
        let chunkType = isClass ? "class" : "function";

        if (type === "variable_declaration") {
          const declarator = (node.namedChildren || []).find(
            (child) => child.type === "variable_declarator"
          );

          if (declarator) {
            const valueNode = declarator.childForFieldName
              ? declarator.childForFieldName("value")
              : null;

            if (
              valueNode &&
              [
                "arrow_function",
                "function_expression",
                "generator_function",
              ].includes(valueNode.type)
            ) {
              nameNode = declarator.childForFieldName
                ? declarator.childForFieldName("name")
                : null;
              symbol = nameNode && typeof nameNode.text === "string"
                ? nameNode.text
                : "anonymous";
            } else {
              chunkType = null;
            }
          } else {
            chunkType = null;
          }
        }

        if (type === "variable_declarator") {
          const valueNode = node.childForFieldName
            ? node.childForFieldName("value")
            : null;

          if (
            !valueNode ||
            ![
              "arrow_function",
              "function_expression",
              "generator_function",
            ].includes(valueNode.type)
          ) {
            chunkType = null;
          }
        }

        if (chunkType) {
          const currentId = `${file.path}#${symbol}`;
          const text = file.content.slice(node.startIndex, node.endIndex);

          if (text.trim().length > 0) {
            fileChunks.push({
              text,
              metadata: {
                id: currentId,
                parentId: parentId,
                file: file.path,
                symbol: symbol,
                type: chunkType,
                language: file.language,
              },
            });
            isChunked = true;
            nextParentId = currentId;
          }
        }
      }

      for (const child of node.namedChildren || []) {
        queue.push({ node: child, parentId: isChunked ? nextParentId : parentId });
      }
    }

    // If no functions or classes were found
    // capture the whole content as a 'module' type.
    if (fileChunks.length === 0) {
      chunks.push({
        text: file.content,
        metadata: {
          id: `${file.path}#module`,
          parentId: null,
          file: file.path,
          symbol: "main",
          type: "module",
          language: file.language,
        },
      });
    } else {
      chunks.push(...fileChunks);
    }
  }

  return chunks;
}
