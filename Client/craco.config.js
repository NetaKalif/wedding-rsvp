module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.ignoreWarnings = [/Failed to parse source map/];
      return webpackConfig;
    },
  },
  jest: {
    configure: (jestConfig) => {
      // CRA's bundled jest-resolve can't follow react-router's conditional
      // "exports" map (v7), so point it straight at the CJS builds.
      jestConfig.moduleNameMapper = {
        ...jestConfig.moduleNameMapper,
        "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
        "^react-router/dom$": "<rootDir>/node_modules/react-router/dist/development/dom-export.js",
      };
      return jestConfig;
    },
  },
};
