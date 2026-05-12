// Deterministic design anti-pattern rules for EDS pages.
// Ported from impeccable (https://github.com/pbakaus/impeccable) and
// extended with EDS-specific authoring patterns.
//
// Each rule: { id, category, severity, description, check(html) → match[] }
// match: { line, excerpt, detail }

export const CATEGORIES = {
  AI_SLOP: 'ai-slop',      // Generic AI aesthetic patterns to avoid
  QUALITY:  'quality',     // Accessibility + typography + layout quality
  EDS:      'eds',         // EDS-authoring-specific pitfalls
};

export const SEVERITY = {
  ERROR:   'error',    // Definite violation
  WARNING: 'warning',  // Likely violation, needs human review
  INFO:    'info',     // Advisory
};

// ── Utilities ────────────────────────────────────────────────────────────────

function lines(html) {
  return html.split('\n');
}

function matchLines(html, re, extract = (m) => m[0]) {
  return lines(html).flatMap((line, i) => {
    const matches = [];
    let m;
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = r.exec(line)) !== null) {
      matches.push({ line: i + 1, excerpt: line.trim().slice(0, 100), detail: extract(m) });
    }
    return matches;
  });
}

function countOccurrences(html, re) {
  return (html.match(re) ?? []).length;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export const RULES = [
  // ── AI-Slop category ──────────────────────────────────────────────────────

  {
    id: 'gradient-text',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.ERROR,
    description: 'Gradient text (background-clip: text) — a hallmark AI-slop pattern. Use solid color or texture instead.',
    check(html) {
      return matchLines(html, /background-clip\s*:\s*text/i,
        () => 'gradient text via background-clip:text');
    },
  },

  {
    id: 'ai-color-palette',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Purple/violet gradient palette — over-represented in AI-generated designs. Verify it fits your brand register.',
    check(html) {
      const purpleRe = /(?:purple|violet|#[89ab][0-9a-f]{5}|hsl\(\s*2[6-9]\d|hsl\(\s*3[0-9]\d)/gi;
      const hits = matchLines(html, purpleRe);
      return hits.length >= 3 ? [{ line: 0, excerpt: `${hits.length} purple/violet references`, detail: 'review palette for AI slop' }] : [];
    },
  },

  {
    id: 'overused-font',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Over-used web font (Inter, Roboto, Montserrat, etc.) — signals template-default aesthetics.',
    check(html) {
      const overused = /font-family[^;]*:\s*['"]?(?:inter|roboto|open sans|lato|montserrat|geist|mona sans|plus jakarta sans|space grotesk|recoleta|fraunces)['"]/gi;
      return matchLines(html, overused, (m) => m[0].trim().slice(0, 80));
    },
  },

  {
    id: 'everything-centered',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'All text centered — monotonous visual rhythm. Mix alignment strategies.',
    check(html) {
      const centered = countOccurrences(html, /text-align\s*:\s*center/gi);
      const total = countOccurrences(html, /text-align\s*:/gi);
      if (total > 0 && centered / total > 0.8 && centered >= 4) {
        return [{ line: 0, excerpt: `${centered}/${total} text-align declarations are center`, detail: 'monotonous center alignment' }];
      }
      return [];
    },
  },

  {
    id: 'nested-cards',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Cards nested inside cards — visual noise. Flatten card grids to a single level.',
    check(html) {
      const card = /class="[^"]*(?:card|tile|panel)[^"]*"/gi;
      const hits = matchLines(html, card);
      // Heuristic: flag if we see card-like classes deeply nested (4+ levels of div)
      const deepNest = matchLines(html, /(<div[^>]*class="[^"]*(?:card|tile)[^"]*"[^>]*>.*){2,}/i);
      return deepNest.length > 0 ? deepNest : [];
    },
  },

  {
    id: 'bounce-easing',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.ERROR,
    description: 'Bounce/elastic easing on UI transitions — physically implausible, signals AI-default motion.',
    check(html) {
      return matchLines(html, /(?:cubic-bezier\([^)]*(?:-\d|1\.\d)\)|animation[^;]*bounce|easing[^;]*elastic)/gi);
    },
  },

  {
    id: 'glassmorphism',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.ERROR,
    description: 'Glassmorphism (backdrop-filter + rgba overlay) — dated AI aesthetic. Remove or rethink surface treatment.',
    check(html) {
      return matchLines(html, /backdrop-filter\s*:\s*blur/i);
    },
  },

  {
    id: 'hero-eyebrow-chip',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Small all-caps chip/label above the hero heading — over-used AI page template pattern.',
    check(html) {
      // Looks for a small uppercase badge just before an h1
      return matchLines(html, /<(?:p|span|div)[^>]*class="[^"]*(?:eyebrow|badge|label|tag|chip|overline|kicker)[^"]*"/gi);
    },
  },

  {
    id: 'side-stripe',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.ERROR,
    description: 'Thick accent border on one side of a card/section — cliché AI embellishment. Remove entirely.',
    check(html) {
      return matchLines(html, /border-(?:left|right)\s*:\s*(?:[4-9]px|1[0-9]px|\d+rem)/gi);
    },
  },

  {
    id: 'monotonous-spacing',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.INFO,
    description: 'Identical margin/padding across all sections — flat visual hierarchy. Vary spacing intentionally.',
    check(html) {
      const marginRe = /(?:margin|padding)\s*:\s*(\d+(?:px|rem|em))/gi;
      const vals = {};
      let m;
      while ((m = marginRe.exec(html)) !== null) {
        vals[m[1]] = (vals[m[1]] ?? 0) + 1;
      }
      const dominant = Object.entries(vals).find(([, n]) => n >= 8);
      return dominant
        ? [{ line: 0, excerpt: `"${dominant[0]}" used ${dominant[1]}× for spacing`, detail: 'monotonous spacing' }]
        : [];
    },
  },

  {
    id: 'flat-type-hierarchy',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Heading font sizes too similar — weak typographic hierarchy. Spread the scale at least 1.5× between levels.',
    check(html) {
      const sizes = [];
      const re = /(?:font-size)\s*:\s*([\d.]+)(?:px|rem)/gi;
      let m;
      while ((m = re.exec(html)) !== null) sizes.push(parseFloat(m[1]));
      if (sizes.length < 2) return [];
      const sorted = [...new Set(sizes)].sort((a, b) => a - b);
      const maxStep = sorted.reduce((acc, v, i) => i === 0 ? acc : Math.max(acc, v / sorted[i - 1]), 1);
      return maxStep < 1.3 && sorted.length >= 3
        ? [{ line: 0, excerpt: `font sizes: ${sorted.join(', ')}`, detail: 'scale ratio < 1.3× — too flat' }]
        : [];
    },
  },

  {
    id: 'single-font',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.INFO,
    description: 'Only one font family — consider a complementary pairing (display + body) for richer typographic voice.',
    check(html) {
      const fonts = new Set();
      const re = /font-family\s*:\s*['"]?([^'",;]+)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const f = m[1].trim().toLowerCase().replace(/['"]/g, '');
        if (f && f !== 'inherit' && f !== 'initial' && f !== 'sans-serif' && f !== 'serif') fonts.add(f);
      }
      return fonts.size === 1
        ? [{ line: 0, excerpt: `Only font: ${[...fonts][0]}`, detail: 'consider adding a display/heading face' }]
        : [];
    },
  },

  // ── Quality category ──────────────────────────────────────────────────────

  {
    id: 'missing-alt-text',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.ERROR,
    description: 'Images without alt text — WCAG 2.1 Level A failure.',
    check(html) {
      return matchLines(html, /<img(?![^>]*\balt\s*=)[^>]*>/gi,
        () => 'img without alt attribute');
    },
  },

  {
    id: 'empty-alt-decorative',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.INFO,
    description: 'Images with alt="" — confirm these are truly decorative and not content-bearing.',
    check(html) {
      return matchLines(html, /<img[^>]*alt\s*=\s*""\s*/gi,
        () => 'img alt="" — verify decorative intent');
    },
  },

  {
    id: 'skipped-heading',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.ERROR,
    description: 'Heading level skipped (e.g., h1 → h3 with no h2) — breaks screen-reader document outline.',
    check(html) {
      const levels = [];
      const re = /<h([1-6])[^>]*>/gi;
      let m;
      while ((m = re.exec(html)) !== null) levels.push(parseInt(m[1], 10));
      const gaps = [];
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] - levels[i - 1] > 1) {
          gaps.push({ line: 0, excerpt: `h${levels[i - 1]} → h${levels[i]}`, detail: 'skipped heading level' });
        }
      }
      return gaps;
    },
  },

  {
    id: 'line-length',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.WARNING,
    description: 'Text container wider than ~80ch — long lines hurt readability. Cap prose width with max-width.',
    check(html) {
      return matchLines(html, /max-width\s*:\s*(?:100%|none|initial)|width\s*:\s*100%/gi,
        () => 'unconstrained width — verify line length < 80ch');
    },
  },

  {
    id: 'tiny-text',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.ERROR,
    description: 'Body text smaller than 12px — fails WCAG 1.4.4 (Resize Text) at minimum and reads as fine print.',
    check(html) {
      return matchLines(html, /font-size\s*:\s*(?:[1-9]|1[01])px/gi,
        (m) => `font-size: ${m[0]} — below 12px minimum`);
    },
  },

  {
    id: 'all-caps-body',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.WARNING,
    description: 'Long uppercase passages (text-transform: uppercase on body copy) — impairs readability.',
    check(html) {
      return matchLines(html, /text-transform\s*:\s*uppercase/gi,
        () => 'verify uppercase is only on labels/headings, not body copy');
    },
  },

  {
    id: 'wide-tracking',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.WARNING,
    description: 'Letter-spacing > 0.1em on body text — degrades readability at reading sizes.',
    check(html) {
      return matchLines(html, /letter-spacing\s*:\s*0\.[1-9]\d*em/gi);
    },
  },

  {
    id: 'layout-transition',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.ERROR,
    description: 'CSS transition on layout properties (width, height, margin, padding) — causes jank and reflows.',
    check(html) {
      return matchLines(html,
        /transition\s*:[^;]*(?:width|height|margin|padding|top|left|right|bottom)/gi,
        () => 'layout property in transition — use transform/opacity instead');
    },
  },

  {
    id: 'generic-cta',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.WARNING,
    description: 'Generic link labels ("Click here", "Learn more", "Read more") — non-descriptive for screen readers.',
    check(html) {
      return matchLines(html,
        />\s*(?:click here|learn more|read more|find out more|get started|view more)\s*</gi,
        (m) => `generic CTA: "${m[0].trim()}"`);
    },
  },

  {
    id: 'justified-text',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.WARNING,
    description: 'Justified text without hyphenation creates "rivers" of whitespace. Add hyphens:auto or use text-align:left.',
    check(html) {
      const justified = matchLines(html, /text-align\s*:\s*justify/gi);
      const hyphens = html.includes('hyphens:') || html.includes('hyphens :');
      return (justified.length > 0 && !hyphens) ? justified : [];
    },
  },

  {
    id: 'pure-black-background',
    category: CATEGORIES.QUALITY,
    severity: SEVERITY.INFO,
    description: 'Pure #000 or #000000 background — slightly off-black (#0a0a0a / oklch(5%)) feels more refined.',
    check(html) {
      return matchLines(html,
        /background(?:-color)?\s*:\s*(?:#000000?|black|rgb\(0\s*,\s*0\s*,\s*0\))\b/gi,
        () => 'pure black background — consider near-black');
    },
  },

  // ── EDS category ──────────────────────────────────────────────────────────

  {
    id: 'hardcoded-color',
    category: CATEGORIES.EDS,
    severity: SEVERITY.WARNING,
    description: 'Hardcoded hex/rgb color in inline style — use CSS custom properties (--color-*) for theming.',
    check(html) {
      return matchLines(html,
        /style="[^"]*(?:color|background)[^"]*:\s*#[0-9a-f]{3,6}/gi,
        (m) => `inline color: ${m[0].slice(0, 80)}`);
    },
  },

  {
    id: 'inline-style-overuse',
    category: CATEGORIES.EDS,
    severity: SEVERITY.WARNING,
    description: 'Excessive inline styles — EDS blocks should use class-based CSS, not per-element style attributes.',
    check(html) {
      const count = countOccurrences(html, /\bstyle\s*="/gi);
      return count >= 10
        ? [{ line: 0, excerpt: `${count} inline style attributes`, detail: 'move to block CSS file' }]
        : [];
    },
  },

  {
    id: 'div-soup',
    category: CATEGORIES.EDS,
    severity: SEVERITY.WARNING,
    description: 'Excessive div nesting without semantic elements — use section/article/nav/aside appropriately.',
    check(html) {
      const divDepth = [];
      let depth = 0;
      let maxDepth = 0;
      const re = /<(\/?)div/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (m[1] === '/') depth = Math.max(0, depth - 1);
        else { depth++; maxDepth = Math.max(maxDepth, depth); }
      }
      return maxDepth > 8
        ? [{ line: 0, excerpt: `max div nesting depth: ${maxDepth}`, detail: 'flatten structure or use semantic elements' }]
        : [];
    },
  },

  {
    id: 'missing-section-metadata',
    category: CATEGORIES.EDS,
    severity: SEVERITY.INFO,
    description: 'No section-metadata block detected — EDS pages benefit from explicit section styling via metadata tables.',
    check(html) {
      const hasSection = /class="section-metadata"/i.test(html);
      const hasSections = (html.match(/<div[^>]*class="[^"]*section[^"]*"/gi) ?? []).length > 1;
      return (!hasSection && hasSections)
        ? [{ line: 0, excerpt: 'multi-section page without section-metadata', detail: 'add section-metadata block for per-section styling' }]
        : [];
    },
  },

  {
    id: 'anchor-without-aria-label',
    category: CATEGORIES.EDS,
    severity: SEVERITY.WARNING,
    description: 'Icon-only links without aria-label — screen readers announce the href, not the intent.',
    check(html) {
      // Anchor containing only an img or svg with no text content and no aria-label
      return matchLines(html,
        /<a(?![^>]*aria-label)[^>]*>\s*(?:<img|<svg)[^>]*>\s*<\/a>/gi,
        () => 'icon-only anchor without aria-label');
    },
  },

  {
    id: 'dark-glow',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Colored box-shadow glow on dark background — a cliché AI SaaS visual. Remove or use subtle depth shadows.',
    check(html) {
      return matchLines(html,
        /box-shadow\s*:[^;]*(?:rgba?\([^)]*\)|#[0-9a-f]{6})[^;]*(?:1[5-9]\d|[2-9]\d\d)px/gi,
        () => 'large colored box-shadow glow detected');
    },
  },

  {
    id: 'icon-tile-stack',
    category: CATEGORIES.AI_SLOP,
    severity: SEVERITY.WARNING,
    description: 'Icon tile stacked directly above heading text — a formulaic AI card pattern. Integrate icon inline or rethink layout.',
    check(html) {
      // img/svg followed immediately by h2/h3 inside a card-like container
      return matchLines(html,
        /<(?:img|svg)[^>]*>\s*<h[23]/gi,
        () => 'icon directly before heading — review icon-tile-stack pattern');
    },
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

export function detectAll(html) {
  const findings = [];
  for (const rule of RULES) {
    const matches = rule.check(html);
    for (const match of matches) {
      findings.push({ rule: rule.id, category: rule.category, severity: rule.severity, ...match });
    }
  }
  return findings;
}

export function detectByCategory(html, category) {
  return detectAll(html).filter((f) => f.category === category);
}

export function detectBySeverity(html, severity) {
  return detectAll(html).filter((f) => f.severity === severity);
}

export function summarize(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const ruleIds = [...new Set(findings.map((f) => f.rule))];
  return { ...counts, total: findings.length, rules: ruleIds };
}
