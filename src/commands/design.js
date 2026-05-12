import { Command } from 'commander';
import { RULES, CATEGORIES, SEVERITY, detectAll, summarize } from '../lib/design-rules.js';
import { print, info } from '../lib/output.js';

export function makeDesignCommand() {
  const design = new Command('design')
    .description('Design quality checks powered by impeccable rules — detect anti-patterns in EDS pages');

  // ─── detect ────────────────────────────────────────────────────────────────
  design
    .command('detect <source>')
    .description('Scan an EDS page for design anti-patterns. <source> is a local HTML file, a URL, or a DA path like /my-page')
    .option('--category <cat>', 'Filter by category: ai-slop | quality | eds')
    .option('--severity <sev>', 'Minimum severity to show: error | warning | info', 'info')
    .option('--fix-hints', 'Show fix suggestions inline')
    .action(async (source, opts) => {
      const html = await fetchHtml(source);
      let findings = detectAll(html);

      if (opts.category) {
        findings = findings.filter((f) => f.category === opts.category);
      }

      const sevOrder = { error: 0, warning: 1, info: 2 };
      const minSev = sevOrder[opts.severity] ?? 2;
      findings = findings.filter((f) => (sevOrder[f.severity] ?? 2) <= minSev);

      if (findings.length === 0) {
        info('No anti-patterns detected at this severity threshold.');
        return;
      }

      // Group by severity for a readable report
      const byRule = groupByRule(findings);
      const summary = summarize(findings);

      if (process.stdout.isTTY) {
        printReport(byRule, opts.fixHints ?? false);
        console.log('');
        console.error(`Summary — errors: ${summary.error}  warnings: ${summary.warning}  info: ${summary.info}`);
      } else {
        print(findings);
      }

      if (summary.error > 0) process.exit(1);
    });

  // ─── rules ─────────────────────────────────────────────────────────────────
  design
    .command('rules')
    .description('List all anti-pattern rules')
    .option('--category <cat>', 'Filter: ai-slop | quality | eds')
    .option('--json', 'Output full rule objects as JSON')
    .action((opts) => {
      let rules = RULES;
      if (opts.category) rules = rules.filter((r) => r.category === opts.category);

      if (opts.json) {
        console.log(JSON.stringify(rules.map(({ id, category, severity, description }) =>
          ({ id, category, severity, description })), null, 2));
        return;
      }

      print(rules.map(({ id, category, severity, description }) =>
        ({ id, category, severity, description: description.split(' — ')[0] })));
    });

  // ─── audit ─────────────────────────────────────────────────────────────────
  design
    .command('audit <source>')
    .description('Full design + semantic audit — combines da audit semantics with impeccable anti-pattern scan')
    .option('--severity <sev>', 'Minimum severity', 'warning')
    .action(async (source, opts) => {
      const html = await fetchHtml(source);
      const findings = detectAll(html);
      const sevOrder = { error: 0, warning: 1, info: 2 };
      const minSev = sevOrder[opts.severity] ?? 1;
      const filtered = findings.filter((f) => (sevOrder[f.severity] ?? 2) <= minSev);

      const summary = summarize(filtered);
      const sections = {
        [CATEGORIES.AI_SLOP]: filtered.filter((f) => f.category === CATEGORIES.AI_SLOP),
        [CATEGORIES.QUALITY]: filtered.filter((f) => f.category === CATEGORIES.QUALITY),
        [CATEGORIES.EDS]: filtered.filter((f) => f.category === CATEGORIES.EDS),
      };

      if (process.stdout.isTTY) {
        for (const [cat, items] of Object.entries(sections)) {
          if (items.length === 0) continue;
          console.log(`\n── ${cat.toUpperCase()} (${items.length}) ──`);
          printReport(groupByRule(items), true);
        }
        console.log('');
        console.error(`Total — errors: ${summary.error}  warnings: ${summary.warning}  info: ${summary.info}`);
      } else {
        print({ summary, findings: filtered });
      }

      if (summary.error > 0) process.exit(1);
    });

  // ─── token-check ───────────────────────────────────────────────────────────
  design
    .command('token-check <source>')
    .description('Verify stardust :root CSS custom-property contract is present in an EDS page')
    .action(async (source) => {
      const html = await fetchHtml(source);
      const required = [
        '--color-brand-primary',
        '--color-brand-secondary',
        '--type-scale-base',
        '--space-unit',
      ];
      const missing = required.filter((tok) => !html.includes(tok));
      if (missing.length === 0) {
        info('All required design tokens present.');
      } else {
        print(missing.map((t) => ({ token: t, status: 'missing' })));
        process.exit(1);
      }
    });

  return design;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchHtml(source) {
  // URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; da-cli/0.1)' },
    });
    if (!res.ok) { console.error(`Failed to fetch ${source}: ${res.status}`); process.exit(1); }
    return res.text();
  }

  // Local file
  if (source.endsWith('.html') || source.includes('/')) {
    const { readFile } = await import('node:fs/promises');
    try {
      return await readFile(source, 'utf8');
    } catch {
      // fall through to DA path
    }
  }

  // DA path — fetch .plain.html from EDS preview
  const { createClient } = await import('../lib/da-client.js');
  const client = await createClient();
  try {
    return await client.fetchPlainHtml(source);
  } catch (err) {
    console.error(`Cannot fetch HTML for "${source}": ${err.message}`);
    process.exit(1);
  }
}

function groupByRule(findings) {
  const map = new Map();
  for (const f of findings) {
    if (!map.has(f.rule)) map.set(f.rule, []);
    map.get(f.rule).push(f);
  }
  return map;
}

const SEV_ICON = { error: '✗', warning: '⚠', info: '·' };

function printReport(byRule, showFix) {
  for (const [ruleId, matches] of byRule) {
    const rule = RULES.find((r) => r.id === ruleId);
    const icon = SEV_ICON[rule.severity] ?? '·';
    const sev = rule.severity.toUpperCase().padEnd(7);
    console.log(`\n${icon} [${sev}] ${ruleId}`);
    if (showFix) console.log(`  ${rule.description}`);
    for (const m of matches.slice(0, 5)) {
      const loc = m.line > 0 ? `  line ${m.line}: ` : '  ';
      console.log(`${loc}${m.excerpt || m.detail}`);
    }
    if (matches.length > 5) console.log(`  … and ${matches.length - 5} more`);
  }
}
