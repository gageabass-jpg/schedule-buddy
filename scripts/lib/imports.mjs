// Reading the imports out of a TypeScript source file, without a parser. Good enough for
// the plain import / export-from / import() forms the shared library uses.

export function specifiersOf(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found = [];
  const re = /(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m; (m = re.exec(code)); ) found.push(m[1] ?? m[2] ?? m[3]);
  return found;
}

export const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

