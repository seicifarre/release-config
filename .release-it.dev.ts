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
  }
} satisfies Config;
