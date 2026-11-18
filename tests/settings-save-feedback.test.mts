import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, type PluginBuild } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function restoreGlobal(name: 'document' | 'localStorage' | 'requestAnimationFrame' | 'setTimeout' | 'window', value: unknown): void {
  if (value === undefined) Reflect.deleteProperty(globalThis, name);
  else Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

type ChangeLanguage = (value: string) => Promise<boolean>;

interface BundledModuleOptions {
  entryPoint: string;
  stubs: Map<string, string>;
  namespace: string;
  sourceFilter: RegExp;
  transformSource: (contents: string) => string;
}

async function loadBundledModule<T>(options: BundledModuleOptions): Promise<T> {
  const plugin = {
    name: `${options.namespace}-bundle`,
    setup(buildApi: PluginBuild) {
      buildApi.onResolve({ filter: /.*/ }, (args) => (
        options.stubs.has(args.path) ? { path: args.path, namespace: options.namespace } : null
      ));
      buildApi.onLoad({ filter: /.*/, namespace: options.namespace }, (args) => ({
        contents: options.stubs.get(args.path) ?? '',
        loader: 'js' as const,
      }));
      buildApi.onLoad({ filter: options.sourceFilter }, (args) => ({
        contents: options.transformSource(readFileSync(args.path, 'utf8')),
        loader: 'ts' as const,
      }));
    },
  };
  const result = await build({
    bundle: true,
    entryPoints: [options.entryPoint],
    format: 'esm',
    platform: 'browser',
    plugins: [plugin],
    target: 'es2022',
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
  return await import(moduleUrl) as T;
}

async function loadRealChangeLanguage(): Promise<ChangeLanguage> {
  const stubs = new Map<string, string>([
    ['i18next', `
      const i18next = {
        language: 'en',
        isInitialized: false,
        hasResourceBundle(){ return false; },
        addResourceBundle(language){ globalThis.__settingsAddedBundles.push(language); },
        async changeLanguage(language){
          globalThis.__settingsChangedLanguages.push(language);
          i18next.language = language;
        },
        use(){ return i18next; },
        async init(){},
        t(key){ return key; },
      };
      export default i18next;
    `],
    ['i18next-browser-languagedetector', 'export default class LanguageDetector { addDetector(){} }'],
    ['@/bootstrap/sentry-defer', 'export function enqueueSentryCall(){}'],
    ['@/shared/language-tags', 'export function resolveLanguageTag(value){ return value; }'],
    ['@/utils/i18n-url', 'export function readQueryLanguage(){} export function stripQueryLanguage(value){ return value; }'],
  ]);
  const module = await loadBundledModule<{ changeLanguage: ChangeLanguage }>({
    entryPoint: resolve(root, 'src/services/i18n.ts'),
    stubs,
    namespace: 'language-change-stub',
    sourceFilter: /i18n\.ts$/,
    transformSource: (contents) => {
      const transformed = contents.replace(
        /const localeModules = import\.meta\.glob<TranslationDictionary>\([\s\S]*?\n\);/,
        'const localeModules = globalThis.__settingsLocaleModules;',
      );
      assert.notEqual(transformed, contents, 'locale module replacement failed');
      return transformed;
    },
  });
  return module.changeLanguage;
}

describe('settings save feedback', () => {
  it('lets only the latest language request persist and reload', async () => {
    const runtime = globalThis as typeof globalThis & {
      __settingsLocaleModules?: Record<string, () => Promise<Record<string, unknown>>>;
      __settingsAddedBundles?: string[];
      __settingsChangedLanguages?: string[];
    };
    const originalDocument = globalThis.document;
    const originalLocalStorage = globalThis.localStorage;
    const originalWindow = globalThis.window;
    const persisted: string[] = [];
    let reloads = 0;
    let resolveFrench: ((value: Record<string, unknown>) => void) | undefined;
    let resolveGerman: ((value: Record<string, unknown>) => void) | undefined;

    runtime.__settingsLocaleModules = {
      '../locales/fr.json': () => new Promise((resolveLocale) => { resolveFrench = resolveLocale; }),
      '../locales/de.json': () => new Promise((resolveLocale) => { resolveGerman = resolveLocale; }),
    };
    runtime.__settingsAddedBundles = [];
    runtime.__settingsChangedLanguages = [];
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { setAttribute: () => undefined, removeAttribute: () => undefined } },
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem: (_key: string, value: string) => { persisted.push(value); } },
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        history: { replaceState: () => undefined, state: null },
        location: { href: 'https://www.worldmonitor.app/dashboard', reload: () => { reloads += 1; } },
      },
      writable: true,
    });

    try {
      const changeLanguage = await loadRealChangeLanguage();
      const frenchChange = changeLanguage('fr');
      const germanChange = changeLanguage('de');

      resolveGerman?.({ greeting: 'Hallo' });
      assert.equal(await germanChange, true);
      assert.deepEqual(persisted, ['de']);
      assert.deepEqual(runtime.__settingsChangedLanguages, ['de']);
      assert.equal(reloads, 1);

      resolveFrench?.({ greeting: 'Bonjour' });
      assert.equal(await frenchChange, false);
      assert.deepEqual(persisted, ['de']);
      assert.deepEqual(runtime.__settingsChangedLanguages, ['de']);
      assert.equal(reloads, 1);
    } finally {
      delete runtime.__settingsLocaleModules;
      delete runtime.__settingsAddedBundles;
      delete runtime.__settingsChangedLanguages;
      restoreGlobal('document', originalDocument);
      restoreGlobal('localStorage', originalLocalStorage);
      restoreGlobal('window', originalWindow);
    }
  });

  it('uses the accessible shared toast while preserving default and explicit durations', async () => {
    const originalDocument = globalThis.document;
    const originalAnimationFrame = globalThis.requestAnimationFrame;
    const originalSetTimeout = globalThis.setTimeout;
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    let replacedExistingToast = false;
    let appended = false;

    const toast = {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
      className: '',
      remove: () => undefined,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      textContent: '',
    };

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: { appendChild: () => { appended = true; } },
        createElement: () => toast,
        querySelector: () => ({ remove: () => { replacedExistingToast = true; } }),
      },
      writable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
      writable: true,
    });
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: (callback: () => void, delay = 0) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      writable: true,
    });

    try {
      const { showToast } = await import('../src/utils/toast.ts');
      showToast('Saved');
      assert.equal(replacedExistingToast, true);
      assert.equal(appended, true);
      assert.equal(toast.textContent, 'Saved');
      assert.equal(attributes.get('role'), 'status');
      assert.equal(classes.has('visible'), true);
      assert.equal(scheduled[0]?.delay, 4000);

      scheduled.length = 0;
      showToast('Short warning', 3000);
      assert.equal(scheduled[0]?.delay, 3000);
      scheduled[0]?.callback();
      assert.equal(classes.has('visible'), false);
      assert.equal(scheduled[1]?.delay, 300);
    } finally {
      restoreGlobal('document', originalDocument);
      restoreGlobal('requestAnimationFrame', originalAnimationFrame);
      restoreGlobal('setTimeout', originalSetTimeout);
    }
  });
});
