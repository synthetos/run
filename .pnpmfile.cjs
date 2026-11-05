// valibot declares typescript as an optional peer (types only; nothing at runtime). Left in, pnpm wires the
// workspace's dev TypeScript into the production dependency graph and the build-toolchain gate refuses the
// build (tools/gates/src/build). The peer is dropped here; type checking still uses the workspace's own tsc.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'valibot' && pkg.peerDependencies !== undefined) {
        delete pkg.peerDependencies.typescript;
        if (pkg.peerDependenciesMeta !== undefined) delete pkg.peerDependenciesMeta.typescript;
      }
      return pkg;
    },
  },
};
