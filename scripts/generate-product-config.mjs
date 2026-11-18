#!/usr/bin/env node
/**
 * Generate product configuration files from the canonical catalog.
 *
 * Reads: convex/config/productCatalog.ts
 * Writes:
 *   - src/config/products.generated.ts   (product IDs for dashboard)
 *   - src/config/product-ids.generated.ts (analytics-safe product ID allowlist)
 *
 * Usage: node --import tsx scripts/generate-product-config.mjs (npm run generate runs it)
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Dynamic import so tsx handles the TS transpilation
const { PRODUCT_CATALOG, SHARED_API_BUDGET } = await import('../convex/config/productCatalog.ts');

// ---------------------------------------------------------------------------
// 1. Generate src/config/products.generated.ts
// ---------------------------------------------------------------------------

// Build the DODO_PRODUCTS export preserving existing key naming convention:
// PRO_MONTHLY, PRO_ANNUAL, API_STARTER_MONTHLY, API_STARTER_ANNUAL, API_BUSINESS, ENTERPRISE
const KEY_MAP = {
  pro_monthly: 'PRO_MONTHLY',
  pro_annual: 'PRO_ANNUAL',
  pro_business_monthly: 'PRO_BUSINESS_MONTHLY',
  pro_business_annual: 'PRO_BUSINESS_ANNUAL',
  api_starter: 'API_STARTER_MONTHLY',
  api_starter_annual: 'API_STARTER_ANNUAL',
  api_business: 'API_BUSINESS',
  enterprise: 'ENTERPRISE',
};

const productEntries = Object.entries(PRODUCT_CATALOG)
  .filter(([, e]) => e.dodoProductId)
  .map(([key, e]) => {
    const exportKey = KEY_MAP[key] || key.toUpperCase();
    return `  ${exportKey}: '${e.dodoProductId}',`;
  })
  .join('\n');

const planLimitEntries = Object.entries(PRODUCT_CATALOG)
  .map(([key, e]) => `  ${JSON.stringify(key)}: ${JSON.stringify(e.features.planLimits ?? null)},`)
  .join('\n');

const productsTs = `// AUTO-GENERATED from convex/config/productCatalog.ts
// Do not edit manually. Run: npm run generate

export const DODO_PRODUCTS = {
${productEntries}
} as const;

export const PLAN_LIMITS = {
${planLimitEntries}
} as const;

/** Default product for upgrade CTAs (Pro Monthly). */
export const DEFAULT_UPGRADE_PRODUCT = DODO_PRODUCTS.PRO_MONTHLY;
`;

const productsPath = join(ROOT, 'src/config/products.generated.ts');
writeFileSync(productsPath, productsTs);
console.log(`  ✓ ${productsPath}`);

const productIdsTs = `// AUTO-GENERATED from convex/config/productCatalog.ts
// Do not edit manually. Run: npm run generate

/** Product IDs accepted by client-side analytics without loading checkout config. */
export const DODO_PRODUCT_IDS: ReadonlySet<string> = new Set([
${Object.values(PRODUCT_CATALOG)
  .filter((entry) => entry.dodoProductId)
  .map((entry) => `  '${entry.dodoProductId}',`)
  .join('\n')}
]);
`;

const productIdsPath = join(ROOT, 'src/config/product-ids.generated.ts');
writeFileSync(productIdsPath, productIdsTs);
console.log(`  ✓ ${productIdsPath}`);
