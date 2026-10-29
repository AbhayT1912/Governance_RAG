import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";

/**
 * Initialize parser per language
 */
const parsers = {
  javascript: (() => {
    const p = new Parser();
    p.setLanguage(JavaScript);
    return p;
  })(),

  typescript: (() => {
    const p = new Parser();
    p.setLanguage(TypeScript.typescript);
    return p;
  })(),

  python: (() => {
    const p = new Parser();
    p.setLanguage(Python);
    return p;
  })(),
};

/**
 * Parses files into AST
 * @param {Array<{path:string, content:string, language:string}>} files
 * @returns {Promise<Array<{path:string, content:string, language:string, ast:any}>>}
 */
export async function parseFilesToAST(files) {
  return files.map(file => {
    const parser = parsers[file.language];
    if (!parser) {
      return { ...file, ast: null };
    }

    try {
      const tree = parser.parse(file.content);
      return { ...file, ast: tree };
    } catch (error) {
      console.error("AST parse failed for:", file.path);
      return { ...file, ast: null };
    }
  });
}
