// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/*
 * The atomic import rule, linted.
 *
 * `code-standards.md` §3 states it in prose and then says why this file exists:
 * "A convention that is not linted is a convention that lasts two weeks." The
 * rule is that an atom imports tokens and React Native and nothing else, a
 * molecule imports atoms, an organism may reach the store and the services, and
 * only organisms and screens touch services at all. A molecule that fetches is
 * how every design system turns into a component dump.
 *
 * The inverse direction is here too: a service that imports a component, or the
 * navigation tree, makes the dependency graph cyclic and the layering decorative.
 */
const SERVICES = ['@/services/*', '@/services/**', '**/src/services/*', '**/src/services/**'];
const STORE = ['@/store/*', '@/store/**', '**/src/store/*', '**/src/store/**'];
const SCREENS = ['@/screens/*', '@/screens/**', '**/src/screens/*', '**/src/screens/**'];
const ROUTES = ['@/app/*', '@/app/**', '**/src/app/*', '**/src/app/**'];
const NAVIGATION = ['expo-router', 'expo-router/*', '@react-navigation/*'];
const DESIGN_SYSTEM = ['@/design-system', '@/design-system/**', '**/src/design-system/**'];

const layer = (name) => [
  `@/design-system/${name}`,
  `@/design-system/${name}/**`,
  `**/design-system/${name}`,
  `**/design-system/${name}/**`,
  `../${name}`,
  `../${name}/**`,
  `../../${name}`,
  `../../${name}/**`,
];

const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', 'src/services/api/generated/*'],
  },

  // Tokens are the bottom of the tree. They import nothing from the app.
  {
    files: ['src/design-system/tokens/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [
          ...SERVICES,
          ...STORE,
          ...SCREENS,
          ...ROUTES,
          ...layer('atoms'),
          ...layer('molecules'),
          ...layer('organisms'),
          ...layer('templates'),
        ],
        message:
          'Tokens are the bottom of the tree: colours, spacing, typography and radii. ' +
          'They import nothing from the app.',
      },
    ]),
  },

  // An atom imports tokens and React Native. Nothing else.
  {
    files: ['src/design-system/atoms/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [
          ...SERVICES,
          ...STORE,
          ...SCREENS,
          ...ROUTES,
          ...NAVIGATION,
          ...layer('molecules'),
          ...layer('organisms'),
          ...layer('templates'),
        ],
        message:
          'An atom imports tokens and React Native, nothing else (code-standards.md §3). ' +
          'No service, no store, no navigation, no higher layer. The moment an atom ' +
          'imports a service, the design system is over.',
      },
    ]),
  },

  // A molecule imports atoms and tokens.
  {
    files: ['src/design-system/molecules/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [
          ...SERVICES,
          ...STORE,
          ...SCREENS,
          ...ROUTES,
          ...NAVIGATION,
          ...layer('organisms'),
          ...layer('templates'),
        ],
        message:
          'A molecule imports atoms (code-standards.md §3). A molecule that reads the ' +
          'store or calls the API is the failure mode this rule exists to stop — pass ' +
          'it in as a prop and let an organism own the data.',
      },
    ]),
  },

  // An organism may read the store and call services. It may not reach a screen or a route.
  {
    files: ['src/design-system/organisms/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [...SCREENS, ...ROUTES, ...layer('templates')],
        message:
          'An organism may import molecules, atoms, the store and services — not a ' +
          'screen, a route or a template (code-standards.md §3).',
      },
    ]),
  },

  // A template is a layout shell. It arranges components; it does not fetch.
  {
    files: ['src/design-system/templates/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [...SERVICES, ...STORE, ...SCREENS, ...ROUTES],
        message:
          'A template is a layout shell: header, body, footer. The screen that uses it ' +
          'owns the data and passes it in.',
      },
    ]),
  },

  /*
   * Services are below the UI, not beside it. A service importing a component or
   * a route is a cycle, and it is how `services/` ends up holding screens.
   */
  {
    files: ['src/services/**/*.{ts,tsx}', 'src/store/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: [...DESIGN_SYSTEM, ...SCREENS, ...ROUTES],
        message:
          'A service and a store slice sit below the UI. They must not import a ' +
          'component, a screen or a route — that is a cycle, not a layer.',
      },
    ]),
  },

  /*
   * Screens and routes may use anything below them, but they must not reach into
   * another screen: a screen imported by a screen is a component in the wrong place.
   */
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: restrict([
      {
        group: ['@/services/api/generated/*', '**/services/api/generated/*'],
        message:
          'Import the aliases in services/api/types.ts, not the generated file. The ' +
          'generated file is rewritten by `npm run api:types` and is not a stable ' +
          'import surface.',
      },
    ]),
  },

  // Build tooling runs in Node, not in the app runtime.
  {
    files: ['plugins/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js', 'app.config.ts'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
]);
