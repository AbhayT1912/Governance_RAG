/**
 * Extract symbols from AST
 * @param {Array<{path:string, content:string, language:string, ast:any}>} files
 * @returns {Array}
 */
export function extractSymbols(files) {
  return files.map(file => {
    const functions = [];
    const classes = [];
    const imports = [];
    const calls = [];
    const callsByFunction = {};

    if (!file.ast) {
      return {
        ...file,
        symbols: { functions, classes, imports, calls, callsByFunction },
      };
    }

    function visit(node, activeFunction = null) {
      let functionName = null;
      if (
        ["function_declaration", "function_definition", "method_definition"].includes(
          node.type,
        )
      ) {
        functionName = node.childForFieldName("name")?.text || null;
      } else if (node.type === "variable_declarator") {
        const valueNode = node.childForFieldName("value");
        if (
          valueNode &&
          [
            "arrow_function",
            "function_expression",
            "generator_function",
          ].includes(valueNode.type)
        ) {
          functionName = node.childForFieldName("name")?.text || null;
        }
      }

      const ownerFunction = functionName || activeFunction;
      if (functionName && !functions.includes(functionName)) {
        functions.push(functionName);
      }

      if (["class_declaration", "class_definition", "class"].includes(node.type)) {
        const name = node.childForFieldName("name")?.text;
        if (name && !classes.includes(name)) classes.push(name);
      }

      if (["import_statement", "import_from_statement"].includes(node.type)) {
        imports.push(node.text);
      }

      if (node.type === "call_expression" || node.type === "call") {
        const callee =
          node.childForFieldName?.("function")?.text || node.child(0)?.text;
        if (callee) {
          if (!calls.includes(callee)) calls.push(callee);
          if (ownerFunction) {
            callsByFunction[ownerFunction] ||= [];
            if (!callsByFunction[ownerFunction].includes(callee)) {
              callsByFunction[ownerFunction].push(callee);
            }
          }
        }
      }

      for (const child of node.children || []) {
        visit(child, ownerFunction);
      }
    }

    visit(file.ast.rootNode);

    return {
      ...file,
      symbols: { functions, classes, imports, calls, callsByFunction },
    };
  });
}
