// Metro config for the pnpm monorepo — lets Metro resolve + bundle workspace
// packages (e.g. @ascure/shared-utils, which lives at ../../packages and
// resolves via the hoisted root node_modules). watchFolders grants Metro read
// access to the repo root; nodeModulesPaths keeps resolution additive
// (hierarchical lookup stays on) so existing resolution is unchanged.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
