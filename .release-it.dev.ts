import type { Config } from "release-it";

export default {
  git: {
    requireCleanWorkingDir: true,
    commitMessage: "release: v${version}-dev",
    tagName: "v${version}-dev",
    requireUpstream: true
  },
  github: {
    release: true,
    preRelease: true
  },
  npm: {
    publish: false
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "angular"
      },
      infile: "CHANGELOG.md"
    }
  }
} satisfies Config;
