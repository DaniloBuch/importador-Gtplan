import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORDERED_MODULES = [
  { file: 'src/core/dates.js', scope: false },
  { file: 'src/core/csv.js', scope: false },
  { file: 'src/core/xlsxReader.js', scope: false },
  { file: 'src/core/motiveResolver.js', scope: false },
  { file: 'src/core/ruleEngine.js', scope: false },
  { file: 'src/data/seedData.js', scope: false },
  { file: 'src/storage/repository.js', scope: false },
  { file: 'src/ui/icons.js', scope: false },
  { file: 'src/ui/triageTable.js', scope: true, exports: ['TriageTableController'] },
  { file: 'src/ui/adminModal.js', scope: true, exports: ['AdminModalController'] },
  { file: 'src/main.js', scope: false }
];

function stripImportsAndExports(src, keepScope = false, exportNames = []) {
  // Remove static multi-line or single-line import statements
  let out = src.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Convert "export class/function/const/let " into plain declarations
  out = out.replace(/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
  if (keepScope && exportNames.length > 0) {
    return `const { ${exportNames.join(', ')} } = (() => {\n${out}\nreturn { ${exportNames.join(', ')} };\n})();`;
  }
  return out;
}

async function main() {
  const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const tokensCss = await fs.readFile(path.join(__dirname, 'styles/cbs-tokens.css'), 'utf8');
  // Fonte Quicksand embutida como data URI para o HTML funcionar offline (arquivo único)
  const fontB64 = (await fs.readFile(path.join(__dirname, 'assets/fonts/Quicksand-VariableFont_wght.ttf'))).toString('base64');
  const css = (await fs.readFile(path.join(__dirname, 'styles/main.css'), 'utf8')).replace(
    'url("../assets/fonts/Quicksand-VariableFont_wght.ttf")',
    `url("data:font/ttf;base64,${fontB64}")`
  );
  const logoB64 = (await fs.readFile(path.join(__dirname, 'assets/brand/logo-branco.svg'))).toString('base64');

  const chunks = [];
  for (const mod of ORDERED_MODULES) {
    const raw = await fs.readFile(path.join(__dirname, mod.file), 'utf8');
    chunks.push(`// === ${mod.file} ===\n` + stripImportsAndExports(raw, mod.scope, mod.exports));
  }

  const bundledJs = chunks.join('\n\n').replace(/<\/script>/gi, '<\\/script>');

  let singleHtml = html
    .replace('<link rel="stylesheet" href="./styles/cbs-tokens.css" />', () => `<style>\n${tokensCss}\n</style>`)
    .replace('<link rel="stylesheet" href="./styles/main.css" />', () => `<style>\n${css}\n</style>`)
    .replace('src="./assets/brand/logo-branco.svg"', `src="data:image/svg+xml;base64,${logoB64}"`);
  singleHtml = singleHtml.replace(
    '<script type="module" src="./src/main.js"></script>',
    () => `<script type="module">\n${bundledJs}\n</script>`
  );

  const distDir = path.join(__dirname, 'dist');
  await fs.mkdir(distDir, { recursive: true });
  const outHtmlPath = path.join(distDir, 'gtplan-followup.html');
  await fs.writeFile(outHtmlPath, singleHtml, 'utf8');

  const checkPath = path.join(distDir, '.syntax-check.mjs');
  await fs.writeFile(checkPath, bundledJs, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', checkPath], { stdio: 'inherit' });
  } finally {
    await fs.unlink(checkPath);
  }

  console.log(`Bundle gerado e verificado (--check OK): ${outHtmlPath} (${singleHtml.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
