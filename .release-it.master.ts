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
  }
} satisfies Config;
