const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const relativePath = moduleName.slice(2); // strip '@/'
    const filePath = path.resolve(projectRoot, relativePath);
    return context.resolveRequest(context, filePath, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
