import type { Config } from "release-it";

export default {
  git: {
    requireCleanWorkingDir: true,
    commitMessage: "release: v${version}",
    tagName: "v${version}",
    requireUpstream: true
  },
  github: {
    release: true,
    preRelease: false
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
